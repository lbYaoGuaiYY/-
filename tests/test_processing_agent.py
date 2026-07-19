import json
import os
from io import BytesIO
from pathlib import Path
from threading import Event
from urllib.error import HTTPError
import pytest

from PIL import Image

from tools.asset_admin.processing_agent import (
    ProcessorConfiguration,
    ensure_processor_configuration,
    load_processor_panel_client_id,
    load_processor_configuration,
    processor_platform_name,
    save_processor_configuration,
    render_result,
    run_agent,
)


def test_sidecar_event_serializes_one_compact_json_line() -> None:
    from tools.asset_admin.processing_agent_sidecar import sidecar_event

    assert sidecar_event("status", state="ready", detail="已连接") == (
        '{"type":"status","state":"ready","detail":"已连接"}'
    )


def test_processor_bundle_includes_pymatting_distribution_metadata() -> None:
    spec = Path("tools/asset_admin/qingshe_processor.spec").read_text(encoding="utf-8")
    assert 'copy_metadata("pymatting")' in spec


def test_processing_agent_renders_cropped_png_and_webp_preview() -> None:
    source = Image.new("RGBA", (40, 30), (0, 0, 0, 0))
    for x in range(10, 30):
        for y in range(5, 25):
            source.putpixel((x, y), (220, 20, 20, 255))
    buffer = BytesIO()
    source.save(buffer, format="PNG")

    result = render_result(buffer.getvalue(), removed=buffer.getvalue())

    assert result.width == 20
    assert result.height == 20
    assert result.dominant_color == "#dc1414"
    assert result.processed.startswith(b"\x89PNG")
    assert result.thumbnail.startswith(b"RIFF")


def test_processor_platform_name_normalizes_macos_and_windows_runtime_names() -> None:
    assert processor_platform_name("Darwin") == "macos"
    assert processor_platform_name("win32") == "windows"


def test_processor_persists_an_enrollment_token_outside_the_app_bundle(tmp_path) -> None:
    config_path = tmp_path / "processor.json"
    configuration = ProcessorConfiguration(
        base_url="https://assets.xiduoduo.top/api/v1",
        token="node-token",
    )

    save_processor_configuration(config_path, configuration)

    assert load_processor_configuration(config_path) == configuration
    if os.name != "nt":
        assert config_path.stat().st_mode & 0o077 == 0


def test_processor_reads_the_material_panel_client_identity(tmp_path) -> None:
    panel_path = tmp_path / "panel-client.json"
    panel_path.write_text(
        json.dumps({"client_id": "22222222-2222-4222-8222-222222222222"}),
        encoding="utf-8",
    )

    assert load_processor_panel_client_id(panel_path) == (
        "22222222-2222-4222-8222-222222222222"
    )

    panel_path.write_text(json.dumps({"client_id": "not-a-uuid"}), encoding="utf-8")
    assert load_processor_panel_client_id(panel_path) is None


def test_processing_agent_reports_ready_and_can_stop_between_polls(monkeypatch) -> None:
    stopped = Event()
    statuses: list[tuple[str, str]] = []

    def fake_request_bytes(*_args, **_kwargs) -> bytes:
        stopped.set()
        return b'{"task": null}'

    monkeypatch.setattr("tools.asset_admin.processing_agent.request_bytes", fake_request_bytes)

    run_agent(
        "https://assets.xiduoduo.top/api/v1",
        "node-token",
        status_callback=lambda state, detail: statuses.append((state, detail)),
        stop_event=stopped,
    )

    assert statuses == [("ready", "已连接，正在等待抠图任务")]


def test_processor_panel_uses_plain_language_status_labels() -> None:
    from tools.asset_admin.processing_agent_app import button_text_color, status_presentation

    assert status_presentation("connecting") == ("正在连接", "#e7b657")
    assert status_presentation("ready") == ("已连接", "#45c98a")
    assert status_presentation("processing") == ("正在抠图", "#4d8dff")
    assert status_presentation("error") == ("连接异常", "#ed6b72")
    assert button_text_color("darwin") == "#111111"
    assert button_text_color("win32") == "#ffffff"


def test_ensure_processor_configuration_reuses_saved_token(tmp_path, monkeypatch) -> None:
    config_path = tmp_path / "processor.json"
    save_processor_configuration(
        config_path,
        ProcessorConfiguration(
            base_url="https://assets.xiduoduo.top/api/v1",
            token="saved-token",
        ),
    )

    configuration = ensure_processor_configuration(config_path)
    assert configuration.token == "saved-token"


def test_ensure_processor_configuration_requires_panel_pairing(tmp_path) -> None:
    config_path = tmp_path / "processor.json"
    statuses: list[tuple[str, str]] = []

    with pytest.raises(RuntimeError, match="素材面板安全连接"):
        ensure_processor_configuration(
            config_path,
            status_callback=lambda state, detail: statuses.append((state, detail)),
        )

    assert load_processor_configuration(config_path) is None
    assert statuses == [("pairing", "请从素材面板点击“检测并启动”完成安全连接")]


def test_desktop_app_waits_for_secure_panel_pairing(monkeypatch) -> None:
    from tools.asset_admin import processing_agent_app

    app = processing_agent_app.ProcessingAgentApp.__new__(
        processing_agent_app.ProcessingAgentApp
    )
    app.stop_event = Event()
    app.status_updates = __import__("queue").SimpleQueue()
    app.window_actions = __import__("queue").SimpleQueue()

    monkeypatch.delenv("QINGSHE_PROCESSING_NODE_TOKEN", raising=False)
    def wait_for_pairing(*_args, **kwargs):
        kwargs["status_callback"](
            "pairing", "请从素材面板点击“检测并启动”完成安全连接"
        )
        return ProcessorConfiguration(
            base_url="https://assets.xiduoduo.top/api/v1",
            token="node-token",
        )

    monkeypatch.setattr(
        processing_agent_app, "wait_for_processor_configuration", wait_for_pairing
    )
    monkeypatch.setattr(processing_agent_app, "run_agent", lambda *_args, **_kwargs: None)

    app._run_worker()

    assert app.status_updates.get_nowait()[0] == "pairing"
