import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from tools.asset_admin.catalog import Catalog, LibraryPaths
from tools.asset_admin.remote_processing import RemoteProcessingStore


def _catalog_pair(tmp_path: Path) -> tuple[Catalog, Catalog]:
    paths = LibraryPaths.create(tmp_path)
    return Catalog(paths), Catalog(paths)


def test_lease_schema_migrations_tolerate_a_concurrent_duplicate_column(
    tmp_path: Path,
) -> None:
    catalog = Catalog(LibraryPaths.create(tmp_path))
    processing = RemoteProcessingStore(tmp_path)

    catalog._add_column_if_missing("jobs", "lease_owner", "TEXT")
    catalog._add_column_if_missing("jobs", "lease_expires_at", "REAL")
    processing._add_column_if_missing("processing_tasks", "lease_owner", "TEXT")
    processing._add_column_if_missing("processing_tasks", "lease_expires_at", "REAL")


def test_catalog_claim_is_single_owner_across_connections(tmp_path: Path) -> None:
    first, second = _catalog_pair(tmp_path)
    original = first.paths.originals / "one.png"
    original.write_bytes(b"source")
    first.create_asset(
        name="one",
        mime_type="image/png",
        content_hash="hash-one",
        original_path=original,
    )

    claimed = first.claim_job()

    assert claimed is not None
    assert claimed["owner"] == claimed["lease_owner"]
    assert second.claim_job() is None


def test_catalog_reclaims_expired_lease_and_rejects_old_owner(tmp_path: Path) -> None:
    first, second = _catalog_pair(tmp_path)
    original = first.paths.originals / "one.png"
    original.write_bytes(b"source")
    created = first.create_asset(
        name="one",
        mime_type="image/png",
        content_hash="hash-one",
        original_path=original,
    )
    old = first.claim_job()
    assert old is not None

    with sqlite3.connect(first.paths.database) as connection:
        connection.execute(
            "UPDATE jobs SET lease_expires_at=? WHERE id=?",
            (time.time() - 1, created["job_id"]),
        )
    new = second.claim_job()

    assert new is not None
    assert new["owner"] != old["owner"]
    assert not first.complete_job(str(old["job_id"]), str(old["id"]), status="ready")
    assert not first.complete_job(
        str(old["job_id"]), str(old["id"]), owner=str(old["owner"]), status="ready"
    )


def test_catalog_reopens_a_failed_duplicate_for_direct_completion(tmp_path: Path) -> None:
    catalog = Catalog(LibraryPaths.create(tmp_path))
    original = catalog.paths.originals / "one.png"
    original.write_bytes(b"source")
    created = catalog.create_asset(
        name="one",
        mime_type="image/png",
        content_hash="hash-one",
        original_path=original,
    )
    claimed = catalog.claim_job()
    assert claimed is not None
    assert catalog.fail_job(
        str(claimed["job_id"]),
        str(claimed["id"]),
        "worker failed",
        owner=str(claimed["owner"]),
    )

    job_id = catalog.prepare_pending_job(str(created["id"]))

    assert job_id == created["job_id"]
    assert catalog.complete_job(job_id, str(created["id"]), status="ready")
    assert catalog.get_asset(str(created["id"]))["status"] == "ready"


def test_remote_claim_is_single_owner_and_expired_owner_cannot_complete(
    tmp_path: Path,
) -> None:
    first = RemoteProcessingStore(tmp_path)
    second = RemoteProcessingStore(tmp_path)
    task = first.create_task(
        original=b"source",
        original_mime="image/png",
        extension=".png",
        name="one",
        category="其他",
        needs_review=False,
    )
    claimed = first.claim_task("node-a")

    assert claimed is not None
    assert second.claim_task("node-b") is None
    with sqlite3.connect(tmp_path / "processing.db") as connection:
        connection.execute(
            "UPDATE processing_tasks SET lease_expires_at=? WHERE id=?",
            (time.time() - 1, task["id"]),
        )
    reclaimed = second.claim_task("node-a")

    assert reclaimed is not None
    assert claimed.lease_owner is not None
    assert reclaimed.lease_owner is not None
    assert reclaimed.node_id == "node-a"
    assert reclaimed.lease_owner != claimed.lease_owner
    assert not first.renew_task_lease(claimed.id, "node-a", claimed.lease_owner)
    assert second.renew_task_lease(reclaimed.id, "node-a", reclaimed.lease_owner)
    with first.task_commit(claimed.id, "node-a", claimed.lease_owner) as stale_finish:
        assert stale_finish is None
    with second.task_commit(reclaimed.id, "node-a", reclaimed.lease_owner) as finish:
        assert finish is not None
        assert finish("asset-new")


def test_remote_commit_transaction_blocks_competing_failure(tmp_path: Path) -> None:
    first = RemoteProcessingStore(tmp_path)
    second = RemoteProcessingStore(tmp_path)
    task = first.create_task(
        original=b"source",
        original_mime="image/png",
        extension=".png",
        name="one",
        category="其他",
        needs_review=False,
    )
    claimed = first.claim_task("node-a")
    assert claimed is not None and claimed.lease_owner is not None

    with ThreadPoolExecutor(max_workers=1) as executor:
        with first.task_commit(claimed.id, "node-a", claimed.lease_owner) as finish:
            assert finish is not None
            competing = executor.submit(
                second.fail_task,
                claimed.id,
                "node-a",
                "late failure",
                claimed.lease_owner,
            )
            time.sleep(0.05)
            assert not competing.done()
            assert finish("asset-new")
        assert competing.result(timeout=2) is False
    assert second.pending_completion_outbox() == [(claimed.id, "asset-new")]
    assert second.acknowledge_completion(claimed.id)


def test_remote_commit_transaction_rolls_back_after_a_crash(tmp_path: Path) -> None:
    first = RemoteProcessingStore(tmp_path)
    second = RemoteProcessingStore(tmp_path)
    created = first.create_task(
        original=b"source",
        original_mime="image/png",
        extension=".png",
        name="one",
        category="其他",
        needs_review=False,
    )
    claimed = first.claim_task("node-a")
    assert claimed is not None and claimed.lease_owner is not None

    with pytest.raises(RuntimeError, match="simulated crash"):
        with first.task_commit(claimed.id, "node-a", claimed.lease_owner) as finish:
            assert finish is not None
            raise RuntimeError("simulated crash")

    with sqlite3.connect(tmp_path / "processing.db") as connection:
        status = connection.execute(
            "SELECT status FROM processing_tasks WHERE id=?", (created["id"],)
        ).fetchone()
        assert status is not None and status[0] == "processing"
        connection.execute(
            "UPDATE processing_tasks SET lease_expires_at=? WHERE id=?",
            (time.time() - 1, created["id"]),
        )
    assert second.claim_task("node-b") is not None
