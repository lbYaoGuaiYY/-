from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

CATEGORIES: Final = ("花艺", "家具", "标识", "绿植", "地面", "灯具", "布艺", "其他")
LEASE_SECONDS: Final = 3600
SQLITE_TIMEOUT_SECONDS: Final = 30.0
SQLITE_BUSY_TIMEOUT_MS: Final = 30_000


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(frozen=True)
class LibraryPaths:
    root: Path
    originals: Path
    processed: Path
    thumbnails: Path
    models: Path
    backup: Path
    trash: Path
    database: Path

    @classmethod
    def create(cls, root: Path) -> "LibraryPaths":
        paths = cls(
            root=root,
            originals=root / "originals",
            processed=root / "processed",
            thumbnails=root / "thumbnails",
            models=root / "models",
            backup=root / "backup",
            trash=root / "trash",
            database=root / "catalog.db",
        )
        for directory in (
            paths.originals,
            paths.processed,
            paths.thumbnails,
            paths.models,
            paths.backup,
            paths.trash,
        ):
            directory.mkdir(parents=True, exist_ok=True)
        return paths


class Catalog:
    def __init__(self, paths: LibraryPaths) -> None:
        self.paths = paths
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(
            paths.database,
            check_same_thread=False,
            timeout=SQLITE_TIMEOUT_SECONDS,
        )
        self._connection.row_factory = sqlite3.Row
        self._initialize()

    def _initialize(self) -> None:
        with self._lock, self._connection:
            self._connection.executescript(
                """
                PRAGMA journal_mode=WAL;
                PRAGMA foreign_keys=ON;
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS assets (
                    id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
                    category TEXT NOT NULL, status TEXT NOT NULL, mime_type TEXT NOT NULL,
                    width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0,
                    original_path TEXT NOT NULL, processed_path TEXT, thumbnail_path TEXT,
                    content_hash TEXT NOT NULL UNIQUE, version INTEGER NOT NULL DEFAULT 1,
                    needs_review INTEGER NOT NULL DEFAULT 1, favorite INTEGER NOT NULL DEFAULT 0,
                    dominant_color TEXT, tags TEXT NOT NULL DEFAULT '[]', usage_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
                );
                CREATE TABLE IF NOT EXISTS asset_versions (
                    asset_id TEXT NOT NULL, version INTEGER NOT NULL, original_path TEXT NOT NULL,
                    processed_path TEXT, created_at TEXT NOT NULL,
                    PRIMARY KEY(asset_id, version), FOREIGN KEY(asset_id) REFERENCES assets(id)
                );
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, status TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL, lease_owner TEXT, lease_expires_at REAL,
                    FOREIGN KEY(asset_id) REFERENCES assets(id)
                );
                CREATE INDEX IF NOT EXISTS assets_status_idx ON assets(status, updated_at DESC);
                CREATE INDEX IF NOT EXISTS assets_category_idx ON assets(category, updated_at DESC);
                CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status, created_at);
                """
            )
            self._connection.execute(f"PRAGMA busy_timeout={SQLITE_BUSY_TIMEOUT_MS}")
            job_columns = {
                str(row[1]) for row in self._connection.execute("PRAGMA table_info(jobs)")
            }
            if "lease_owner" not in job_columns:
                self._add_column_if_missing("jobs", "lease_owner", "TEXT")
            if "lease_expires_at" not in job_columns:
                self._add_column_if_missing("jobs", "lease_expires_at", "REAL")
            try:
                self._connection.execute(
                    "CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(asset_id UNINDEXED, name, code, category, tags, tokenize='trigram')"
                )
            except sqlite3.OperationalError:
                self._connection.execute(
                    "CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(asset_id UNINDEXED, name, code, category, tags)"
                )
            self._connection.execute(
                "INSERT INTO meta(key,value) VALUES('catalog_revision','0') "
                "ON CONFLICT(key) DO NOTHING"
            )

    def _add_column_if_missing(self, table: str, column: str, definition: str) -> None:
        try:
            self._connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        except sqlite3.OperationalError as error:
            if "duplicate column name" not in str(error).casefold():
                raise

    def revision(self) -> int:
        with self._lock:
            return self._revision_unlocked()

    def _revision_unlocked(self) -> int:
        row = self._connection.execute(
            "SELECT value FROM meta WHERE key='catalog_revision'"
        ).fetchone()
        return 0 if row is None else int(row[0])

    def _bump_revision(self) -> None:
        self._connection.execute(
            "UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='catalog_revision'"
        )

    def create_asset(self, *, name: str, mime_type: str, content_hash: str, original_path: Path) -> dict[str, Any]:
        created_at = now_iso()
        with self._lock, self._connection:
            duplicate = self._connection.execute(
                "SELECT * FROM assets WHERE content_hash=? AND status!='deleted'", (content_hash,)
            ).fetchone()
            if duplicate is not None:
                return {**dict(duplicate), "duplicate": True}
            sequence_row = self._connection.execute(
                "SELECT value FROM meta WHERE key='asset_sequence'"
            ).fetchone()
            sequence = int(sequence_row[0]) + 1 if sequence_row is not None else 1
            self._connection.execute(
                "INSERT INTO meta(key,value) VALUES('asset_sequence',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (str(sequence),),
            )
            asset_id = str(uuid.uuid4())
            code = f"QS-{sequence:06d}"
            self._connection.execute(
                """INSERT INTO assets(id,code,name,category,status,mime_type,original_path,content_hash,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (asset_id, code, name, "其他", "processing", mime_type, str(original_path), content_hash, created_at, created_at),
            )
            self._connection.execute(
                "INSERT INTO asset_versions(asset_id,version,original_path,created_at) VALUES(?,?,?,?)",
                (asset_id, 1, str(original_path), created_at),
            )
            job_id = str(uuid.uuid4())
            self._connection.execute(
                "INSERT INTO jobs(id,asset_id,status,created_at,updated_at) VALUES(?,?,?,?,?)",
                (job_id, asset_id, "pending", created_at, created_at),
            )
            self._bump_revision()
            return {"id": asset_id, "code": code, "job_id": job_id, "duplicate": False}

    def list_assets(
        self,
        query: str,
        category: str,
        status: str,
        needs_review: bool | None,
        limit: int,
        offset: int,
    ) -> list[dict[str, Any]]:
        assets, _revision = self.list_assets_with_revision(
            query, category, status, needs_review, limit, offset
        )
        return assets

    def list_assets_with_revision(
        self,
        query: str,
        category: str,
        status: str,
        needs_review: bool | None,
        limit: int,
        offset: int,
    ) -> tuple[list[dict[str, Any]], int]:
        clauses = ["a.status='deleted'" if status == "deleted" else "a.status!='deleted'"]
        parameters: list[object] = []
        join = ""
        if query:
            if len(query) < 3:
                clauses.append(
                    "(instr(lower(a.name), lower(?)) > 0 "
                    "OR instr(lower(a.code), lower(?)) > 0 "
                    "OR instr(lower(a.category), lower(?)) > 0 "
                    "OR instr(lower(a.tags), lower(?)) > 0)"
                )
                parameters.extend((query, query, query, query))
            else:
                join = "JOIN assets_fts f ON f.asset_id=a.id"
                clauses.append("assets_fts MATCH ?")
                parameters.append(f'"{query.replace(chr(34), chr(34) * 2)}"')
        if category:
            clauses.append("a.category=?")
            parameters.append(category)
        if status and status != "deleted":
            clauses.append("a.status=?")
            parameters.append(status)
        if needs_review is not None:
            clauses.append("a.needs_review=?")
            parameters.append(int(needs_review))
        parameters.extend((limit, offset))
        with self._lock:
            rows = self._connection.execute(
                f"SELECT a.* FROM assets a {join} WHERE {' AND '.join(clauses)} ORDER BY a.updated_at DESC LIMIT ? OFFSET ?",
                parameters,
            ).fetchall()
            revision = self._revision_unlocked()
        return [self._public_asset(row) for row in rows], revision

    def list_jobs(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._connection.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100").fetchall()
        return [dict(row) for row in rows]

    def get_asset(self, asset_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._connection.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone()
        return None if row is None else self._public_asset(row)

    def prepare_pending_job(self, asset_id: str) -> str | None:
        """Return an ownerless job that a direct, already-processed result may finish.

        Failed or expired work is reopened. A live worker lease is never stolen;
        callers must retry after that worker completes or releases it.
        """
        timestamp = now_iso()
        now = time.time()
        with self._lock, self._connection:
            asset = self._connection.execute(
                "SELECT status FROM assets WHERE id=?", (asset_id,)
            ).fetchone()
            if asset is None or str(asset["status"]) == "ready":
                return None
            row = self._connection.execute(
                "SELECT * FROM jobs WHERE asset_id=? ORDER BY created_at LIMIT 1",
                (asset_id,),
            ).fetchone()
            if row is None:
                job_id = str(uuid.uuid4())
                self._connection.execute(
                    "INSERT INTO jobs(id,asset_id,status,created_at,updated_at) VALUES(?,?,?,?,?)",
                    (job_id, asset_id, "pending", timestamp, timestamp),
                )
            else:
                job_id = str(row["id"])
                job_status = str(row["status"])
                lease_expires_at = row["lease_expires_at"]
                live_lease = (
                    job_status == "processing"
                    and lease_expires_at is not None
                    and float(lease_expires_at) > now
                )
                if live_lease:
                    return None
                self._connection.execute(
                    "UPDATE jobs SET status='pending',error=NULL,lease_owner=NULL,"
                    "lease_expires_at=NULL,updated_at=? WHERE id=?",
                    (timestamp, job_id),
                )
            changed = self._connection.execute(
                "UPDATE assets SET status='processing',updated_at=? "
                "WHERE id=? AND status!='processing'",
                (timestamp, asset_id),
            )
            if changed.rowcount:
                self._bump_revision()
            return job_id

    def complete_direct_asset(self, asset_id: str, **fields: object) -> bool:
        """Atomically fence any worker lease and publish an already-processed asset."""
        updated_at = now_iso()
        now = time.time()
        assignments = ",".join(f"{key}=?" for key in fields)
        with self._lock, self._connection:
            asset = self._connection.execute(
                "SELECT id FROM assets WHERE id=?", (asset_id,)
            ).fetchone()
            if asset is None:
                return False
            job = self._connection.execute(
                "SELECT * FROM jobs WHERE asset_id=? ORDER BY created_at LIMIT 1",
                (asset_id,),
            ).fetchone()
            if job is not None:
                lease_expires_at = job["lease_expires_at"]
                if (
                    str(job["status"]) == "processing"
                    and lease_expires_at is not None
                    and float(lease_expires_at) > now
                ):
                    return False
                self._connection.execute(
                    "UPDATE jobs SET status='ready',error=NULL,lease_owner=NULL,"
                    "lease_expires_at=NULL,updated_at=? WHERE id=?",
                    (updated_at, job["id"]),
                )
            else:
                job_id = str(uuid.uuid4())
                self._connection.execute(
                    "INSERT INTO jobs(id,asset_id,status,created_at,updated_at) "
                    "VALUES(?,?,?,?,?)",
                    (job_id, asset_id, "ready", updated_at, updated_at),
                )
            if assignments:
                self._connection.execute(
                    f"UPDATE assets SET {assignments},updated_at=? WHERE id=?",
                    [*fields.values(), updated_at, asset_id],
                )
            else:
                self._connection.execute(
                    "UPDATE assets SET status='ready',updated_at=? WHERE id=?",
                    (updated_at, asset_id),
                )
            refreshed = self._connection.execute(
                "SELECT * FROM assets WHERE id=?", (asset_id,)
            ).fetchone()
            if refreshed is not None:
                self._index_asset(refreshed)
                self._bump_revision()
            return True

    def claim_job(self) -> dict[str, Any] | None:
        owner = str(uuid.uuid4())
        now = time.time()
        with self._lock, self._connection:
            row = self._connection.execute(
                """
                UPDATE jobs
                SET status='processing', attempts=attempts+1, updated_at=?,
                    lease_owner=?, lease_expires_at=?
                WHERE id=(
                    SELECT id FROM jobs
                    WHERE status='pending'
                       OR (status='processing' AND
                           (lease_expires_at IS NULL OR lease_expires_at<=?))
                    ORDER BY created_at LIMIT 1
                )
                RETURNING *
                """,
                (now_iso(), owner, now + LEASE_SECONDS, now),
            ).fetchone()
            if row is None:
                return None
            asset = self._connection.execute("SELECT * FROM assets WHERE id=?", (row["asset_id"],)).fetchone()
            if asset is None:
                return None
            return {
                "job_id": row["id"],
                "owner": owner,
                "lease_owner": owner,
                **dict(asset),
            }

    def renew_job_lease(self, job_id: str, asset_id: str, owner: str) -> bool:
        now = time.time()
        with self._lock, self._connection:
            cursor = self._connection.execute(
                "UPDATE jobs SET lease_expires_at=?,updated_at=? WHERE id=? AND asset_id=? "
                "AND status='processing' AND lease_owner=? AND lease_expires_at>?",
                (now + LEASE_SECONDS, now_iso(), job_id, asset_id, owner, now),
            )
        return cursor.rowcount == 1

    def complete_job(
        self, job_id: str, asset_id: str, owner: str | None = None, **fields: object
    ) -> bool:
        updated_at = now_iso()
        now = time.time()
        assignments = ",".join(f"{key}=?" for key in fields)
        values = [*fields.values(), updated_at, asset_id]
        with self._lock, self._connection:
            if owner is None:
                job_cursor = self._connection.execute(
                    "UPDATE jobs SET status='ready',error=NULL,lease_owner=NULL,"
                    "lease_expires_at=NULL,updated_at=? WHERE id=? AND asset_id=? "
                    "AND status='pending' AND lease_owner IS NULL",
                    (updated_at, job_id, asset_id),
                )
            else:
                job_cursor = self._connection.execute(
                    "UPDATE jobs SET status='ready',error=NULL,lease_owner=NULL,"
                    "lease_expires_at=NULL,updated_at=? WHERE id=? AND asset_id=? "
                    "AND status='processing' AND lease_owner=? AND lease_expires_at>?",
                    (updated_at, job_id, asset_id, owner, now),
                )
            if job_cursor.rowcount != 1:
                return False
            if assignments:
                self._connection.execute(f"UPDATE assets SET {assignments}, updated_at=? WHERE id=?", values)
            else:
                self._connection.execute("UPDATE assets SET updated_at=? WHERE id=?", (updated_at, asset_id))
            asset = self._connection.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone()
            if asset is not None:
                self._index_asset(asset)
                self._bump_revision()
            return True

    def fail_job(self, job_id: str, asset_id: str, message: str, owner: str | None = None) -> bool:
        updated_at = now_iso()
        now = time.time()
        with self._lock, self._connection:
            if owner is None:
                job_cursor = self._connection.execute(
                    "UPDATE jobs SET status='failed',error=?,lease_owner=NULL,"
                    "lease_expires_at=NULL,updated_at=? WHERE id=? AND asset_id=? "
                    "AND status='pending' AND lease_owner IS NULL",
                    (message[:500], updated_at, job_id, asset_id),
                )
            else:
                job_cursor = self._connection.execute(
                    "UPDATE jobs SET status='failed',error=?,lease_owner=NULL,"
                    "lease_expires_at=NULL,updated_at=? WHERE id=? AND asset_id=? "
                    "AND status='processing' AND lease_owner=? AND lease_expires_at>?",
                    (message[:500], updated_at, job_id, asset_id, owner, now),
                )
            if job_cursor.rowcount != 1:
                return False
            cursor = self._connection.execute("UPDATE assets SET status='failed',updated_at=? WHERE id=?", (updated_at, asset_id))
            if cursor.rowcount:
                self._bump_revision()
            return True

    def retry_job(self, job_id: str) -> bool:
        with self._lock, self._connection:
            cursor = self._connection.execute(
                "UPDATE jobs SET status='pending',error=NULL,lease_owner=NULL,"
                "lease_expires_at=NULL,updated_at=? WHERE id=? AND status='failed'",
                (now_iso(), job_id),
            )
            if cursor.rowcount:
                self._connection.execute("UPDATE assets SET status='processing',updated_at=? WHERE id=(SELECT asset_id FROM jobs WHERE id=?)", (now_iso(), job_id))
                self._bump_revision()
            return cursor.rowcount > 0

    def patch_asset(self, asset_id: str, changes: dict[str, object]) -> bool:
        allowed = {key: value for key, value in changes.items() if key in {"name", "category", "favorite", "needs_review"}}
        if not allowed:
            return False
        assignments = ",".join(f"{key}=?" for key in allowed)
        with self._lock, self._connection:
            cursor = self._connection.execute(f"UPDATE assets SET {assignments},updated_at=? WHERE id=?", [*allowed.values(), now_iso(), asset_id])
            row = self._connection.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone()
            if row is not None:
                self._index_asset(row)
            if cursor.rowcount:
                self._bump_revision()
            return cursor.rowcount > 0

    def set_deleted(self, asset_id: str, deleted: bool) -> bool:
        with self._lock, self._connection:
            existing = self._connection.execute(
                "SELECT status FROM assets WHERE id=?", (asset_id,)
            ).fetchone()
            if existing is None:
                return False
            next_status = "deleted" if deleted else "ready"
            if existing["status"] == next_status:
                return False
            cursor = self._connection.execute(
                "UPDATE assets SET status=?,deleted_at=?,updated_at=? WHERE id=?",
                (next_status, now_iso() if deleted else None, now_iso(), asset_id),
            )
            if cursor.rowcount:
                self._bump_revision()
            return cursor.rowcount > 0

    def set_deleted_by_content_hash(self, content_hash: str) -> bool:
        with self._lock, self._connection:
            cursor = self._connection.execute(
                "UPDATE assets SET status='deleted',deleted_at=?,updated_at=? WHERE content_hash=?",
                (now_iso(), now_iso(), content_hash),
            )
            if cursor.rowcount:
                self._bump_revision()
            return cursor.rowcount > 0

    def asset_path(self, asset_id: str, kind: str) -> Path | None:
        column = {"processed": "processed_path", "thumbnail": "thumbnail_path", "original": "original_path"}.get(kind)
        if column is None:
            return None
        with self._lock:
            row = self._connection.execute(f"SELECT {column} FROM assets WHERE id=?", (asset_id,)).fetchone()
        return None if row is None or row[0] is None else Path(row[0])

    def backup(self) -> Path:
        target = self.paths.backup / f"catalog-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
        with self._lock, sqlite3.connect(target) as output:
            self._connection.backup(output)
        return target

    def repair(self) -> dict[str, object]:
        with self._lock, self._connection:
            integrity = str(self._connection.execute("PRAGMA integrity_check").fetchone()[0])
            rows = self._connection.execute("SELECT * FROM assets").fetchall()
            self._connection.execute("DELETE FROM assets_fts")
            for row in rows:
                self._index_asset(row)
            self._connection.execute("UPDATE jobs SET status='pending' WHERE status='processing'")
        return {"integrity": integrity, "indexed": len(rows)}

    def statistics(self) -> dict[str, int]:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN status='ready' AND needs_review=0 THEN 1 ELSE 0 END) AS ready,
                    SUM(CASE WHEN status='ready' AND needs_review=1 THEN 1 ELSE 0 END) AS review,
                    SUM(CASE WHEN status='deleted' THEN 1 ELSE 0 END) AS deleted,
                    SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END) AS processing,
                    SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
                FROM assets
                """
            ).fetchone()
        asset_bytes = sum(
            file.stat().st_size
            for directory in (self.paths.originals, self.paths.processed, self.paths.thumbnails)
            for file in directory.rglob("*")
            if file.is_file()
        )
        return {
            "total": int(row["total"] or 0),
            "ready": int(row["ready"] or 0),
            "review": int(row["review"] or 0),
            "deleted": int(row["deleted"] or 0),
            "processing": int(row["processing"] or 0),
            "failed": int(row["failed"] or 0),
            "bytes": asset_bytes,
        }

    def _index_asset(self, row: sqlite3.Row) -> None:
        self._connection.execute("DELETE FROM assets_fts WHERE asset_id=?", (row["id"],))
        self._connection.execute(
            "INSERT INTO assets_fts(asset_id,name,code,category,tags) VALUES(?,?,?,?,?)",
            (row["id"], row["name"], row["code"], row["category"], row["tags"]),
        )

    @staticmethod
    def _public_asset(row: sqlite3.Row) -> dict[str, Any]:
        result = dict(row)
        result["tags"] = json.loads(result["tags"])
        for key in ("original_path", "processed_path", "thumbnail_path", "content_hash", "deleted_at"):
            result.pop(key, None)
        return result
