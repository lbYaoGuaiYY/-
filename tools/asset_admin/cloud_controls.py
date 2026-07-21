from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

try:
    import fcntl
except ImportError:  # pragma: no cover - fcntl is not available on Windows.
    fcntl = None

from pydantic import BaseModel, ConfigDict, Field


_PROCESS_LOCKS: dict[Path, threading.RLock] = {}
_PROCESS_LOCKS_GUARD = threading.Lock()


def _process_lock_for(path: Path) -> threading.RLock:
    """Return one process-local lock for each shared controls path."""
    canonical_path = path.resolve()
    with _PROCESS_LOCKS_GUARD:
        lock = _PROCESS_LOCKS.get(canonical_path)
        if lock is None:
            lock = threading.RLock()
            _PROCESS_LOCKS[canonical_path] = lock
        return lock


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
        self._path = (Path(library_root) / "controls.json").resolve()
        self._lock_path = self._path.with_name(f"{self._path.name}.lock")
        self._process_lock = _process_lock_for(self._path)
        self._lock = threading.RLock()
        self._condition = threading.Condition(self._lock)
        self._controls = self._load()
        self._active_downloads = 0

    @property
    def health_status(self) -> str:
        with self._lock:
            self._refresh_locked()
            if self._controls.maintenance_mode:
                return "maintenance"
            if not self._controls.downloads_enabled:
                return "degraded"
            return "ready"

    @property
    def maintenance_mode(self) -> bool:
        with self._lock:
            self._refresh_locked()
            return self._controls.maintenance_mode

    def snapshot(self) -> dict[str, int | bool]:
        with self._lock:
            self._refresh_locked()
            return {
                **self._controls.model_dump(),
                "active_downloads": self._active_downloads,
            }

    def patch(self, patch: CloudControlsPatch) -> dict[str, int | bool]:
        with self._lock:
            with self._shared_file_lock(exclusive=True):
                latest = self._read_from_disk()
                if latest is not None:
                    self._controls = latest
                changes = patch.model_dump(exclude_none=True)
                self._controls = self._controls.model_copy(update=changes)
                self._persist_locked()
            self._condition.notify_all()
            return {
                **self._controls.model_dump(),
                "active_downloads": self._active_downloads,
            }

    def try_acquire_download(self, timeout_seconds: float = 5.0) -> str | None:
        deadline = time.monotonic() + timeout_seconds
        with self._condition:
            self._refresh_locked()
            if self._controls.maintenance_mode:
                return "maintenance"
            if not self._controls.downloads_enabled:
                return "disabled"
            while self._active_downloads >= self._controls.max_concurrent_downloads:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return "busy"
                # A different process cannot notify this condition. Polling at a
                # short interval keeps externally changed controls responsive while
                # retaining the local condition's efficient wake-up behavior.
                self._condition.wait(timeout=min(remaining, 0.25))
                self._refresh_locked()
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
        with self._shared_file_lock(exclusive=False):
            loaded = self._read_from_disk()
        return loaded if loaded is not None else CloudControls()

    def _refresh_locked(self) -> None:
        """Refresh from disk without discarding the last known state on errors."""
        with self._shared_file_lock(exclusive=False):
            loaded = self._read_from_disk()
        if loaded is not None:
            self._controls = loaded

    def _read_from_disk(self) -> CloudControls | None:
        try:
            return CloudControls.model_validate_json(self._path.read_text("utf-8"))
        except (OSError, ValueError):
            # Atomic replacement normally prevents partial reads, but a missing,
            # corrupt, or transiently inaccessible file must not reset known
            # maintenance state back to the ready defaults.
            return None

    @contextmanager
    def _shared_file_lock(self, *, exclusive: bool) -> Iterator[None]:
        """Coordinate controls reads/writes across threads and processes."""
        with self._process_lock:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            with self._lock_path.open("a+b") as lock_file:
                if fcntl is not None:
                    operation = fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH
                    fcntl.flock(lock_file.fileno(), operation)
                try:
                    yield
                finally:
                    if fcntl is not None:
                        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

    def _persist_locked(self) -> None:
        """Atomically persist controls while the shared exclusive lock is held."""
        temporary_fd, temporary_name = tempfile.mkstemp(
            prefix=f".{self._path.name}.",
            suffix=".tmp",
            dir=self._path.parent,
        )
        try:
            with os.fdopen(temporary_fd, "w", encoding="utf-8") as temporary_file:
                temporary_fd = -1
                temporary_file.write(self._controls.model_dump_json())
                temporary_file.flush()
                os.fsync(temporary_file.fileno())
            os.replace(temporary_name, self._path)
        finally:
            if temporary_fd != -1:
                os.close(temporary_fd)
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass
