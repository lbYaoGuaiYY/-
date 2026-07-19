from __future__ import annotations

import hashlib
import hmac
import json
import os
import platform
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


WINDOW_SECONDS = 60
RETENTION_SECONDS = 24 * 60 * 60
ACTIVE_CLIENT_SECONDS = 5 * 60


@dataclass(frozen=True, slots=True)
class RequestRecord:
    path_group: str
    status_code: int
    duration_ms: float
    response_bytes: int
    client_id: str | None
    platform: str | None
    version: str | None


class ObservabilityStore:
    def __init__(self, library_root: Path, secret: str) -> None:
        self._root = library_root
        self._path = library_root / "telemetry.json"
        self._secret = secret.encode("utf-8")
        self._lock = threading.RLock()
        self._started_at = time.time()
        self._windows: dict[int, dict[str, int | float]] = {}
        self._clients: dict[str, dict[str, Any]] = {}
        self._load()

    @staticmethod
    def path_group(path: str) -> str:
        if path.endswith(("/original", "/processed", "/thumbnail")):
            return "media"
        if "/admin/" in path:
            return "admin"
        if path.endswith("/assets") or path.endswith("/catalog/revision"):
            return "catalog"
        if path.endswith("/health"):
            return "health"
        return "other"

    def record(self, record: RequestRecord) -> None:
        now = time.time()
        window_key = int(now // WINDOW_SECONDS * WINDOW_SECONDS)
        with self._lock:
            self._prune(now)
            window = self._windows.setdefault(
                window_key,
                {
                    "requests": 0,
                    "failures": 0,
                    "downloads": 0,
                    "download_bytes": 0,
                    "duration_ms": 0.0,
                },
            )
            window["requests"] = int(window["requests"]) + 1
            window["duration_ms"] = float(window["duration_ms"]) + record.duration_ms
            if record.status_code >= 400:
                window["failures"] = int(window["failures"]) + 1
            if record.path_group == "media" and record.status_code < 400:
                window["downloads"] = int(window["downloads"]) + 1
                window["download_bytes"] = int(window["download_bytes"]) + max(
                    0, record.response_bytes
                )
            if record.client_id:
                client_hash = hmac.new(
                    self._secret, record.client_id.encode("utf-8"), hashlib.sha256
                ).hexdigest()[:16]
                client = self._clients.setdefault(
                    client_hash,
                    {
                        "id": client_hash,
                        "platform": self._normalize_platform(record.platform),
                        "version": (record.version or "unknown")[:32],
                        "last_seen": now,
                        "requests_24h": 0,
                        "download_bytes_24h": 0,
                    },
                )
                client["platform"] = self._normalize_platform(record.platform)
                client["version"] = (record.version or "unknown")[:32]
                client["last_seen"] = now
                client["requests_24h"] = int(client["requests_24h"]) + 1
                if record.path_group == "media" and record.status_code < 400:
                    client["download_bytes_24h"] = int(client["download_bytes_24h"]) + max(
                        0, record.response_bytes
                    )
            self._persist()

    def summary(self, library: dict[str, int]) -> dict[str, object]:
        now = time.time()
        with self._lock:
            self._prune(now)
            totals = self._window_totals()
            host = host_snapshot(self._root, self._started_at)
            alerts = build_alerts(host, totals)
            return {
                "status": "degraded" if alerts else "ready",
                "generated_at": datetime.now(UTC).isoformat(),
                "uptime_seconds": max(0, int(now - self._started_at)),
                "host": host,
                "library": library,
                "clients": {
                    "active_5m": sum(
                        1
                        for client in self._clients.values()
                        if now - float(client["last_seen"]) <= ACTIVE_CLIENT_SECONDS
                    ),
                    "seen_24h": len(self._clients),
                },
                "requests": {
                    "last_24h": totals["requests"],
                    "failures_24h": totals["failures"],
                    "average_duration_ms": round(
                        totals["duration_ms"] / max(1, totals["requests"]), 1
                    ),
                },
                "transfers": {
                    "active_downloads": 0,
                    "downloads_24h": totals["downloads"],
                    "download_bytes_24h": totals["download_bytes"],
                },
                "alerts": alerts,
            }

    def clients_payload(self) -> dict[str, object]:
        with self._lock:
            clients = sorted(
                (dict(client) for client in self._clients.values()),
                key=lambda client: float(client["last_seen"]),
                reverse=True,
            )
            for client in clients:
                client["last_seen"] = datetime.fromtimestamp(
                    float(client["last_seen"]), UTC
                ).isoformat()
            return {"clients": clients}

    def transfers_payload(self) -> dict[str, object]:
        with self._lock:
            windows = [
                {
                    "started_at": datetime.fromtimestamp(key, UTC).isoformat(),
                    **values,
                }
                for key, values in sorted(self._windows.items())
            ]
            return {"windows": windows}

    def _window_totals(self) -> dict[str, int | float]:
        totals: dict[str, int | float] = {
            "requests": 0,
            "failures": 0,
            "downloads": 0,
            "download_bytes": 0,
            "duration_ms": 0.0,
        }
        for window in self._windows.values():
            for key in totals:
                totals[key] += window[key]
        return totals

    def _prune(self, now: float) -> None:
        cutoff = now - RETENTION_SECONDS
        self._windows = {key: value for key, value in self._windows.items() if key >= cutoff}
        self._clients = {
            key: value
            for key, value in self._clients.items()
            if float(value.get("last_seen", 0)) >= cutoff
        }

    def _persist(self) -> None:
        temporary = self._path.with_suffix(".json.tmp")
        payload = {
            "windows": {str(key): value for key, value in self._windows.items()},
            "clients": self._clients,
        }
        try:
            temporary.write_text(json.dumps(payload, separators=(",", ":")), "utf-8")
            os.replace(temporary, self._path)
        except OSError:
            temporary.unlink(missing_ok=True)

    def _load(self) -> None:
        try:
            payload = json.loads(self._path.read_text("utf-8"))
            self._windows = {
                int(key): dict(value) for key, value in payload.get("windows", {}).items()
            }
            self._clients = {
                str(key): dict(value) for key, value in payload.get("clients", {}).items()
            }
            self._prune(time.time())
        except (OSError, ValueError, TypeError):
            self._windows = {}
            self._clients = {}

    @staticmethod
    def _normalize_platform(value: str | None) -> str:
        return value if value in {"windows", "macos", "ios", "web"} else "unknown"


def host_snapshot(library_root: Path, started_at: float) -> dict[str, object]:
    disk = shutil.disk_usage(library_root)
    memory = memory_snapshot()
    load = os.getloadavg() if hasattr(os, "getloadavg") else (0.0, 0.0, 0.0)
    cpu_count = os.cpu_count() or 1
    return {
        "cpu": {
            "count": cpu_count,
            "load_1m": round(load[0], 2),
            "load_5m": round(load[1], 2),
            "load_15m": round(load[2], 2),
            "estimated_usage_percent": round(min(100.0, load[0] / cpu_count * 100), 1),
        },
        "memory": memory,
        "disk": usage_payload(disk.total, disk.used, disk.free),
        "uptime_seconds": max(0, int(time.time() - started_at)),
    }


def memory_snapshot() -> dict[str, int | float]:
    try:
        values: dict[str, int] = {}
        for line in Path("/proc/meminfo").read_text("utf-8").splitlines():
            key, raw = line.split(":", 1)
            values[key] = int(raw.strip().split()[0]) * 1024
        return usage_payload(
            values["MemTotal"],
            values["MemTotal"] - values.get("MemAvailable", values.get("MemFree", 0)),
            values.get("MemAvailable", values.get("MemFree", 0)),
        )
    except (OSError, KeyError, ValueError):
        if platform.system() == "Windows":
            return windows_memory_snapshot()
        page_size = int(os.sysconf("SC_PAGE_SIZE"))
        total = page_size * int(os.sysconf("SC_PHYS_PAGES"))
        if platform.system() == "Darwin":
            available = darwin_available_memory(page_size)
        else:
            available = page_size * int(os.sysconf("SC_AVPHYS_PAGES"))
        return usage_payload(total, total - available, available)


def windows_memory_snapshot() -> dict[str, int | float]:
    import ctypes

    class MemoryStatusEx(ctypes.Structure):
        _fields_ = [
            ("length", ctypes.c_ulong),
            ("memory_load", ctypes.c_ulong),
            ("total_physical", ctypes.c_ulonglong),
            ("available_physical", ctypes.c_ulonglong),
            ("total_page_file", ctypes.c_ulonglong),
            ("available_page_file", ctypes.c_ulonglong),
            ("total_virtual", ctypes.c_ulonglong),
            ("available_virtual", ctypes.c_ulonglong),
            ("available_extended_virtual", ctypes.c_ulonglong),
        ]

    status = MemoryStatusEx()
    status.length = ctypes.sizeof(MemoryStatusEx)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        raise OSError("GlobalMemoryStatusEx failed")
    total = int(status.total_physical)
    available = int(status.available_physical)
    return usage_payload(total, total - available, available)


def darwin_available_memory(page_size: int) -> int:
    completed = subprocess.run(
        ["vm_stat"],
        check=True,
        capture_output=True,
        text=True,
        timeout=1,
    )
    available_pages = 0
    available_labels = {
        "Pages free",
        "Pages inactive",
        "Pages speculative",
        "Pages purgeable",
    }
    for line in completed.stdout.splitlines():
        label, separator, raw_value = line.partition(":")
        if separator and label in available_labels:
            available_pages += int(raw_value.strip().rstrip("."))
    return available_pages * page_size


def usage_payload(total: int, used: int, available: int) -> dict[str, int | float]:
    return {
        "total_bytes": total,
        "used_bytes": used,
        "available_bytes": available,
        "used_percent": round(used / max(1, total) * 100, 1),
    }


def build_alerts(
    host: dict[str, object], totals: dict[str, int | float]
) -> list[dict[str, str]]:
    alerts: list[dict[str, str]] = []
    for key, warning, critical, label in (
        ("memory", 85, 95, "内存"),
        ("disk", 80, 90, "素材磁盘"),
    ):
        usage = float(dict(host[key])["used_percent"])
        if usage >= warning:
            alerts.append(
                {
                    "severity": "critical" if usage >= critical else "warning",
                    "code": f"{key}_pressure",
                    "message": f"{label}使用已达 {usage:.1f}%",
                }
            )
    requests = int(totals["requests"])
    failures = int(totals["failures"])
    if requests >= 20 and failures / requests >= 0.05:
        alerts.append(
            {
                "severity": "warning",
                "code": "request_failures",
                "message": f"最近 24 小时请求失败率为 {failures / requests:.1%}",
            }
        )
    return alerts
