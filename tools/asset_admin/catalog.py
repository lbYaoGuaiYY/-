from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

CATEGORIES: Final = ("花艺", "家具", "标识", "绿植", "地面", "灯具", "布艺", "其他")


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
        self._connection = sqlite3.connect(paths.database, check_same_thread=False)
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
                    updated_at TEXT NOT NULL, FOREIGN KEY(asset_id) REFERENCES assets(id)
                );
                CREATE INDEX IF NOT EXISTS assets_status_idx ON assets(status, updated_at DESC);
                CREATE INDEX IF NOT EXISTS assets_category_idx ON assets(category, updated_at DESC);
                CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status, created_at);
                """
            )
            try:
                self._connection.execute(
                    "CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(asset_id UNINDEXED, name, code, category, tags, tokenize='trigram')"
                )
            except sqlite3.OperationalError:
                self._connection.execute(
                    "CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(asset_id UNINDEXED, name, code, category, tags)"
                )
            self._connection.execute("UPDATE jobs SET status='pending' WHERE status='processing'")

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
        clauses = ["a.status='deleted'" if status == "deleted" else "a.status!='deleted'"]
        parameters: list[object] = []
        join = ""
        if query:
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
        return [self._public_asset(row) for row in rows]

    def list_jobs(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._connection.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100").fetchall()
        return [dict(row) for row in rows]

    def get_asset(self, asset_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._connection.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone()
        return None if row is None else self._public_asset(row)

    def claim_job(self) -> dict[str, Any] | None:
        with self._lock, self._connection:
            row = self._connection.execute(
                "SELECT * FROM jobs WHERE status='pending' ORDER BY created_at LIMIT 1"
            ).fetchone()
            if row is None:
                return None
            self._connection.execute(
                "UPDATE jobs SET status='processing', attempts=attempts+1, updated_at=? WHERE id=?",
                (now_iso(), row["id"]),
            )
            asset = self._connection.execute("SELECT * FROM assets WHERE id=?", (row["asset_id"],)).fetchone()
            return None if asset is None else {"job_id": row["id"], **dict(asset)}

    def complete_job(self, job_id: str, asset_id: str, **fields: object) -> None:
        updated_at = now_iso()
        assignments = ",".join(f"{key}=?" for key in fields)
        values = [*fields.values(), updated_at, asset_id]
        with self._lock, self._connection:
            self._connection.execute(f"UPDATE assets SET {assignments}, updated_at=? WHERE id=?", values)
            self._connection.execute("UPDATE jobs SET status='ready',error=NULL,updated_at=? WHERE id=?", (updated_at, job_id))
            asset = self._connection.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone()
            if asset is not None:
                self._index_asset(asset)

    def fail_job(self, job_id: str, asset_id: str, message: str) -> None:
        updated_at = now_iso()
        with self._lock, self._connection:
            self._connection.execute("UPDATE jobs SET status='failed',error=?,updated_at=? WHERE id=?", (message[:500], updated_at, job_id))
            self._connection.execute("UPDATE assets SET status='failed',updated_at=? WHERE id=?", (updated_at, asset_id))

    def retry_job(self, job_id: str) -> bool:
        with self._lock, self._connection:
            cursor = self._connection.execute("UPDATE jobs SET status='pending',error=NULL,updated_at=? WHERE id=? AND status='failed'", (now_iso(), job_id))
            if cursor.rowcount:
                self._connection.execute("UPDATE assets SET status='processing',updated_at=? WHERE id=(SELECT asset_id FROM jobs WHERE id=?)", (now_iso(), job_id))
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
            return cursor.rowcount > 0

    def set_deleted(self, asset_id: str, deleted: bool) -> bool:
        with self._lock, self._connection:
            cursor = self._connection.execute(
                "UPDATE assets SET status=?,deleted_at=?,updated_at=? WHERE id=?",
                ("deleted" if deleted else "ready", now_iso() if deleted else None, now_iso(), asset_id),
            )
            return cursor.rowcount > 0

    def set_deleted_by_content_hash(self, content_hash: str) -> bool:
        with self._lock, self._connection:
            cursor = self._connection.execute(
                "UPDATE assets SET status='deleted',deleted_at=?,updated_at=? WHERE content_hash=?",
                (now_iso(), now_iso(), content_hash),
            )
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
