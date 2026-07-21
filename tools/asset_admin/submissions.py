from __future__ import annotations

import hashlib
import secrets
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal


SubmissionMode = Literal["cutout", "review"]
PUBLIC_FAILURE_MESSAGES = frozenset(
    {"投稿处理失败", "本地处理失败", "云端处理请求失败"}
)


class SubmissionConflict(ValueError):
    """An idempotency key was reused with different submission metadata."""


class SubmissionQuotaExceeded(ValueError):
    """A durable anonymous submission quota has been exhausted."""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True, slots=True)
class Submission:
    id: str
    status: str
    mode: str
    name: str
    category: str | None
    needs_review: bool
    task_id: str | None
    asset_id: str | None
    error: str | None
    status_token: str | None = None


class SubmissionStore:
    """Durable, token-scoped state for public asset submissions.

    Status-token digests are persisted so an idempotent retry can receive a
    fresh token without invalidating a token already held by the caller.
    Lookups compare SHA-256 digests and never expose raw tokens or local paths.
    """

    def __init__(self, library_root: Path) -> None:
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(
            library_root / "submissions.db", check_same_thread=False
        )
        self._connection.row_factory = sqlite3.Row
        with self._lock, self._connection:
            self._connection.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS submissions (
                    id TEXT PRIMARY KEY,
                    status_token_hash TEXT NOT NULL UNIQUE,
                    idempotency_key_hash TEXT NOT NULL UNIQUE,
                    client_id_hash TEXT,
                    content_hash TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    name TEXT NOT NULL,
                    category TEXT,
                    needs_review INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    task_id TEXT UNIQUE,
                    asset_id TEXT,
                    error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS submissions_asset_idx
                    ON submissions(asset_id, status);
                CREATE INDEX IF NOT EXISTS submissions_task_idx
                    ON submissions(task_id, status);
                CREATE TABLE IF NOT EXISTS submission_status_tokens (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    submission_id TEXT NOT NULL,
                    status_token_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(submission_id, status_token_hash)
                );
                CREATE INDEX IF NOT EXISTS submission_status_tokens_lookup_idx
                    ON submission_status_tokens(submission_id, status_token_hash);
                CREATE TABLE IF NOT EXISTS submission_daily_quota (
                    bucket TEXT NOT NULL,
                    bucket_hash TEXT NOT NULL,
                    utc_day TEXT NOT NULL,
                    count INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(bucket, bucket_hash, utc_day)
                );
                CREATE TABLE IF NOT EXISTS submission_session_rate_limit (
                    bucket TEXT NOT NULL,
                    bucket_hash TEXT NOT NULL,
                    window_start INTEGER NOT NULL,
                    count INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(bucket, bucket_hash, window_start)
                );
                """
            )
            submission_columns = {
                str(row["name"])
                for row in self._connection.execute("PRAGMA table_info(submissions)")
            }
            if "client_id_hash" not in submission_columns:
                self._connection.execute(
                    "ALTER TABLE submissions ADD COLUMN client_id_hash TEXT"
                )
            # Backfill the current digest for databases created before the
            # bounded token-history table existed.  No raw token is available
            # or reconstructed during migration.
            self._connection.execute(
                "INSERT OR IGNORE INTO submission_status_tokens"
                "(submission_id,status_token_hash,created_at) "
                "SELECT id,status_token_hash,created_at FROM submissions"
            )

    @staticmethod
    def _hash(value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    @staticmethod
    def _row_to_submission(row: sqlite3.Row) -> Submission:
        return Submission(
            id=str(row["id"]),
            status=str(row["status"]),
            mode=str(row["mode"]),
            name=str(row["name"]),
            category=None if row["category"] is None else str(row["category"]),
            needs_review=bool(row["needs_review"]),
            task_id=None if row["task_id"] is None else str(row["task_id"]),
            asset_id=None if row["asset_id"] is None else str(row["asset_id"]),
            error=None if row["error"] is None else str(row["error"]),
            status_token=None,
        )

    def get_by_idempotency(self, idempotency_key: str) -> Submission | None:
        key_hash = self._hash(idempotency_key)
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM submissions WHERE idempotency_key_hash=?", (key_hash,)
            ).fetchone()
        return None if row is None else self._row_to_submission(row)

    def create_or_get(
        self,
        *,
        idempotency_key: str,
        content_hash: str,
        mode: SubmissionMode,
        name: str,
        category: str | None,
        needs_review: bool,
        status: str,
        client_id_hash: str | None = None,
        quota_buckets: tuple[tuple[str, str, int], ...] = (),
    ) -> tuple[Submission, bool]:
        """Reserve a submission before creating an external processing task.

        The unique idempotency index makes concurrent retries converge on one
        row, avoiding duplicate files/tasks even if the first request is slow.
        """
        key_hash = self._hash(idempotency_key)
        with self._lock, self._connection:
            existing = self._connection.execute(
                "SELECT * FROM submissions WHERE idempotency_key_hash=?", (key_hash,)
            ).fetchone()
            if existing is not None:
                duplicate = self._row_to_submission(existing)
                if any(
                    (
                        existing["client_id_hash"] is not None
                        and client_id_hash is not None
                        and str(existing["client_id_hash"]) != client_id_hash,
                        str(existing["content_hash"]) != content_hash,
                        str(existing["mode"]) != mode,
                        str(existing["name"]) != name,
                        (None if existing["category"] is None else str(existing["category"]))
                        != category,
                    )
                ):
                    raise SubmissionConflict
                return self.rotate_status_token(duplicate.id), False

            submission_id = str(uuid.uuid4())
            status_token = secrets.token_urlsafe(32)
            timestamp = now_iso()
            try:
                for bucket, bucket_hash, limit in quota_buckets:
                    if not self._consume_daily_quota_locked(
                        bucket, bucket_hash, limit, timestamp[:10]
                    ):
                        raise SubmissionQuotaExceeded(bucket)
                self._connection.execute(
                    """INSERT INTO submissions(
                        id,status_token_hash,idempotency_key_hash,client_id_hash,content_hash,
                        mode,name,category,needs_review,status,created_at,updated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        submission_id,
                        self._hash(status_token),
                        key_hash,
                        client_id_hash,
                        content_hash,
                        mode,
                        name,
                        category,
                        int(needs_review),
                        status,
                        timestamp,
                        timestamp,
                    ),
                )
                self._connection.execute(
                    "INSERT INTO submission_status_tokens"
                    "(submission_id,status_token_hash,created_at) VALUES(?,?,?)",
                    (submission_id, self._hash(status_token), timestamp),
                )
            except sqlite3.IntegrityError:
                # A concurrent request may have won the idempotency unique
                # index. Do not retain quota increments from this losing
                # transaction before converging on the existing row.
                self._connection.rollback()
                existing = self._connection.execute(
                    "SELECT * FROM submissions WHERE idempotency_key_hash=?", (key_hash,)
                ).fetchone()
                if existing is None:
                    raise
                duplicate = self._row_to_submission(existing)
                if any(
                    (
                        existing["client_id_hash"] is not None
                        and client_id_hash is not None
                        and str(existing["client_id_hash"]) != client_id_hash,
                        str(existing["content_hash"]) != content_hash,
                        str(existing["mode"]) != mode,
                        str(existing["name"]) != name,
                        (None if existing["category"] is None else str(existing["category"]))
                        != category,
                    )
                ):
                    raise SubmissionConflict
                return self.rotate_status_token(duplicate.id), False
            row = self._connection.execute(
                "SELECT * FROM submissions WHERE id=?", (submission_id,)
            ).fetchone()
        assert row is not None
        return self._with_status_token(self._row_to_submission(row), status_token), True

    def _consume_daily_quota_locked(
        self, bucket: str, bucket_hash: str, limit: int, utc_day: str
    ) -> bool:
        """Increment a daily bucket atomically while holding the DB lock."""
        self._connection.execute(
            "INSERT OR IGNORE INTO submission_daily_quota"
            "(bucket,bucket_hash,utc_day,count) VALUES(?,?,?,0)",
            (bucket, bucket_hash, utc_day),
        )
        cursor = self._connection.execute(
            "UPDATE submission_daily_quota SET count=count+1 "
            "WHERE bucket=? AND bucket_hash=? AND utc_day=? AND count<?",
            (bucket, bucket_hash, utc_day, max(0, int(limit))),
        )
        return cursor.rowcount == 1

    def consume_session_rate_limit(
        self,
        *,
        client_hash: str,
        remote_hash: str,
        now_epoch: float | None = None,
        client_limit: int = 10,
        remote_limit: int = 30,
    ) -> int | None:
        """Consume one session-issuance slot from both minute buckets.

        The operation is transactional, so a request that hits either limit
        does not consume a slot from the other bucket.
        """
        current = datetime.now(timezone.utc).timestamp() if now_epoch is None else now_epoch
        window_start = int(current // 60) * 60
        buckets = (
            ("client", client_hash, client_limit),
            ("remote", remote_hash, remote_limit),
        )
        with self._lock, self._connection:
            # Serialize the check-and-increment across service workers. Every
            # bucket is checked before any increment, so a rejected request
            # cannot consume capacity from the other bucket.
            self._connection.execute("BEGIN IMMEDIATE")
            for bucket, bucket_hash, limit in buckets:
                row = self._connection.execute(
                    "SELECT count FROM submission_session_rate_limit "
                    "WHERE bucket=? AND bucket_hash=? AND window_start=?",
                    (bucket, bucket_hash, window_start),
                ).fetchone()
                if row is not None and int(row["count"]) >= max(0, int(limit)):
                    return max(1, window_start + 60 - int(current))
            for bucket, bucket_hash, _limit in buckets:
                self._connection.execute(
                    "INSERT OR IGNORE INTO submission_session_rate_limit"
                    "(bucket,bucket_hash,window_start,count) VALUES(?,?,?,0)",
                    (bucket, bucket_hash, window_start),
                )
                self._connection.execute(
                    "UPDATE submission_session_rate_limit SET count=count+1 "
                    "WHERE bucket=? AND bucket_hash=? AND window_start=?",
                    (bucket, bucket_hash, window_start),
                )
        return None

    @staticmethod
    def _with_status_token(submission: Submission, status_token: str) -> Submission:
        return Submission(
            id=submission.id,
            status=submission.status,
            mode=submission.mode,
            name=submission.name,
            category=submission.category,
            needs_review=submission.needs_review,
            task_id=submission.task_id,
            asset_id=submission.asset_id,
            error=submission.error,
            status_token=status_token,
        )

    def rotate_status_token(self, submission_id: str) -> Submission:
        status_token = secrets.token_urlsafe(32)
        with self._lock, self._connection:
            cursor = self._connection.execute(
                "UPDATE submissions SET status_token_hash=?,updated_at=? WHERE id=?",
                (self._hash(status_token), now_iso(), submission_id),
            )
            if cursor.rowcount != 1:
                raise KeyError(submission_id)
            self._connection.execute(
                "INSERT OR IGNORE INTO submission_status_tokens"
                "(submission_id,status_token_hash,created_at) VALUES(?,?,?)",
                (submission_id, self._hash(status_token), now_iso()),
            )
            self._connection.execute(
                "DELETE FROM submission_status_tokens WHERE submission_id=? AND id NOT IN "
                "(SELECT id FROM submission_status_tokens WHERE submission_id=? "
                "ORDER BY id DESC LIMIT 5)",
                (submission_id, submission_id),
            )
            row = self._connection.execute(
                "SELECT * FROM submissions WHERE id=?", (submission_id,)
            ).fetchone()
        assert row is not None
        return self._with_status_token(self._row_to_submission(row), status_token)

    def bind_task(self, submission_id: str, task_id: str) -> bool:
        with self._lock, self._connection:
            cursor = self._connection.execute(
                "UPDATE submissions SET task_id=?,updated_at=? WHERE id=? AND task_id IS NULL",
                (task_id, now_iso(), submission_id),
            )
        return cursor.rowcount == 1

    def bind_asset(self, submission_id: str, asset_id: str, *, status: str = "pending_review") -> bool:
        with self._lock, self._connection:
            cursor = self._connection.execute(
                "UPDATE submissions SET asset_id=?,status=?,updated_at=? WHERE id=?",
                (asset_id, status, now_iso(), submission_id),
            )
        return cursor.rowcount == 1

    def mark_processing(self, task_id: str) -> bool:
        with self._lock, self._connection:
            cursor = self._connection.execute(
                "UPDATE submissions SET status='processing',updated_at=? "
                "WHERE task_id=? AND status='queued'",
                (now_iso(), task_id),
            )
        return cursor.rowcount == 1

    def mark_task_complete(
        self,
        task_id: str,
        asset_id: str | None,
        *,
        status: str = "pending_review",
    ) -> bool:
        with self._lock, self._connection:
            cursor = self._connection.execute(
                "UPDATE submissions SET status=?,asset_id=?,error=NULL,updated_at=? "
                "WHERE task_id=? AND status IN ('queued','processing')",
                (status, asset_id, now_iso(), task_id),
            )
        return cursor.rowcount == 1

    def mark_failed(self, submission_id: str, message: str) -> bool:
        public_message = (
            message if message in PUBLIC_FAILURE_MESSAGES else "投稿处理失败"
        )
        with self._lock, self._connection:
            cursor = self._connection.execute(
                "UPDATE submissions SET status='failed',error=?,updated_at=? WHERE id=?",
                (public_message, now_iso(), submission_id),
            )
        return cursor.rowcount == 1

    def approve_asset(self, asset_id: str, category: str | None = None) -> bool:
        with self._lock, self._connection:
            if category is None:
                cursor = self._connection.execute(
                    "UPDATE submissions SET status='approved',needs_review=0,updated_at=? "
                    "WHERE asset_id=? AND status!='approved'",
                    (now_iso(), asset_id),
                )
            else:
                cursor = self._connection.execute(
                    "UPDATE submissions SET status='approved',needs_review=0,category=?,updated_at=? "
                    "WHERE asset_id=? AND status!='approved'",
                    (category, now_iso(), asset_id),
                )
        return cursor.rowcount > 0

    def get(self, submission_id: str) -> Submission | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM submissions WHERE id=?", (submission_id,)
            ).fetchone()
        return None if row is None else self._row_to_submission(row)

    def get_by_task(self, task_id: str) -> Submission | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM submissions WHERE task_id=?", (task_id,)
            ).fetchone()
        return None if row is None else self._row_to_submission(row)

    def get_for_status_token(self, submission_id: str, status_token: str) -> Submission | None:
        token_hash = self._hash(status_token)
        with self._lock:
            row = self._connection.execute(
                "SELECT s.* FROM submissions s LEFT JOIN submission_status_tokens t "
                "ON t.submission_id=s.id AND t.status_token_hash=? "
                "WHERE s.id=? AND (s.status_token_hash=? OR t.id IS NOT NULL)",
                (token_hash, submission_id, token_hash),
            ).fetchone()
        return None if row is None else self._row_to_submission(row)

    def asset_is_public(self, asset_id: str) -> bool:
        """Return whether a submission-linked asset is approved for the catalog."""
        with self._lock:
            rows = self._connection.execute(
                "SELECT status FROM submissions WHERE asset_id=?", (asset_id,)
            ).fetchall()
        # A duplicate retry can create a second submission row for an already
        # approved asset.  That must not downgrade the asset's visibility.
        return not rows or any(str(row["status"]) == "approved" for row in rows)

    def payload(self, submission_id: str) -> dict[str, Any] | None:
        submission = self.get(submission_id)
        if submission is None:
            return None
        return {
            "submission_id": submission.id,
            "status": submission.status,
            "asset_id": submission.asset_id,
        }
