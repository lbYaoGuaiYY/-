# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = [
#   "numba==0.62.1",
#   "pillow==12.1.0",
#   "rembg[cpu]==2.0.75",
# ]
# ///

"""Outbound-only local worker for cloud-created background removal jobs."""

from __future__ import annotations

import json
import logging
import os
import platform
import sys
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from threading import Event, Thread
from typing import Any, Callable

from PIL import Image

LOGGER = logging.getLogger("qingshe.processing_agent")
MODEL_NAME = "isnet-general-use"
POLL_SECONDS = 3
HEARTBEAT_SECONDS = 30
DEFAULT_PROCESSING_URL = "https://assets.xiduoduo.top/api/v1"
PANEL_CLIENT_FILENAME = "panel-client.json"


@dataclass(frozen=True, slots=True)
class ProcessingResult:
    processed: bytes
    thumbnail: bytes
    width: int
    height: int
    dominant_color: str


@dataclass(frozen=True, slots=True)
class ProcessorConfiguration:
    base_url: str
    token: str


def processor_platform_name(system_name: str | None = None) -> str:
    """Return the platform vocabulary accepted by the cloud node API."""
    detected = (system_name or platform.system()).strip().lower()
    if detected in {"darwin", "macos"}:
        return "macos"
    if detected in {"windows", "win32"}:
        return "windows"
    if detected == "linux":
        return "linux"
    raise RuntimeError(f"不支持的抠图器平台：{detected or 'unknown'}")


def load_processor_configuration(path: Path) -> ProcessorConfiguration | None:
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        base_url = str(payload["base_url"]).rstrip("/")
        token = str(payload["token"])
    except (KeyError, TypeError, ValueError, OSError):
        return None
    if base_url != DEFAULT_PROCESSING_URL or token == "":
        return None
    return ProcessorConfiguration(base_url=base_url, token=token)


def save_processor_configuration(path: Path, configuration: ProcessorConfiguration) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps({"base_url": configuration.base_url, "token": configuration.token}),
        encoding="utf-8",
    )
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def default_processor_configuration_path() -> Path:
    if sys.platform == "darwin":
        path = Path.home() / "Library" / "Application Support" / "轻抠" / "processor.json"
        legacy = Path.home() / "Library" / "Application Support" / "轻设抠图器" / "processor.json"
    elif sys.platform == "win32":
        path = Path(os.environ.get("APPDATA", Path.home())) / "轻抠" / "processor.json"
        legacy = Path(os.environ.get("APPDATA", Path.home())) / "轻设抠图器" / "processor.json"
    else:
        return Path.home() / ".config" / "qingshe-processor" / "processor.json"
    if not path.is_file() and legacy.is_file():
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            path.write_bytes(legacy.read_bytes())
            os.chmod(path, 0o600)
        except OSError:
            return legacy
    return path


def processor_panel_client_path() -> Path:
    return default_processor_configuration_path().with_name(PANEL_CLIENT_FILENAME)


def load_processor_panel_client_id(path: Path | None = None) -> str | None:
    panel_path = path or processor_panel_client_path()
    if not panel_path.is_file():
        return None
    try:
        client_id = str(json.loads(panel_path.read_text(encoding="utf-8"))["client_id"])
        return str(uuid.UUID(client_id))
    except (KeyError, TypeError, ValueError, OSError):
        return None


def processor_panel_headers() -> dict[str, str]:
    client_id = load_processor_panel_client_id()
    return {} if client_id is None else {"X-Qingshe-Panel-Client": client_id}


def ensure_processor_configuration(
    path: Path,
    *,
    base_url: str = DEFAULT_PROCESSING_URL,
    status_callback: Callable[[str, str], None] | None = None,
) -> ProcessorConfiguration:
    """Load a node token that was securely paired by the authenticated panel."""
    report = status_callback or (lambda _state, _detail: None)
    configuration = load_processor_configuration(path)
    if configuration is not None:
        return configuration
    report("pairing", "请从素材面板点击“检测并启动”完成安全连接")
    raise RuntimeError("轻抠尚未通过素材面板安全连接")


