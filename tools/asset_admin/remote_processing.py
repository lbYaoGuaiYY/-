from __future__ import annotations

import hashlib
import secrets
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Final, Iterator


NODE_ACTIVE_SECONDS: Final = 90
LEASE_SECONDS: Final = 3600
SQLITE_TIMEOUT_SECONDS: Final = 30.0
SQLITE_BUSY_TIMEOUT_MS: Final = 30_000


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True, slots=True)
class ProcessingTask:
    id: str
    original_path: Path
    original_mime: str
    content_hash: str
    name: str
    category: str
    needs_review: bool
    status: str
    node_id: str | None
    lease_owner: str | None


class RemoteProcessingStore:
    """Persistently coordinates cloud jobs with outbound local processing nodes."""

    def __init__(self, library_root: Path) -> None:
        self._incoming = library_root / "incoming"
        self._incoming.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(
            library_root / "processing.db",
            check_same_thread=False,
            timeout=SQLITE_TIMEOUT_SECONDS,
        )
        self._connection.row_factory = sqlite3.Row
        with self._lock, self._connection:
            self._connection.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS processing_nodes (
                    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
                    platform TEXT NOT NULL, status TEXT NOT NULL, last_seen TEXT NOT NULL,
                    created_at TEXT NOT NULL, panel_client_id TEXT
                );
                CREATE TABLE IF NOT EXISTS processing_tasks (
                    id TEXT PRIMARY KEY, original_path TEXT NOT NULL, original_mime TEXT NOT NULL,
                    content_hash TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
                    needs_review INTEGER NOT NULL, status TEXT NOT NULL, node_id TEXT,
                    asset_id TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    lease_owner TEXT, lease_expires_at REAL
                );
                CREATE INDEX IF NOT EXISTS processing_tasks_status_idx
                    ON processing_tasks(status, created_at);
                CREATE TABLE IF NOT EXISTS processing_completion_outbox (
                    task_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, created_at TEXT NOT NULL
                );
                """
            )
            self._connection.execute(f"PRAGMA busy_timeout={SQLITE_BUSY_TIMEOUT_MS}")
            task_columns = {
                str(row[1]) for row in self._connection.execute("PRAGMA table_info(processing_tasks)")
            }
            if "lease_owner" not in task_columns:
                self._add_column_if_missing("processing_tasks", "lease_owner", "TEXT")
            if "lease_expires_at" not in task_columns:
                self._add_column_if_missing("processing_tasks", "lease_expires_at", "REAL")
            # Existing processing rows already identify their worker via node_id.
            # Preserve those in-flight tasks while giving them a bounded lease.
            self._connection.execute(
                "UPDATE processing_tasks SET lease_owner=node_id,lease_expires_at=? "
                "WHERE status='processing' AND node_id IS NOT NULL AND lease_owner IS NULL",
                (time.time() + LEASE_SECONDS,),
            )
            node_columns = {
                str(row["name"])
                for row in self._connection.execute("PRAGMA table_info(processing_nodes)")
            }
            if "panel_client_id" not in node_columns:
                self._add_column_if_missing("processing_nodes", "panel_client_id", "TEXT")

    def _add_column_if_missing(self, table: str, column: str, definition: str) -> None:
        try:
            self._connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        except sqlite3.OperationalError as error:
            if "duplicate column name" not in str(error).casefold():
                raise

    @staticmethod
    def _hash_token(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def register_node(self, name: str, platform: str) -> dict[str, str]:
        """Self-register an outbound cutout node without admin pairing."""
        return self.pair_node(name, platform)

    def pair_node(self, name: str, platform: str) -> dict[str, str]:
        token = secrets.token_urlsafe(32)
        node_id = str(uuid.uuid4())
        timestamp = now_iso()
        with self._lock, self._connection:
            self._connection.execute(
                "DELETE FROM processing_nodes WHERE name=? AND platform=?", (name, platform)
            )
            self._connection.execute(
                "INSERT INTO processing_nodes(id,token_hash,name,platform,status,last_seen,created_at) "
                "VALUES(?,?,?,?,?,?,?)",
                (node_id, self._hash_token(token), name, platform, "online", timestamp, timestamp),
            )
        return {"id": node_id, "token": token, "name": name, "platform": platform}

    def authenticate_node(self, token: str, panel_client_id: str | None = None) -> str | None:
        timestamp = now_iso()
        normalized_client_id: str | None = None
        if panel_client_id is not None:
            try:
                normalized_client_id = str(uuid.UUID(panel_client_id))
            except (AttributeError, TypeError, ValueError):
                normalized_client_id = None
        with self._lock, self._connection:
            row = self._connection.execute(
                "SELECT id FROM processing_nodes WHERE token_hash=?", (self._hash_token(token),)
            ).fetchone()
            if row is None:
                return None
            if normalized_client_id is None:
                self._connection.execute(
                    "UPDATE processing_nodes SET status='online',last_seen=? WHERE id=?",
                    (timestamp, row["id"]),
                )
            else:
                self._connection.execute(
                    "UPDATE processing_nodes SET status='online',last_seen=?,panel_client_id=? "
                    "WHERE id=?",
                    (timestamp, normalized_client_id, row["id"]),
                )
        return str(row["id"])

    def create_task(
        self,
        *,
        original: bytes,
        original_mime: str,
        extension: str,
        name: str,
        category: str,
        needs_review: bool,
    ) -> dict[str, str]:
        task_id = str(uuid.uuid4())
        original_path = self._incoming / f"{task_id}{extension}"
        temporary = original_path.with_suffix(f"{extension}.tmp")
        temporary.write_bytes(original)
        temporary.replace(original_path)
        timestamp = now_iso()
        with self._lock, self._connection:
            self._connection.execute(
                """INSERT INTO processing_tasks(
                    id,original_path,original_mime,content_hash,name,category,needs_review,status,
                    created_at,updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (
                    task_id,
                    str(original_path),
                    original_mime,
                    hashlib.sha256(original).hexdigest(),
                    name,
                    category,
                    int(needs_review),
                    "pending",
                    timestamp,
                    timestamp,
                ),
            )
        return {"id": task_id, "status": "pending"}

    def claim_task(self, node_id: str) -> ProcessingTask | None:
        now = time.time()
        lease_owner = secrets.token_urlsafe(24)
        with self._lock, self._connection:
            row = self._connection.execute(
                """
                UPDATE processing_tasks
                SET status='processing',node_id=?,lease_owner=?,lease_expires_at=?,updated_at=?
                WHERE id=(
                    SELECT id FROM processing_tasks
                    WHERE status='pending'
                       OR (status='processing' AND
                           (lease_expires_at IS NULL OR lease_expires_at<=?))
                    ORDER BY created_at LIMIT 1
                )
                RETURNING *
                """,
                (node_id, lease_owner, now + LEASE_SECONDS, now_iso(), now),
            ).fetchone()
            if row is None:
                return None
        return self._task_from_row(dict(row))

    def task_for_node(
        self, task_id: str, node_id: str, lease_owner: str | None = None
    ) -> ProcessingTask | None:
        now = time.time()
        expected_owner = node_id if lease_owner is None else lease_owner
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM processing_tasks WHERE id=? AND node_id=? AND "
                "lease_owner=? AND ((status='processing' AND lease_expires_at>?) "
                "OR status='committing')",
                (task_id, node_id, expected_owner, now),
            ).fetchone()
        return None if row is None else self._task_from_row(dict(row))

    def renew_task_lease(
        self, task_id: str, node_id: str, lease_owner: str | None = None
    ) -> bool:
        now = time.time()
        expected_owner = node_id if lease_owner is None else lease_owner
        with self._lock, self._connection:
            cursor = self._connection.execute(
                "UPDATE processing_tasks SET lease_expires_at=?,updated_at=? "
                "WHERE id=? AND node_id=? AND lease_owner=? AND status='processing' "
                "AND lease_expires_at>?",
                (now + LEASE_SECONDS, now_iso(), task_id, node_id, expected_owner, now),
            )
        return cursor.rowcount == 1

    @contextmanager
    def task_commit(
        self, task_id: str, node_id: str, lease_owner: str | None = None
    ) -> Iterator[Callable[[str | None], bool] | None]:
        """Fence one remote commit with an uncommitted SQLite write transaction.

        A concurrent claim or failure waits for this transaction. A process crash
        rolls the task state back to processing, while successfully published
        catalog/files can be reused idempotently by the next attempt.
        """
        now = time.time()
        expected_owner = node_id if lease_owner is None else lease_owner
        with self._lock:
            self._connection.execute("BEGIN IMMEDIATE")
            completed = False
            try:
                cursor = self._connection.execute(
                    "UPDATE processing_tasks SET status='committing',updated_at=? "
                    "WHERE id=? AND node_id=? AND lease_owner=? AND status='processing' "
                    "AND lease_expires_at>?",
                    (now_iso(), task_id, node_id, expected_owner, now),
                )
                if cursor.rowcount != 1:
                    self._connection.rollback()
                    yield None
                    return

                def finish(asset_id: str | None) -> bool:
                    nonlocal completed
                    result = self._connection.execute(
                        "UPDATE processing_tasks SET status='ready',asset_id=?,error=NULL,"
                        "lease_owner=NULL,lease_expires_at=NULL,updated_at=? "
                        "WHERE id=? AND node_id=? AND lease_owner=? AND status='committing'",
                        (asset_id, now_iso(), task_id, node_id, expected_owner),
                    )
                    completed = result.rowcount == 1
                    if completed and asset_id is not None:
                        self._connection.execute(
                            "INSERT INTO processing_completion_outbox(task_id,asset_id,created_at) "
                            "VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET "
                            "asset_id=excluded.asset_id,created_at=excluded.created_at",
                            (task_id, asset_id, now_iso()),
                        )
                    return completed

                yield finish
                if completed:
                    self._connection.commit()
                else:
                    self._connection.rollback()
            except BaseException:
                self._connection.rollback()
                raise

    def pending_completion_outbox(self) -> list[tuple[str, str]]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT task_id,asset_id FROM processing_completion_outbox ORDER BY created_at"
            ).fetchall()
        return [(str(row["task_id"]), str(row["asset_id"])) for row in rows]

    def acknowledge_completion(self, task_id: str) -> bool:
        with self._lock, self._connection:
            cursor = self._connection.execute(
                "DELETE FROM processing_completion_outbox WHERE task_id=?", (task_id,)
            )
        return cursor.rowcount == 1

    def fail_task(
        self, task_id: str, node_id: str, message: str, lease_owner: str | None = None
    ) -> bool:
        """Allow a worker to release a failed lease and clean its scratch file."""
        now = time.time()
        expected_owner = node_id if lease_owner is None else lease_owner
        with self._lock, self._connection:
            cursor = self._connection.execute(
                "UPDATE processing_tasks SET status='failed',error=?,lease_owner=NULL,"
                "lease_expires_at=NULL,updated_at=? WHERE id=? AND node_id=? "
                "AND lease_owner=? AND ((status='processing' AND lease_expires_at>?) "
                "OR status='committing') "
                "RETURNING original_path",
                (message[:500], now_iso(), task_id, node_id, expected_owner, now),
            ).fetchone()
        if cursor is None:
            return False
        self._remove_incoming_path(str(cursor["original_path"]))
        return True

    def _remove_incoming_path(self, value: str) -> bool:
        candidate = Path(value).resolve()
        incoming = self._incoming.resolve()
        if incoming not in candidate.parents or not candidate.is_file():
            return False
        try:
            candidate.unlink()
        except FileNotFoundError:
            return False
        return True

    def remove_task_original(self, task_id: str, node_id: str | None = None) -> bool:
        """Delete only a task's temporary incoming file after cataloging it."""
        with self._lock:
            row = self._connection.execute(
                "SELECT original_path,node_id FROM processing_tasks WHERE id=?",
                (task_id,),
            ).fetchone()
        if row is None or (node_id is not None and str(row["node_id"]) != node_id):
            return False
        return self._remove_incoming_path(str(row["original_path"]))

    def resolve_asset_review(self, asset_id: str, category: str | None = None) -> bool:
        with self._lock, self._connection:
            if category is None:
                cursor = self._connection.execute(
                    "UPDATE processing_tasks SET needs_review=0,updated_at=? WHERE asset_id=?",
                    (now_iso(), asset_id),
                )
            else:
                cursor = self._connection.execute(
                    "UPDATE processing_tasks SET category=?,needs_review=0,updated_at=? "
                    "WHERE asset_id=?",
                    (category, now_iso(), asset_id),
                )
        return cursor.rowcount > 0

    def nodes_payload(self) -> list[dict[str, Any]]:
        now = datetime.now(timezone.utc)
        with self._lock:
            rows = self._connection.execute(
                "SELECT id,name,platform,status,last_seen,created_at,"
                "panel_client_id AS client_id FROM processing_nodes "
                "ORDER BY created_at"
            ).fetchall()
        nodes: list[dict[str, Any]] = []
        for row in rows:
            node = dict(row)
            try:
                last_seen = datetime.fromisoformat(str(node["last_seen"]))
                is_active = (now - last_seen).total_seconds() <= NODE_ACTIVE_SECONDS
            except (KeyError, TypeError, ValueError):
                is_active = False
            node["status"] = "online" if is_active else "offline"
            nodes.append(node)
        nodes.sort(
            key=lambda node: (node["status"] == "online", str(node["last_seen"])),
            reverse=True,
        )
        return nodes

    def tasks_payload(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT id,name,category,needs_review,status,node_id,asset_id,error,created_at,updated_at "
                "FROM processing_tasks ORDER BY created_at DESC LIMIT 100"
            ).fetchall()
        return [dict(row) for row in rows]

    @staticmethod
    def _task_from_row(row: dict[str, Any]) -> ProcessingTask:
        return ProcessingTask(
            id=str(row["id"]),
            original_path=Path(str(row["original_path"])),
            original_mime=str(row["original_mime"]),
            content_hash=str(row["content_hash"]),
            name=str(row["name"]),
            category=str(row["category"]),
            needs_review=bool(row["needs_review"]),
            status=str(row["status"]),
            node_id=None if row["node_id"] is None else str(row["node_id"]),
            lease_owner=None if row["lease_owner"] is None else str(row["lease_owner"]),
        )
