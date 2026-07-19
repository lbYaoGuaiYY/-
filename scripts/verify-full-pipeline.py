"""Cross-platform, real HTTP verification of upload -> cutout -> catalog consumption."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import tempfile
import threading
import time
from io import BytesIO
from pathlib import Path

import httpx
import uvicorn
from PIL import Image

from tools.asset_admin.cloud_server import CloudSettings, create_app
from tools.asset_admin.processing_agent import run_agent


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE_IMAGE = PROJECT_ROOT / "src/features/assets/media/burgundy-autumn-floral.png"
EXTENSION_CLIENT = PROJECT_ROOT / "scripts/verify-browser-extension-pipeline.mjs"
PIPELINE_EVIDENCE = (
    PROJECT_ROOT
    / "docs/audits/2026-07-17-final-product/pipeline-e2e.jsonl"
)


def available_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def wait_until_ready(base_url: str) -> None:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        try:
            if httpx.get(f"{base_url}/health", timeout=1).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.1)
    raise TimeoutError("临时素材服务未在 20 秒内启动")


def verify_media(processed: bytes, thumbnail: bytes) -> dict[str, object]:
    with Image.open(BytesIO(processed)) as image:
        rgba = image.convert("RGBA")
        alpha = rgba.getchannel("A")
        alpha_range = alpha.getextrema()
        if alpha.getbbox() is None or alpha_range[0] == 255:
            raise AssertionError("抠图结果没有真实透明区域")
        processed_size = rgba.size
    with Image.open(BytesIO(thumbnail)) as image:
        if image.format != "WEBP":
            raise AssertionError(f"缩略图格式错误：{image.format}")
        thumbnail_size = image.size
    return {
        "processed_size": processed_size,
        "thumbnail_size": thumbnail_size,
        "alpha_range": alpha_range,
    }


def run_extension_client(
    api_url: str, token: str, device_id: str
) -> dict[str, object]:
    environment = os.environ.copy()
    environment.update(
        {
            "QINGSHE_VERIFY_API_URL": api_url,
            "QINGSHE_VERIFY_EXTENSION_TOKEN": token,
            "QINGSHE_VERIFY_EXTENSION_DEVICE_ID": device_id,
            "QINGSHE_VERIFY_SOURCE_IMAGE": str(SOURCE_IMAGE),
        }
    )
    completed = subprocess.run(
        ["node", str(EXTENSION_CLIENT)],
        cwd=PROJECT_ROOT,
        env=environment,
        capture_output=True,
        check=True,
        text=True,
        timeout=60,
    )
    payload = json.loads(completed.stdout)
    if not payload.get("created") or not payload.get("task_id"):
        raise AssertionError(f"扩展客户端没有创建处理任务：{payload}")
    return payload


def main() -> None:
    if not SOURCE_IMAGE.is_file():
        raise FileNotFoundError(SOURCE_IMAGE)
    with tempfile.TemporaryDirectory(prefix="qingshe-pipeline-") as temporary:
        library_root = Path(temporary) / "library"
        port = available_port()
        api_url = f"http://127.0.0.1:{port}/api/v1"
        app = create_app(
            CloudSettings(
                library_root=library_root,
                editor_token="pipeline-editor-token",
                admin_token="pipeline-admin-token",
                allowed_origins=("http://127.0.0.1",),
            )
        )
        server = uvicorn.Server(
            uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
        )
        server_thread = threading.Thread(target=server.run, daemon=True, name="pipeline-server")
        server_thread.start()
        try:
            wait_until_ready(api_url)
            admin_headers = {"Authorization": "Bearer pipeline-admin-token"}
            with httpx.Client(base_url=api_url, timeout=60) as client:
                paired = client.post(
                    "/admin/processing-nodes/pair",
                    headers=admin_headers,
                    json={
                        "name": "Windows 完整闭环验收节点",
                        "platform": "windows",
                        "panel_client_id": "33333333-3333-4333-8333-333333333333",
                    },
                )
                paired.raise_for_status()
                node_token = paired.json()["token"]
                extension = client.post(
                    "/admin/extension-devices/pair",
                    headers=admin_headers,
                    json={
                        "name": "Chrome 完整闭环验收插件",
                        "platform": "chrome",
                    },
                )
                extension.raise_for_status()
                extension_identity = extension.json()
                extension_result = run_extension_client(
                    api_url, extension_identity["token"], extension_identity["id"]
                )
                run_id = str(extension_result["run_id"])
                item_id = str(extension_result["item_id"])
                task_id = str(extension_result["task_id"])

                stopped = threading.Event()
                completed = threading.Event()
                agent = threading.Thread(
                    target=run_agent,
                    args=(api_url, node_token),
                    kwargs={
                        "completion_callback": lambda _name: (completed.set(), stopped.set()),
                        "stop_event": stopped,
                    },
                    daemon=True,
                    name="pipeline-processor",
                )
                agent.start()
                if not completed.wait(300):
                    stopped.set()
                    raise TimeoutError("真实抠图未在 5 分钟内完成")
                agent.join(timeout=10)

                dashboard = client.get("/admin/processing-dashboard", headers=admin_headers)
                dashboard.raise_for_status()
                task = next(item for item in dashboard.json()["tasks"] if item["id"] == task_id)
                if task["status"] != "ready" or not task["asset_id"]:
                    raise AssertionError(f"任务未完成：{task}")
                asset_id = task["asset_id"]
                extension_headers = {
                    "Authorization": f"Bearer {extension_identity['token']}"
                }
                extension_run = client.get(
                    f"/extension-runs/{run_id}", headers=extension_headers
                )
                extension_run.raise_for_status()
                run_item = next(
                    item for item in extension_run.json()["items"] if item["id"] == item_id
                )
                if run_item["status"] != "ready" or run_item["asset_id"] != asset_id:
                    raise AssertionError(f"扩展任务未关联成品：{run_item}")
                editor_headers = {"Authorization": "Bearer pipeline-editor-token"}
                catalog = client.get("/assets", headers=editor_headers)
                catalog.raise_for_status()
                asset = next(item for item in catalog.json()["assets"] if item["id"] == asset_id)
                if asset["status"] != "ready" or asset["name"] != "真实插件闭环素材 01":
                    raise AssertionError(f"编辑器素材记录无效：{asset}")
                processed = client.get(f"/assets/{asset_id}/processed", headers=editor_headers)
                processed.raise_for_status()
                thumbnail = client.get(f"/assets/{asset_id}/thumbnail", headers=editor_headers)
                thumbnail.raise_for_status()
                media = verify_media(processed.content, thumbnail.content)
                evidence = {
                    "pipeline": "ready",
                    "extension_client": "browser-extension/dist/chrome (MV3 Chromium)",
                    "browser_extension_id": extension_result["browser_extension_id"],
                    "prompt_submissions": extension_result["prompt_submissions"],
                    "uploads": extension_result["uploads"],
                    "extension_device_id": extension_identity["id"],
                    "run_id": run_id,
                    "item_id": item_id,
                    "task_id": task_id,
                    "asset_id": asset_id,
                    "processed_http": processed.status_code,
                    "thumbnail_http": thumbnail.status_code,
                    **media,
                }
                encoded_evidence = json.dumps(evidence, ensure_ascii=False)
                PIPELINE_EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
                PIPELINE_EVIDENCE.write_text(f"{encoded_evidence}\n", encoding="utf-8")
                print(encoded_evidence)
        finally:
            server.should_exit = True
            server_thread.join(timeout=10)


if __name__ == "__main__":
    main()