def wait_for_processor_configuration(
    path: Path,
    *,
    base_url: str = DEFAULT_PROCESSING_URL,
    status_callback: Callable[[str, str], None] | None = None,
    stop_event: Event | None = None,
) -> ProcessorConfiguration:
    """Wait for a deep-link pairing while keeping the desktop companion alive."""
    report = status_callback or (lambda _state, _detail: None)
    stopped = stop_event or Event()
    configuration = load_processor_configuration(path)
    if configuration is not None:
        return configuration
    report("pairing", "请从素材面板点击“检测并启动”完成安全连接")
    while not stopped.wait(1):
        configuration = load_processor_configuration(path)
        if configuration is not None:
            return configuration
    raise RuntimeError("轻抠已停止")


def render_result(
    source: bytes, session: object | None = None, removed: bytes | None = None
) -> ProcessingResult:
    """Remove the source background, crop transparency and make a web preview."""
    if removed is None:
        if session is None:
            from rembg import new_session, remove

            session = new_session(MODEL_NAME)
            removed = bytes(remove(source, session=session))
        else:
            from rembg import remove

            removed = bytes(remove(source, session=session))
    with Image.open(BytesIO(removed)) as image:
        rgba = image.convert("RGBA")
        bounds = rgba.getchannel("A").getbbox()
        cropped = rgba.crop(bounds) if bounds is not None else rgba
        processed = BytesIO()
        cropped.save(processed, format="PNG", optimize=True)
        preview = cropped.copy()
        preview.thumbnail((480, 360), Image.Resampling.LANCZOS)
        thumbnail = BytesIO()
        preview.save(thumbnail, format="WEBP", quality=82, method=4)
        return ProcessingResult(
            processed=processed.getvalue(),
            thumbnail=thumbnail.getvalue(),
            width=cropped.width,
            height=cropped.height,
            dominant_color=dominant_color(cropped),
        )


def dominant_color(image: Image.Image) -> str:
    sample = image.copy()
    sample.thumbnail((64, 64))
    colors: dict[tuple[int, int, int], int] = {}
    for red, green, blue, alpha in sample.convert("RGBA").get_flattened_data():
        if alpha > 32:
            colors[(red, green, blue)] = colors.get((red, green, blue), 0) + 1
    if not colors:
        return "#808080"
    (red, green, blue), _ = max(colors.items(), key=lambda item: item[1])
    return f"#{red:02x}{green:02x}{blue:02x}"


def request_bytes(
    base_url: str,
    path: str,
    token: str,
    *,
    method: str = "GET",
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> bytes:
    for attempt in range(3):
        request = urllib.request.Request(
            f"{base_url}{path}",
            data=body,
            method=method,
            headers={
                "Authorization": f"Bearer {token}",
                "User-Agent": "QingsheProcessingNode/1.0",
                **(headers or {}),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310
                return response.read()
        except urllib.error.URLError:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)
    raise RuntimeError("处理节点请求重试失败")


def multipart_result(result: ProcessingResult) -> tuple[bytes, str]:
    boundary = f"----qingshe-{uuid.uuid4().hex}"
    chunks: list[bytes] = []

    def field(name: str, value: str) -> None:
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
                value.encode(),
                b"\r\n",
            ]
        )

    def file(name: str, filename: str, content_type: str, content: bytes) -> None:
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode(),
                f"Content-Type: {content_type}\r\n\r\n".encode(),
                content,
                b"\r\n",
            ]
        )

    field(
        "metadata",
        json.dumps(
            {
                "width": result.width,
                "height": result.height,
                "dominant_color": result.dominant_color,
            }
        ),
    )
    file("processed", "processed.png", "image/png", result.processed)
    file("thumbnail", "thumbnail.webp", "image/webp", result.thumbnail)
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def _heartbeat_loop(
    base_url: str,
    token: str,
    stopped: Event,
) -> None:
    """Background thread that keeps the node marked online while processing."""
    while not stopped.is_set():
        stopped.wait(HEARTBEAT_SECONDS)
        if stopped.is_set():
            break
        try:
            request_bytes(
                base_url,
                "/processing-nodes/heartbeat",
                token,
                method="POST",
                body=b"",
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "QingsheProcessingNode/1.0",
                    **processor_panel_headers(),
                },
            )
        except Exception:  # noqa: BLE001
            LOGGER.debug("心跳请求失败，下次重试")


