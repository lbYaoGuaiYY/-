from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field


class CloudControls(BaseModel):
    model_config = ConfigDict(frozen=True)

    maintenance_mode: bool = False
    downloads_enabled: bool = True
    max_concurrent_downloads: int = Field(default=8, ge=1, le=64)


class CloudControlsPatch(BaseModel):
    model_config = ConfigDict(frozen=True)

    maintenance_mode: bool | None = None
    downloads_enabled: bool | None = None
    max_concurrent_downloads: int | None = Field(default=None, ge=1, le=64)


class CloudControlsStore:
    def __init__(self, library_root: Path) -> None:
        self._path = library_root / "controls.json"
        self._lock = threading.RLock()
        self._condition = threading.Condition(self._lock)
        self._controls = self._load()
        self._active_downloads = 0

    @property
    def health_status(self) -> str:
        with self._lock:
            if self._controls.maintenance_mode:
                return "maintenance"
            if not self._controls.downloads_enabled:
                return "degraded"
            return "ready"

    @property
    def maintenance_mode(self) -> bool:
        with self._lock:
            return self._controls.maintenance_mode

    def snapshot(self) -> dict[str, int | bool]:
        with self._lock:
            return {
                **self._controls.model_dump(),
                "active_downloads": self._active_downloads,
            }

    def patch(self, patch: CloudControlsPatch) -> dict[str, int | bool]:
        with self._lock:
            changes = patch.model_dump(exclude_none=True)
            self._controls = self._controls.model_copy(update=changes)
            self._persist()
            self._condition.notify_all()
            return self.snapshot()

    def try_acquire_download(self, timeout_seconds: float = 5.0) -> str | None:
        deadline = time.monotonic() + timeout_seconds
        with self._condition:
            if self._controls.maintenance_mode:
                return "maintenance"
            if not self._controls.downloads_enabled:
                return "disabled"
            while self._active_downloads >= self._controls.max_concurrent_downloads:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return "busy"
                self._condition.wait(timeout=remaining)
                if self._controls.maintenance_mode:
                    return "maintenance"
                if not self._controls.downloads_enabled:
                    return "disabled"
            self._active_downloads += 1
            return None

    def release_download(self) -> None:
        with self._condition:
            self._active_downloads = max(0, self._active_downloads - 1)
            self._condition.notify()

    def _load(self) -> CloudControls:
        try:
            return CloudControls.model_validate_json(self._path.read_text("utf-8"))
        except (OSError, ValueError):
            return CloudControls()

    def _persist(self) -> None:
        temporary = self._path.with_suffix(".json.tmp")
        temporary.write_text(self._controls.model_dump_json(), "utf-8")
        os.replace(temporary, self._path)
