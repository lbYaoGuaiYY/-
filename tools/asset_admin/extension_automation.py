from __future__ import annotations

import hashlib
import secrets
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


DEVICE_ACTIVE_SECONDS = 90
RUN_STATES = ("queued", "running", "completed", "failed", "cancelled")
ITEM_STATES = (
    "queued",
    "generating",
    "uploading",
    "processing",
    "ready",
    "failed",
    "cancelled",
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ExtensionAutomationStore:
    """Persist extension identities and generation runs without admin credentials."""

    def __init__(self, library_root: Path) -> None:
        library_root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(
            library_root / "extension-automation.db", check_same_thread=False
        )
        self._connection.row_factory = sqlite3.Row
        with self._lock, self._connection:
            self._connection.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS extension_devices (
                    id TEXT PRIMARY KEY,
                    token_hash TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    last_seen TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS extension_devices_identity_idx
                    ON extension_devices(name, platform);
                CREATE TABLE IF NOT EXISTS automation_runs (
                    id TEXT PRIMARY KEY,
                    device_id TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    count INTEGER NOT NULL,
                    category TEXT,
                    status TEXT NOT NULL,
                    error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS automation_runs_device_idx
                    ON automation_runs(device_id, created_at);
                CREATE TABLE IF NOT EXISTS automation_items (
                    id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    ordinal INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    error TEXT,
                    task_id TEXT,
                    asset_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(run_id, ordinal)
                );
                CREATE INDEX IF NOT EXISTS automation_items_run_idx
                    ON automation_items(run_id, ordinal);
                CREATE UNIQUE INDEX IF NOT EXISTS automation_items_task_idx
                    ON automation_items(task_id) WHERE task_id IS NOT NULL;
                """
            )

    def close(self) -> None:
        with self._lock:
            self._connection.close()

    @staticmethod
    def _hash_token(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def pair_device(self, name: str, platform: str) -> dict[str, str]:
        token = secrets.token_urlsafe(32)
        device_id = str(uuid.uuid4())
        timestamp = now_iso()
        with self._lock, self._connection:
            self._connection.execute(
                "DELETE FROM extension_devices WHERE name=? AND platform=?", (name, platform)
            )
            self._connection.execute(
                "INSERT INTO extension_devices(id,token_hash,name,platform,last_seen,created_at) "
                "VALUES(?,?,?,?,?,?)",
                (
                    device_id,
                    self._hash_token(token),
                    name,
                    platform,
                    timestamp,
                    timestamp,
                ),
            )
        return {"id": device_id, "token": token, "name": name, "platform": platform}

    def authenticate_device(self, token: str) -> str | None:
        timestamp = now_iso()
        with self._lock, self._connection:
            row = self._connection.execute(
                "SELECT id FROM extension_devices WHERE token_hash=?", (self._hash_token(token),)
            ).fetchone()
            if row is None:
                return None
            device_id = str(row["id"])
            self._connection.execute(
                "UPDATE extension_devices SET last_seen=? WHERE id=?", (timestamp, device_id)
            )
        return device_id

    def create_run(
        self,
        device_id: str,
        *,
        provider: str,
        prompt: str,
        count: int,
        category: str | None,
    ) -> dict[str, Any]:
        run_id = str(uuid.uuid4())
        timestamp = now_iso()
        with self._lock, self._connection:
            self._connection.execute(
                """INSERT INTO automation_runs(
                    id,device_id,provider,prompt,count,category,status,created_at,updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?)""",
                (
                    run_id,
                    device_id,
                    provider,
                    prompt,
                    count,
                    category,
                    "running",
                    timestamp,
                    timestamp,
                ),
            )
            self._connection.executemany(
                """INSERT INTO automation_items(
                    id,run_id,ordinal,status,created_at,updated_at
                ) VALUES(?,?,?,?,?,?)""",
                [
                    (str(uuid.uuid4()), run_id, ordinal, "queued", timestamp, timestamp)
                    for ordinal in range(1, count + 1)
                ],
            )
        payload = self.run_payload(run_id, device_id)
        if payload is None:
            raise RuntimeError("自动运行创建失败")
        return payload

    def run_payload(self, run_id: str, device_id: str | None = None) -> dict[str, Any] | None:
        with self._lock:
            parameters: tuple[str, ...] = (run_id,) if device_id is None else (run_id, device_id)
            condition = "id=?" if device_id is None else "id=? AND device_id=?"
            row = self._connection.execute(
                f"SELECT * FROM automation_runs WHERE {condition}", parameters
            ).fetchone()
            if row is None:
                return None
            items = self._connection.execute(
                "SELECT id,ordinal,status,attempts,error,task_id,asset_id,created_at,updated_at "
                "FROM automation_items WHERE run_id=? ORDER BY ordinal",
                (run_id,),
            ).fetchall()
        payload = dict(row)
        payload["items"] = [dict(item) for item in items]
        return payload

    def get_or_create_processing_task(
        self,
        run_id: str,
        item_id: str,
        device_id: str,
        create_task: Callable[[dict[str, Any], dict[str, Any]], dict[str, str]],
    ) -> tuple[str, bool] | None:
        """Create one processing task for an owned item, even after duplicate uploads."""
        with self._lock, self._connection:
            run = self._connection.execute(
                "SELECT * FROM automation_runs WHERE id=? AND device_id=?",
                (run_id, device_id),
            ).fetchone()
            item = self._connection.execute(
                "SELECT * FROM automation_items WHERE id=? AND run_id=?",
                (item_id, run_id),
            ).fetchone()
            if run is None or item is None:
                return None
            if item["task_id"] is not None:
                return str(item["task_id"]), False
            task = create_task(dict(run), dict(item))
            task_id = str(task["id"])
            self._connection.execute(
                "UPDATE automation_items SET status='processing',task_id=?,error=NULL,updated_at=? "
                "WHERE id=? AND task_id IS NULL",
                (task_id, now_iso(), item_id),
            )
            self._connection.execute(
                "UPDATE automation_runs SET status='running',error=NULL,updated_at=? WHERE id=?",
                (now_iso(), run_id),
            )
        return task_id, True

    def complete_processing_task(self, task_id: str, asset_id: str) -> bool:
        timestamp = now_iso()
        with self._lock, self._connection:
            item = self._connection.execute(
                "SELECT run_id FROM automation_items WHERE task_id=?", (task_id,)
            ).fetchone()
            if item is None:
                return False
            run_id = str(item["run_id"])
            self._connection.execute(
                "UPDATE automation_items SET status='ready',asset_id=?,error=NULL,updated_at=? "
                "WHERE task_id=?",
                (asset_id, timestamp, task_id),
            )
            incomplete = self._connection.execute(
                "SELECT COUNT(*) AS count FROM automation_items "
                "WHERE run_id=? AND status!='ready'",
                (run_id,),
            ).fetchone()
            if incomplete is not None and int(incomplete["count"]) == 0:
                self._connection.execute(
                    "UPDATE automation_runs SET status='completed',error=NULL,updated_at=? "
                    "WHERE id=?",
                    (timestamp, run_id),
                )
        return True

    def update_item(
        self,
        run_id: str,
        item_id: str,
        device_id: str,
        *,
        status: str,
        error: str | None,
    ) -> dict[str, Any] | None:
        if status not in {"queued", "generating", "uploading", "failed"}:
            raise ValueError("自动运行项状态无效")
        timestamp = now_iso()
        with self._lock, self._connection:
            row = self._connection.execute(
                """SELECT automation_items.* FROM automation_items
                JOIN automation_runs ON automation_runs.id=automation_items.run_id
                WHERE automation_items.id=? AND automation_items.run_id=?
                    AND automation_runs.device_id=?""",
                (item_id, run_id, device_id),
            ).fetchone()
            if row is None:
                return None
            if str(row["status"]) in {"processing", "ready"}:
                raise ValueError("已上传的自动运行项不能回退")
            attempts_increment = 1 if status == "generating" and row["status"] != status else 0
            self._connection.execute(
                "UPDATE automation_items SET status=?,attempts=attempts+?,error=?,updated_at=? "
                "WHERE id=?",
                (status, attempts_increment, error, timestamp, item_id),
            )
            run_status = "failed" if status == "failed" else "running"
            self._connection.execute(
                "UPDATE automation_runs SET status=?,error=?,updated_at=? WHERE id=? "
                "AND status NOT IN ('completed','cancelled')",
                (run_status, error if status == "failed" else None, timestamp, run_id),
            )
            updated = self._connection.execute(
                "SELECT id,ordinal,status,attempts,error,task_id,asset_id,created_at,updated_at "
                "FROM automation_items WHERE id=?",
                (item_id,),
            ).fetchone()
        return None if updated is None else dict(updated)

    def cancel_run(self, run_id: str, device_id: str) -> dict[str, Any] | None:
        timestamp = now_iso()
        with self._lock, self._connection:
            run = self._connection.execute(
                "SELECT id FROM automation_runs WHERE id=? AND device_id=?",
                (run_id, device_id),
            ).fetchone()
            if run is None:
                return None
            self._connection.execute(
                "UPDATE automation_runs SET status='cancelled',error=NULL,updated_at=? "
                "WHERE id=? AND status NOT IN ('completed','cancelled')",
                (timestamp, run_id),
            )
            self._connection.execute(
                "UPDATE automation_items SET status='cancelled',error=NULL,updated_at=? "
                "WHERE run_id=? AND status IN ('queued','generating','uploading','failed')",
                (timestamp, run_id),
            )
        return self.run_payload(run_id, device_id)

    def devices_payload(self) -> list[dict[str, Any]]:
        current = datetime.now(timezone.utc)
        with self._lock:
            rows = self._connection.execute(
                "SELECT id,name,platform,last_seen,created_at FROM extension_devices "
                "ORDER BY created_at"
            ).fetchall()
        devices: list[dict[str, Any]] = []
        for row in rows:
            device = dict(row)
            try:
                last_seen = datetime.fromisoformat(str(device["last_seen"]))
                active = (current - last_seen).total_seconds() <= DEVICE_ACTIVE_SECONDS
            except (KeyError, TypeError, ValueError):
                active = False
            device["status"] = "online" if active else "offline"
            devices.append(device)
        return devices

    def runs_payload(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
            payloads: list[dict[str, Any]] = []
            for row in rows:
                counts = self._connection.execute(
                    "SELECT status,COUNT(*) AS count FROM automation_items "
                    "WHERE run_id=? GROUP BY status",
                    (row["id"],),
                ).fetchall()
                summary = {str(item["status"]): int(item["count"]) for item in counts}
                payload = dict(row)
                payload.update(
                    {
                        "total": int(row["count"]),
                        "ready": summary.get("ready", 0),
                        "failed": summary.get("failed", 0),
                        "items": [
                            dict(item)
                            for item in self._connection.execute(
                                "SELECT id,ordinal,status,attempts,error,task_id,asset_id,"
                                "created_at,updated_at FROM automation_items "
                                "WHERE run_id=? ORDER BY ordinal",
                                (row["id"],),
                            ).fetchall()
                        ],
                    }
                )
                payloads.append(payload)
        return payloads