def run_agent(
    base_url: str,
    token: str,
    *,
    status_callback: Callable[[str, str], None] | None = None,
    completion_callback: Callable[[str], None] | None = None,
    stop_event: Event | None = None,
) -> None:
    stopped = stop_event or Event()
    report = status_callback or (lambda _state, _detail: None)
    completed = completion_callback or (lambda _task_name: None)
    heartbeat_thread = Thread(
        target=_heartbeat_loop,
        args=(base_url, token, stopped),
        daemon=True,
        name="qingshe-heartbeat",
    )
    heartbeat_thread.start()
    LOGGER.info("本地抠图节点已连接云端，正在等待任务")
    report("ready", "已连接，正在等待抠图任务")
    session: object | None = None
    while not stopped.is_set():
        try:
            payload = json.loads(
                request_bytes(
                    base_url,
                    "/processing-nodes/poll",
                    token,
                    method="POST",
                    body=b"",
                    headers={
                        "Content-Type": "application/json",
                        "User-Agent": "QingsheProcessingNode/1.0",
                        **processor_panel_headers(),
                    },
                )
            )
            task = payload.get("task")
            if task is None:
                stopped.wait(POLL_SECONDS)
                continue
            task_id = str(task["id"])
            LOGGER.info("开始本地抠图任务 %s：%s", task_id, task["name"])
            report("processing", f"正在处理：{task['name']}")
            original = request_bytes(base_url, f"/processing-tasks/{task_id}/original", token)
            if session is None:
                from rembg import new_session

                LOGGER.info("正在加载本地抠图模型")
                report("processing", "首次使用，正在准备抠图模型")
                session = new_session(MODEL_NAME)
            result = render_result(original, session=session)
            body, content_type = multipart_result(result)
            request_bytes(
                base_url,
                f"/processing-tasks/{task_id}/complete",
                token,
                method="POST",
                body=body,
                headers={"Content-Type": content_type},
            )
            LOGGER.info("本地抠图任务 %s 已上传云端", task_id)
            completed(str(task["name"]))
            report("ready", f"已完成：{task['name']}")
        except urllib.error.HTTPError as error:
            LOGGER.error("云端处理节点请求失败（HTTP %s）", error.code)
            report("error", f"连接失败（HTTP {error.code}），正在重试")
            stopped.wait(POLL_SECONDS)
        except Exception:  # noqa: BLE001
            LOGGER.exception("本地抠图任务失败")
            report("error", "处理失败，正在自动重试")
            stopped.wait(POLL_SECONDS)


def main() -> None:
    logging.basicConfig(level=os.environ.get("QINGSHE_AGENT_LOG_LEVEL", "INFO"))
    configured_token = os.environ.get("QINGSHE_PROCESSING_NODE_TOKEN", "")
    configured_base_url = os.environ.get("QINGSHE_PROCESSING_URL", DEFAULT_PROCESSING_URL).rstrip("/")
    if configured_token != "" and configured_base_url == DEFAULT_PROCESSING_URL:
        configuration = ProcessorConfiguration(
            base_url=configured_base_url, token=configured_token
        )
    else:
        configuration = wait_for_processor_configuration(
            default_processor_configuration_path(),
            base_url=configured_base_url if configured_base_url else DEFAULT_PROCESSING_URL,
        )
    run_agent(configuration.base_url, configuration.token)


if __name__ == "__main__":
    main()
