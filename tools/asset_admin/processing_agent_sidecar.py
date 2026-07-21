"""Console sidecar used by the modern Qingshe processor desktop shell."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from tools.asset_admin.processing_agent import (
    DEFAULT_PROCESSING_URL,
    ProcessorConfiguration,
    default_processor_configuration_path,
    ensure_processor_configuration,
    processor_platform_name,
    run_agent,
)


def sidecar_event(event_type: str, **fields: Any) -> str:
    return json.dumps(
        {"type": event_type, **fields},
        ensure_ascii=False,
        separators=(",", ":"),
    )


def emit_event(event_type: str, **fields: Any) -> None:
    print(sidecar_event(event_type, **fields), flush=True)


def main() -> None:
    log_path = default_processor_configuration_path().with_name("processor.log")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=log_path,
        level=os.environ.get("QINGSHE_AGENT_LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    configured_token = os.environ.get("QINGSHE_PROCESSING_NODE_TOKEN", "")
    configured_base_url = os.environ.get(
        "QINGSHE_PROCESSING_URL", DEFAULT_PROCESSING_URL
    ).rstrip("/")
    if configured_token != "" and configured_base_url == DEFAULT_PROCESSING_URL:
        configuration = ProcessorConfiguration(
            base_url=configured_base_url, token=configured_token
        )
    else:
        emit_event("status", state="connecting", detail="正在启动并上报云端…")
        configuration = ensure_processor_configuration(
            default_processor_configuration_path(),
            base_url=configured_base_url if configured_base_url else DEFAULT_PROCESSING_URL,
            registration_token=os.environ.get(
                "QINGSHE_PROCESSING_REGISTRATION_TOKEN"
            ),
            status_callback=lambda state, detail: emit_event(
                "status", state=state, detail=detail
            ),
        )
    emit_event("node", server=configuration.base_url, platform=processor_platform_name())
    run_agent(
        configuration.base_url,
        configuration.token,
        status_callback=lambda state, detail: emit_event(
            "status", state=state, detail=detail
        ),
        completion_callback=lambda task_name: emit_event(
            "completed", task_name=task_name
        ),
    )


if __name__ == "__main__":
    main()
