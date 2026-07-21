import json
import base64
import hashlib
import sqlite3
from io import BytesIO
from pathlib import Path
from threading import Event, Thread
from urllib.parse import unquote

from fastapi.testclient import TestClient
from PIL import Image

from tools.asset_admin.cloud_server import CloudSettings, create_app, load_settings
from tools.asset_admin.cloud_controls import CloudControlsPatch, CloudControlsStore
from tools.asset_admin.remote_processing import RemoteProcessingStore


def _real_image_bytes(format_name: str = "PNG", size: tuple[int, int] = (4, 3)) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", size, (240, 80, 40)).save(buffer, format=format_name)
    return buffer.getvalue()


def _submission_client(tmp_path: Path) -> TestClient:
    return TestClient(
        create_app(
            CloudSettings(
                library_root=tmp_path,
                editor_token="editor-secret",
                admin_token="admin-secret",
                allowed_origins=(),
                submission_token="submission-secret",
                processing_registration_token="registration-secret",
            )
        )
    )


SUBMISSION_CLIENT_ID = "8f03cde7-3d26-4a41-a245-42fb6a358e81"


def _submission_headers(client: TestClient) -> dict[str, str]:
    identity = {"X-Qingshe-Client": SUBMISSION_CLIENT_ID}
    session = client.post("/api/v1/submission-sessions", headers=identity)
    assert session.status_code == 201, session.text
    return {
        **identity,
        "Authorization": f"Bearer {session.json()['upload_token']}",
    }


def test_health_is_liveness_and_ready_requires_ready_controls(tmp_path: Path) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))

    assert client.get("/api/v1/health").status_code == 200
    assert client.get("/api/v1/ready").json() == {"status": "ready"}

    controls_response = client.patch(
        "/api/v1/admin/controls",
        headers={"Authorization": "Bearer admin-secret"},
        json={"maintenance_mode": True},
    )
    assert controls_response.status_code == 200, controls_response.text
    assert client.get("/api/v1/health").json() == {"status": "maintenance"}

    ready_response = client.get("/api/v1/ready")
    assert ready_response.status_code == 503
    assert ready_response.json()["detail"] == {"status": "maintenance"}
    assert ready_response.headers["retry-after"] == "5"


def test_processing_dashboard_orders_active_nodes_before_stale_records(tmp_path: Path) -> None:
    processing = RemoteProcessingStore(tmp_path)
    stale = processing.pair_node("旧 Mac", "macos")
    active = processing.pair_node("这台 Mac", "macos")
    with processing._connection:  # noqa: SLF001 - regression setup for a stale persisted row
        processing._connection.execute(  # noqa: SLF001
            "UPDATE processing_nodes SET last_seen=? WHERE id=?",
            ("2026-01-01T00:00:00+00:00", stale["id"]),
        )

    nodes = processing.nodes_payload()

    assert nodes[0]["id"] == active["id"]
    assert nodes[0]["status"] == "online"
    assert nodes[1]["status"] == "offline"


def test_processing_node_can_self_register_without_admin_token(tmp_path: Path) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
        processing_registration_token="registration-secret",
    )
    client = TestClient(create_app(settings))

    registered = client.post(
        "/api/v1/processing-nodes/register",
        headers={"X-Qingshe-Processing-Registration-Token": "registration-secret"},
        json={"name": "这台 Mac", "platform": "macos"},
    )
    assert registered.status_code == 201, registered.text
    node = registered.json()
    node_headers = {"Authorization": f"Bearer {node['token']}"}

    claim = client.post("/api/v1/processing-nodes/poll", headers=node_headers)
    assert claim.status_code == 200, claim.text
    assert claim.json()["task"] is None

    dashboard = client.get(
        "/api/v1/admin/processing-dashboard",
        headers={"Authorization": "Bearer admin-secret"},
    )
    assert dashboard.status_code == 200, dashboard.text
    assert dashboard.json()["nodes"][0]["name"] == "这台 Mac"
    assert dashboard.json()["nodes"][0]["status"] == "online"


def test_processing_registration_requires_dedicated_token(tmp_path: Path) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
        processing_registration_token="registration-secret",
    )
    client = TestClient(create_app(settings))
    payload = {"name": "node", "platform": "linux"}
    assert client.post("/api/v1/processing-nodes/register", json=payload).status_code == 401
    assert client.post(
        "/api/v1/processing-nodes/register",
        headers={"X-Qingshe-Processing-Registration-Token": "admin-secret"},
        json=payload,
    ).status_code == 403
    assert client.post(
        "/api/v1/processing-nodes/register",
        headers={"X-Qingshe-Processing-Registration-Token": "registration-secret"},
        json=payload,
    ).status_code == 201


def test_processing_registration_is_disabled_when_token_unconfigured(tmp_path: Path) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))
    response = client.post(
        "/api/v1/processing-nodes/register",
        headers={"X-Qingshe-Processing-Registration-Token": "anything"},
        json={"name": "node", "platform": "linux"},
    )
    assert response.status_code == 503


def test_submission_rejects_mismatched_mime_corrupt_and_oversized_images(tmp_path: Path) -> None:
    client = _submission_client(tmp_path)
    headers = _submission_headers(client)
    metadata = {"name": "safe", "mode": "review", "idempotency_key": "img-1"}
    mismatched = client.post(
        "/api/v1/submissions",
        headers=headers,
        data={"metadata": json.dumps(metadata)},
        files={"original": ("x.jpg", _real_image_bytes(), "image/jpeg")},
    )
    assert mismatched.status_code == 415
    corrupt = client.post(
        "/api/v1/submissions",
        headers=headers,
        data={"metadata": json.dumps({**metadata, "idempotency_key": "img-2"})},
        files={"original": ("x.png", b"\x89PNG\r\n\x1a\ntruncated", "image/png")},
    )
    assert corrupt.status_code == 415
    huge = _real_image_bytes(size=(7000, 7000))
    too_many_pixels = client.post(
        "/api/v1/submissions",
        headers=headers,
        data={"metadata": json.dumps({**metadata, "idempotency_key": "img-3"})},
        files={"original": ("x.png", huge, "image/png")},
    )
    assert too_many_pixels.status_code == 415


def test_submission_idempotency_conflict_does_not_reveal_existing_token(tmp_path: Path) -> None:
    client = _submission_client(tmp_path)
    headers = _submission_headers(client)
    image = _real_image_bytes()
    first = client.post(
        "/api/v1/submissions",
        headers=headers,
        data={"metadata": json.dumps({"name": "one", "mode": "review", "idempotency_key": "same"})},
        files={"original": ("x.png", image, "image/png")},
    )
    assert first.status_code == 201, first.text
    conflict = client.post(
        "/api/v1/submissions",
        headers=headers,
        data={"metadata": json.dumps({"name": "two", "mode": "review", "idempotency_key": "same"})},
        files={"original": ("x.png", image, "image/png")},
    )
    assert conflict.status_code == 409
    assert "status_token" not in conflict.text
    retry = client.post(
        "/api/v1/submissions",
        headers=headers,
        data={"metadata": json.dumps({"name": "one", "mode": "review", "idempotency_key": "same"})},
        files={"original": ("x.png", image, "image/png")},
    )
    assert retry.status_code == 200
    assert retry.json()["submission_id"] == first.json()["submission_id"]
    assert client.get(
        f"/api/v1/submissions/{first.json()['submission_id']}",
        headers={"Authorization": f"Bearer {first.json()['status_token']}"},
    ).status_code == 200


def test_submission_status_requires_bearer_and_approval_controls_visibility(tmp_path: Path) -> None:
    client = _submission_client(tmp_path)
    submission = client.post(
        "/api/v1/submissions",
        headers=_submission_headers(client),
        data={"metadata": json.dumps({"name": "review", "mode": "review", "idempotency_key": "review-1"})},
        files={"original": ("x.png", _real_image_bytes(), "image/png")},
    )
    assert submission.status_code == 201, submission.text
    body = submission.json()
    status_url = f"/api/v1/submissions/{body['submission_id']}"
    assert client.get(status_url).status_code == 404
    status_response = client.get(
        status_url, headers={"Authorization": f"Bearer {body['status_token']}"}
    )
    assert status_response.status_code == 200
    asset_id = body["asset_id"]
    assert client.get(
        f"/api/v1/assets/{asset_id}/original",
        headers={"Authorization": "Bearer editor-secret"},
    ).status_code == 404
    approved = client.patch(
        f"/api/v1/admin/assets/{asset_id}",
        headers={"Authorization": "Bearer admin-secret"},
        json={"needs_review": False, "category": "其他"},
    )
    assert approved.status_code == 200
    assert client.get(
        f"/api/v1/assets/{asset_id}/original",
        headers={"Authorization": "Bearer editor-secret"},
    ).status_code == 200

    submissions_db = sqlite3.connect(tmp_path / "submissions.db")
    columns = [row[1] for row in submissions_db.execute("PRAGMA table_info(submissions)")]
    assert "status_token" not in columns
    assert "status_token_hash" in columns


def test_failed_processing_task_marks_submission_failed_and_cleans_incoming(tmp_path: Path) -> None:
    client = _submission_client(tmp_path)
    receipt = client.post(
        "/api/v1/submissions",
        headers=_submission_headers(client),
        data={"metadata": json.dumps({"name": "cutout", "mode": "cutout", "idempotency_key": "fail-1"})},
        files={"original": ("x.png", _real_image_bytes(), "image/png")},
    ).json()
    registered = client.post(
        "/api/v1/processing-nodes/register",
        headers={"X-Qingshe-Processing-Registration-Token": "registration-secret"},
        json={"name": "worker", "platform": "linux"},
    )
    node_headers = {"Authorization": f"Bearer {registered.json()['token']}"}
    task = client.post("/api/v1/processing-nodes/poll", headers=node_headers).json()["task"]
    raw_task_id = task["id"].partition(".")[0]
    incoming = tmp_path / "incoming" / f"{raw_task_id}.png"
    assert incoming.exists()
    other = client.post(
        "/api/v1/processing-nodes/register",
        headers={"X-Qingshe-Processing-Registration-Token": "registration-secret"},
        json={"name": "other-worker", "platform": "linux"},
    )
    wrong_headers = {"Authorization": f"Bearer {other.json()['token']}"}
    assert client.post(
        f"/api/v1/processing-tasks/{task['id']}/fail",
        headers=wrong_headers,
        json={"error": "wrong owner"},
    ).status_code == 404
    failed = client.post(
        f"/api/v1/processing-tasks/{task['id']}/fail",
        headers=node_headers,
        json={"error": "worker decode failed"},
    )
    assert failed.status_code == 200
    assert not incoming.exists()
    status_response = client.get(
        f"/api/v1/submissions/{receipt['submission_id']}",
        headers={"Authorization": f"Bearer {receipt['status_token']}"},
    )
    assert status_response.json()["status"] == "failed"
    assert status_response.json()["error"] == "投稿处理失败"


def test_approved_legacy_duplicate_stays_public_for_cutout_and_review(tmp_path: Path) -> None:
    client = _submission_client(tmp_path)
    original = _real_image_bytes()
    legacy = client.post(
        "/api/v1/admin/assets/publish",
        headers={"Authorization": "Bearer admin-secret"},
        data={"metadata": json.dumps({"name": "legacy", "category": "其他", "width": 4, "height": 3})},
        files={
            "original": ("x.png", original, "image/png"),
            "processed": ("x.png", _real_image_bytes(), "image/png"),
            "thumbnail": ("x.webp", _real_image_bytes("WEBP", (2, 2)), "image/webp"),
        },
    )
    assert legacy.status_code == 201, legacy.text
    asset_id = legacy.json()["id"]
    cutout = client.post(
        "/api/v1/submissions",
        headers=_submission_headers(client),
        data={"metadata": json.dumps({"name": "retry-cutout", "mode": "cutout", "idempotency_key": "legacy-cutout"})},
        files={"original": ("x.png", original, "image/png")},
    )
    node = client.post(
        "/api/v1/processing-nodes/register",
        headers={"X-Qingshe-Processing-Registration-Token": "registration-secret"},
        json={"name": "legacy-worker", "platform": "linux"},
    ).json()
    node_headers = {"Authorization": f"Bearer {node['token']}"}
    task = client.post("/api/v1/processing-nodes/poll", headers=node_headers).json()["task"]
    completed = client.post(
        f"/api/v1/processing-tasks/{task['id']}/complete",
        headers=node_headers,
        data={"metadata": json.dumps({"width": 4, "height": 3, "dominant_color": "#f05028"})},
        files={
            "processed": ("x.png", _real_image_bytes(), "image/png"),
            "thumbnail": ("x.webp", _real_image_bytes("WEBP", (2, 2)), "image/webp"),
        },
    )
    assert completed.status_code == 201 and completed.json()["duplicate"] is True
    cutout_status = client.get(
        f"/api/v1/submissions/{cutout.json()['submission_id']}",
        headers={"Authorization": f"Bearer {cutout.json()['status_token']}"},
    )
    assert cutout_status.json()["status"] == "approved"

    review = client.post(
        "/api/v1/submissions",
        headers=_submission_headers(client),
        data={"metadata": json.dumps({"name": "retry-review", "mode": "review", "idempotency_key": "legacy-review"})},
        files={"original": ("x.png", original, "image/png")},
    )
    assert review.status_code == 201
    assert review.json()["status"] == "approved"
    assert asset_id in [
        asset["id"]
        for asset in client.get("/api/v1/assets", headers={"Authorization": "Bearer editor-secret"}).json()["assets"]
    ]
    assert client.get(
        f"/api/v1/assets/{asset_id}/original",
        headers={"Authorization": "Bearer editor-secret"},
    ).status_code == 200


def test_processing_result_requires_real_images_and_matching_dimensions(tmp_path: Path) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))
    administrator = {"Authorization": "Bearer admin-secret"}
    node = client.post(
        "/api/v1/admin/processing-nodes/pair",
        headers=administrator,
        json={"name": "result-worker", "platform": "linux"},
    ).json()
    node_headers = {"Authorization": f"Bearer {node['token']}"}
    task = client.post(
        "/api/v1/admin/processing-tasks",
        headers=administrator,
        data={"metadata": json.dumps({"name": "result", "needs_review": True})},
        files={"original": ("x.png", b"source", "image/png")},
    ).json()
    task_id = task["id"]
    task_handle = client.post("/api/v1/processing-nodes/poll", headers=node_headers).json()[
        "task"
    ]["id"]
    assert task_handle.partition(".")[0] == task_id
    corrupt = client.post(
        f"/api/v1/processing-tasks/{task_handle}/complete",
        headers=node_headers,
        data={"metadata": json.dumps({"width": 4, "height": 3, "dominant_color": "#f05028"})},
        files={
            "processed": ("x.png", b"not-png", "image/png"),
            "thumbnail": ("x.webp", _real_image_bytes("WEBP", (2, 2)), "image/webp"),
        },
    )
    assert corrupt.status_code == 415
    mismatch = client.post(
        f"/api/v1/processing-tasks/{task_handle}/complete",
        headers=node_headers,
        data={"metadata": json.dumps({"width": 5, "height": 3, "dominant_color": "#f05028"})},
        files={
            "processed": ("x.png", _real_image_bytes(size=(4, 3)), "image/png"),
            "thumbnail": ("x.webp", _real_image_bytes("WEBP", (2, 2)), "image/webp"),
        },
    )
    assert mismatch.status_code == 422


def test_processing_node_heartbeat_refreshes_liveness_without_claiming_task(tmp_path: Path) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
        processing_registration_token="registration-secret",
    )
    client = TestClient(create_app(settings))
    administrator = {"Authorization": "Bearer admin-secret"}

    registered = client.post(
        "/api/v1/processing-nodes/register",
        headers={"X-Qingshe-Processing-Registration-Token": "registration-secret"},
        json={"name": "这台 Mac", "platform": "macos"},
    )
    assert registered.status_code == 201, registered.text
    node_headers = {"Authorization": f"Bearer {registered.json()['token']}"}
    task = client.post(
        "/api/v1/admin/processing-tasks",
        headers=administrator,
        data={"metadata": json.dumps({"name": "心跳任务", "needs_review": True})},
        files={"original": ("source.png", b"source-image", "image/png")},
    )
    assert task.status_code == 201, task.text

    heartbeat = client.post("/api/v1/processing-nodes/heartbeat", headers=node_headers)
    assert heartbeat.status_code == 200, heartbeat.text
    assert heartbeat.json() == {"ok": True}

    claimed = client.post("/api/v1/processing-nodes/poll", headers=node_headers)
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["task"]["id"].partition(".")[0] == task.json()["id"]


def test_browser_login_grants_an_http_only_admin_session(tmp_path: Path) -> None:
    salt = b"test-session-salt"
    password_hash = base64.urlsafe_b64encode(
        hashlib.pbkdf2_hmac("sha256", b"correct-password", salt, 120_000)
    ).decode("ascii")
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
        admin_username="admin-user",
        admin_password_salt=base64.urlsafe_b64encode(salt).decode("ascii"),
        admin_password_hash=password_hash,
        admin_session_secret="session-secret",
    )
    client = TestClient(create_app(settings), base_url="https://assets.xiduoduo.top")

    rejected = client.post(
        "/api/v1/auth/login", json={"username": "admin-user", "password": "wrong-password"}
    )
    assert rejected.status_code == 401

    logged_in = client.post(
        "/api/v1/auth/login", json={"username": "admin-user", "password": "correct-password"}
    )
    assert logged_in.status_code == 200, logged_in.text
    assert "httponly" in logged_in.headers["set-cookie"].lower()
    assert "samesite=strict" in logged_in.headers["set-cookie"].lower()

    dashboard = client.get("/api/v1/admin/processing-dashboard")
    assert dashboard.status_code == 200, dashboard.text

    logged_out = client.post("/api/v1/auth/logout")
    assert logged_out.status_code == 200, logged_out.text
    assert "qingshe_admin_session=" in logged_out.headers["set-cookie"]
    assert client.get("/api/v1/admin/processing-dashboard").status_code == 403


def test_browser_login_rate_limit_returns_retry_after(tmp_path: Path) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
        admin_username="admin-user",
        admin_password_salt=base64.urlsafe_b64encode(b"test-session-salt").decode("ascii"),
        admin_password_hash=base64.urlsafe_b64encode(b"not-the-password").decode("ascii"),
        admin_session_secret="session-secret",
    )
    client = TestClient(create_app(settings), base_url="https://assets.xiduoduo.top")

    for _ in range(5):
        assert client.post(
            "/api/v1/auth/login", json={"username": "admin-user", "password": "wrong"}
        ).status_code == 401
    limited = client.post(
        "/api/v1/auth/login", json={"username": "admin-user", "password": "wrong"}
    )
    assert limited.status_code == 429
    assert int(limited.headers["retry-after"]) >= 1


def test_download_limit_queues_short_bursts_instead_of_rejecting_them(tmp_path: Path) -> None:
    controls = CloudControlsStore(tmp_path)
    controls.patch(CloudControlsPatch(max_concurrent_downloads=1))
    assert controls.try_acquire_download() is None
    attempted = Event()
    results: list[str | None] = []

    def acquire_second_download() -> None:
        attempted.set()
        results.append(controls.try_acquire_download(timeout_seconds=0.5))

    waiting = Thread(target=acquire_second_download)
    waiting.start()
    assert attempted.wait(timeout=0.2)
    waiting.join(timeout=0.05)
    assert waiting.is_alive()

    controls.release_download()
    waiting.join(timeout=0.5)
    assert results == [None]
    controls.release_download()


def test_publish_and_read_asset_when_tokens_are_valid(tmp_path: Path) -> None:
    # Given: an empty cloud catalog protected by separate editor and admin tokens.
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=("http://127.0.0.1:4173",),
    )
    client = TestClient(create_app(settings))

    # When: an administrator publishes an already processed material bundle.
    response = client.post(
        "/api/v1/admin/assets/publish",
        headers={"Authorization": "Bearer admin-secret"},
        data={
            "metadata": json.dumps(
                {
                    "name": "云端花艺",
                    "category": "花艺",
                    "width": 320,
                    "height": 240,
                    "needs_review": False,
                }
            )
        },
        files={
            "original": ("source.png", b"original-image", "image/png"),
            "processed": ("processed.png", b"transparent-image", "image/png"),
            "thumbnail": ("thumbnail.webp", b"thumbnail-image", "image/webp"),
        },
    )

    # Then: the editor can read the published asset, while anonymous access is rejected.
    assert response.status_code == 201, response.text
    asset_id = response.json()["id"]
    catalog = client.get(
        "/api/v1/assets",
        headers={"Authorization": "Bearer editor-secret"},
    )
    assert catalog.status_code == 200
    assert catalog.json()["assets"][0]["id"] == asset_id
    assert catalog.headers["x-catalog-revision"] == "2"
    assert catalog.headers["etag"]
    unchanged = client.get(
        "/api/v1/assets",
        headers={
            "Authorization": "Bearer editor-secret",
            "If-None-Match": f'W/{catalog.headers["etag"]}, "stale"',
        },
    )
    assert unchanged.status_code == 304
    revision = client.get(
        "/api/v1/catalog/revision",
        headers={"Authorization": "Bearer editor-secret"},
    )
    assert revision.status_code == 200
    assert revision.json() == {"revision": 2}
    unchanged_revision = client.get(
        "/api/v1/catalog/revision",
        headers={
            "Authorization": "Bearer editor-secret",
            "If-None-Match": revision.headers["etag"],
        },
    )
    assert unchanged_revision.status_code == 304
    patched = client.patch(
        f"/api/v1/admin/assets/{asset_id}",
        headers={"Authorization": "Bearer admin-secret"},
        json={"name": "云端花艺改名"},
    )
    assert patched.status_code == 200
    changed_catalog = client.get(
        "/api/v1/assets",
        headers={
            "Authorization": "Bearer editor-secret",
            "If-None-Match": catalog.headers["etag"],
        },
    )
    assert changed_catalog.status_code == 200
    assert changed_catalog.headers["x-catalog-revision"] == "3"
    assert changed_catalog.headers["etag"] != catalog.headers["etag"]
    assert client.get("/api/v1/assets").status_code == 401
    assert client.get("/api/v1/assets", params={"access_token": "admin-secret"}).status_code == 401
    assert client.get("/api/v1/assets", params={"access_token": "editor-secret"}).status_code == 200


def test_editor_search_finds_assets_with_two_character_query(tmp_path: Path) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))
    published = client.post(
        "/api/v1/admin/assets/publish",
        headers={"Authorization": "Bearer admin-secret"},
        data={
            "metadata": json.dumps(
                {
                    "name": "别墅背景",
                    "category": "其他",
                    "width": 320,
                    "height": 240,
                    "needs_review": False,
                }
            )
        },
        files={
            "original": ("source.png", b"original-image", "image/png"),
            "processed": ("processed.png", b"transparent-image", "image/png"),
            "thumbnail": ("thumbnail.webp", b"thumbnail-image", "image/webp"),
        },
    )
    assert published.status_code == 201, published.text

    searched = client.get(
        "/api/v1/assets",
        headers={"Authorization": "Bearer editor-secret"},
        params={"query": "别墅"},
    )

    assert searched.status_code == 200, searched.text
    assert [asset["name"] for asset in searched.json()["assets"]] == ["别墅背景"]


def test_remote_processing_node_can_claim_and_complete_cloud_task(tmp_path: Path) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))
    administrator = {"Authorization": "Bearer admin-secret"}

    paired = client.post(
        "/api/v1/admin/processing-nodes/pair",
        headers=administrator,
        json={"name": "这台 Mac", "platform": "macos"},
    )
    assert paired.status_code == 201, paired.text
    node = paired.json()
    node_headers = {"Authorization": f"Bearer {node['token']}"}

    created = client.post(
        "/api/v1/admin/processing-tasks",
        headers=administrator,
        data={
            "metadata": json.dumps(
                {"name": "远程抠图花艺", "category": "花艺", "needs_review": True}
            )
        },
        files={"original": ("flower.png", b"original-image", "image/png")},
    )
    assert created.status_code == 201, created.text
    task_id = created.json()["id"]

    claim = client.post("/api/v1/processing-nodes/poll", headers=node_headers)
    assert claim.status_code == 200, claim.text
    task_handle = claim.json()["task"]["id"]
    assert task_handle.partition(".")[0] == task_id
    original = client.get(f"/api/v1/processing-tasks/{task_handle}/original", headers=node_headers)
    assert original.content == b"original-image"

    completed = client.post(
        f"/api/v1/processing-tasks/{task_handle}/complete",
        headers=node_headers,
        data={"metadata": json.dumps({"width": 320, "height": 240, "dominant_color": "#ffffff"})},
        files={
            "processed": ("processed.png", _real_image_bytes(size=(320, 240)), "image/png"),
            "thumbnail": ("thumbnail.webp", _real_image_bytes("WEBP", (2, 2)), "image/webp"),
        },
    )
    assert completed.status_code == 201, completed.text
    asset_id = completed.json()["asset_id"]

    reviewed = client.patch(
        f"/api/v1/admin/assets/{asset_id}",
        headers=administrator,
        json={"category": "其他", "needs_review": False},
    )
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json() == {"updated": True}

    dashboard = client.get("/api/v1/admin/processing-dashboard", headers=administrator)
    assert dashboard.status_code == 200, dashboard.text
    assert dashboard.json()["nodes"][0]["name"] == "这台 Mac"
    assert dashboard.json()["tasks"][0]["status"] == "ready"
    assert dashboard.json()["tasks"][0]["category"] == "其他"
    assert dashboard.json()["tasks"][0]["needs_review"] == 0


def test_extension_device_can_create_a_durable_ten_item_run(tmp_path: Path) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))
    administrator = {"Authorization": "Bearer admin-secret"}

    paired = client.post(
        "/api/v1/admin/extension-devices/pair",
        headers=administrator,
        json={"name": "Chrome on Mac", "platform": "chrome"},
    )
    assert paired.status_code == 201, paired.text
    device = paired.json()

    created = client.post(
        "/api/v1/extension-runs",
        headers={"Authorization": f"Bearer {device['token']}"},
        json={"provider": "chatgpt", "prompt": "婚庆素材", "count": 10},
    )

    assert created.status_code == 201, created.text
    run = created.json()
    assert run["provider"] == "chatgpt"
    assert run["prompt"] == "婚庆素材"
    assert run["status"] == "running"
    assert [item["ordinal"] for item in run["items"]] == list(range(1, 11))
    assert all(item["status"] == "queued" for item in run["items"])

    dashboard = client.get(
        "/api/v1/admin/processing-dashboard", headers=administrator
    ).json()
    assert dashboard["extension_devices"][0]["name"] == "Chrome on Mac"
    assert dashboard["automation_runs"][0]["total"] == 10


def test_extension_run_upload_is_idempotent_and_tracks_processing_completion(
    tmp_path: Path,
) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))
    administrator = {"Authorization": "Bearer admin-secret"}
    device = client.post(
        "/api/v1/admin/extension-devices/pair",
        headers=administrator,
        json={"name": "Firefox on Mac", "platform": "firefox"},
    ).json()
    device_headers = {"Authorization": f"Bearer {device['token']}"}
    run = client.post(
        "/api/v1/extension-runs",
        headers=device_headers,
        json={"provider": "gemini", "prompt": "婚礼花艺", "count": 1},
    ).json()
    item = run["items"][0]
    upload_url = f"/api/v1/extension-runs/{run['id']}/items/{item['id']}/upload"

    first = client.post(
        upload_url,
        headers=device_headers,
        files={"original": ("wedding.png", b"generated-image", "image/png")},
    )
    second = client.post(
        upload_url,
        headers=device_headers,
        files={"original": ("wedding.png", b"generated-image", "image/png")},
    )

    assert first.status_code == 201, first.text
    assert second.status_code == 200, second.text
    assert first.json()["task_id"] == second.json()["task_id"]
    task_id = first.json()["task_id"]

    node = client.post(
        "/api/v1/admin/processing-nodes/pair",
        headers=administrator,
        json={"name": "本机抠图器", "platform": "macos"},
    ).json()
    node_headers = {"Authorization": f"Bearer {node['token']}"}
    claimed = client.post("/api/v1/processing-nodes/poll", headers=node_headers)
    task_handle = claimed.json()["task"]["id"]
    assert task_handle.partition(".")[0] == task_id
    completed = client.post(
        f"/api/v1/processing-tasks/{task_handle}/complete",
        headers=node_headers,
        data={
            "metadata": json.dumps(
                {"width": 320, "height": 240, "dominant_color": "#ffffff"}
            )
        },
        files={
            "processed": ("processed.png", _real_image_bytes(size=(320, 240)), "image/png"),
            "thumbnail": ("thumbnail.webp", _real_image_bytes("WEBP", (2, 2)), "image/webp"),
        },
    )
    assert completed.status_code == 201, completed.text

    refreshed = client.get(
        f"/api/v1/extension-runs/{run['id']}", headers=device_headers
    ).json()
    assert refreshed["status"] == "completed"
    assert refreshed["items"][0]["status"] == "ready"
    assert refreshed["items"][0]["asset_id"] == completed.json()["asset_id"]


def test_extension_heartbeat_and_item_progress_are_scoped_to_the_paired_device(
    tmp_path: Path,
) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))
    administrator = {"Authorization": "Bearer admin-secret"}
    device = client.post(
        "/api/v1/admin/extension-devices/pair",
        headers=administrator,
        json={"name": "Chrome Studio", "platform": "chrome"},
    ).json()
    device_headers = {"Authorization": f"Bearer {device['token']}"}
    run = client.post(
        "/api/v1/extension-runs",
        headers=device_headers,
        json={"provider": "chatgpt", "prompt": "婚庆素材", "count": 2},
    ).json()
    item_url = f"/api/v1/extension-runs/{run['id']}/items/{run['items'][0]['id']}"

    assert client.patch(
        item_url, headers=administrator, json={"status": "generating"}
    ).status_code == 401
    updated = client.patch(
        item_url, headers=device_headers, json={"status": "generating"}
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["status"] == "generating"
    assert client.post(
        "/api/v1/extension-devices/heartbeat", headers=device_headers
    ).json() == {"ok": True}

    dashboard = client.get(
        "/api/v1/admin/processing-dashboard", headers=administrator
    ).json()
    assert dashboard["extension_devices"][0]["status"] == "online"
    assert dashboard["automation_runs"][0]["items"][0]["status"] == "generating"


def test_extension_device_can_cancel_its_own_run(tmp_path: Path) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))
    administrator = {"Authorization": "Bearer admin-secret"}
    device = client.post(
        "/api/v1/admin/extension-devices/pair",
        headers=administrator,
        json={"name": "Chrome Cancel", "platform": "chrome"},
    ).json()
    device_headers = {"Authorization": f"Bearer {device['token']}"}
    run = client.post(
        "/api/v1/extension-runs",
        headers=device_headers,
        json={"provider": "chatgpt", "prompt": "婚庆素材", "count": 2},
    ).json()

    cancelled = client.post(
        f"/api/v1/extension-runs/{run['id']}/cancel", headers=device_headers
    )

    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
    assert all(item["status"] == "cancelled" for item in cancelled.json()["items"])


def test_processing_dashboard_marks_stale_extension_device_offline(
    tmp_path: Path, monkeypatch
) -> None:
    from tools.asset_admin import extension_automation

    monkeypatch.setattr(
        extension_automation, "now_iso", lambda: "2020-01-01T00:00:00+00:00"
    )
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))
    administrator = {"Authorization": "Bearer admin-secret"}
    client.post(
        "/api/v1/admin/extension-devices/pair",
        headers=administrator,
        json={"name": "离线插件", "platform": "firefox"},
    )

    dashboard = client.get(
        "/api/v1/admin/processing-dashboard", headers=administrator
    ).json()
    assert dashboard["extension_devices"][0]["status"] == "offline"


def test_processor_download_serves_a_packaged_app_instead_of_python(
    tmp_path: Path, monkeypatch
) -> None:
    admin_root = tmp_path / "admin"
    downloads = admin_root / "downloads"
    downloads.mkdir(parents=True)
    artifact = downloads / "qingshe-processor-macos-aarch64.dmg"
    artifact.write_bytes(b"packaged-processor")
    monkeypatch.setenv("QINGSHE_ADMIN_STATIC", str(admin_root))
    settings = CloudSettings(
        library_root=tmp_path / "library",
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))

    response = client.get(
        "/downloads/qingshe-processor",
        headers={"User-Agent": "Mozilla/5.0 (Macintosh; Apple Silicon Mac OS X)"},
    )

    assert response.status_code == 200
    assert response.content == b"packaged-processor"
    assert "轻抠.dmg" in unquote(response.headers["content-disposition"])
    assert client.get("/downloads/qingshe-processor.py").status_code == 404


def test_processing_dashboard_marks_stale_node_offline(tmp_path: Path, monkeypatch) -> None:
    from tools.asset_admin import remote_processing

    monkeypatch.setattr(remote_processing, "now_iso", lambda: "2020-01-01T00:00:00+00:00")
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))

    paired = client.post(
        "/api/v1/admin/processing-nodes/pair",
        headers={"Authorization": "Bearer admin-secret"},
        json={"name": "离线 Mac", "platform": "macos"},
    )
    assert paired.status_code == 201, paired.text

    dashboard = client.get(
        "/api/v1/admin/processing-dashboard",
        headers={"Authorization": "Bearer admin-secret"},
    )
    assert dashboard.status_code == 200, dashboard.text
    assert dashboard.json()["nodes"][0]["status"] == "offline"


def test_processing_node_reports_which_material_panel_computer_it_belongs_to(
    tmp_path: Path,
) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))
    administrator = {"Authorization": "Bearer admin-secret"}
    paired = client.post(
        "/api/v1/admin/processing-nodes/pair",
        headers=administrator,
        json={"name": "工作室 Mac", "platform": "macos"},
    ).json()
    panel_client_id = "33333333-3333-4333-8333-333333333333"

    heartbeat = client.post(
        "/api/v1/processing-nodes/heartbeat",
        headers={
            "Authorization": f"Bearer {paired['token']}",
            "X-Qingshe-Panel-Client": panel_client_id,
        },
    )

    assert heartbeat.status_code == 200
    dashboard = client.get(
        "/api/v1/admin/processing-dashboard", headers=administrator
    ).json()
    assert dashboard["nodes"][0]["client_id"] == panel_client_id


def test_remote_processing_task_can_defer_category_to_automatic_recognition(tmp_path: Path) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))

    response = client.post(
        "/api/v1/admin/processing-tasks",
        headers={"Authorization": "Bearer admin-secret"},
        data={"metadata": json.dumps({"name": "迎宾花艺", "needs_review": False})},
        files={"original": ("flower.png", b"original-image", "image/png")},
    )

    assert response.status_code == 201, response.text
    dashboard = client.get(
        "/api/v1/admin/processing-dashboard",
        headers={"Authorization": "Bearer admin-secret"},
    )
    assert dashboard.json()["tasks"][0]["category"] == "自动识别"


def test_admin_can_publish_an_already_processed_png_without_local_service(tmp_path: Path) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))

    response = client.post(
        "/api/v1/admin/assets/publish-processed",
        headers={"Authorization": "Bearer admin-secret"},
        data={
            "metadata": json.dumps(
                {
                    "name": "外部已抠好花艺",
                    "category": "花艺",
                    "width": 320,
                    "height": 240,
                    "needs_review": False,
                }
            )
        },
        files={
            "processed": ("transparent.png", b"transparent-image", "image/png"),
            "thumbnail": ("thumbnail.webp", b"thumbnail-image", "image/webp"),
        },
    )

    assert response.status_code == 201, response.text
    asset_id = response.json()["id"]
    asset = client.get(f"/api/v1/assets/{asset_id}/processed", headers={"Authorization": "Bearer editor-secret"})
    assert asset.status_code == 200
    assert asset.content == b"transparent-image"


def test_processed_asset_uses_automatic_category_when_no_override_is_supplied(tmp_path: Path) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))

    published = client.post(
        "/api/v1/admin/assets/publish-processed",
        headers={"Authorization": "Bearer admin-secret"},
        data={
            "metadata": json.dumps(
                {"name": "迎宾花艺", "width": 320, "height": 240, "needs_review": False}
            )
        },
        files={
            "processed": ("transparent.png", b"transparent-image", "image/png"),
            "thumbnail": ("thumbnail.webp", b"thumbnail-image", "image/webp"),
        },
    )

    assert published.status_code == 201, published.text
    assets = client.get("/api/v1/assets", headers={"Authorization": "Bearer editor-secret"})
    assert assets.json()["assets"][0]["category"] == "花艺"
    assert assets.json()["assets"][0]["needs_review"] is True


def test_browser_preflight_allows_client_telemetry_headers(tmp_path: Path) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=("http://127.0.0.1:4173",),
    )
    client = TestClient(create_app(settings))

    response = client.options(
        "/api/v1/assets",
        headers={
            "Origin": "http://127.0.0.1:4173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": (
                "authorization,x-qingshe-client,x-qingshe-platform,x-qingshe-version"
            ),
        },
    )

    assert response.status_code == 200, response.text
    allowed_headers = response.headers["access-control-allow-headers"].lower()
    assert "x-qingshe-client" in allowed_headers
    assert "x-qingshe-platform" in allowed_headers
    assert "x-qingshe-version" in allowed_headers


def test_factory_loads_environment_settings(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("QINGSHE_ASSET_LIBRARY", str(tmp_path))
    monkeypatch.setenv("QINGSHE_EDITOR_TOKEN", "editor-from-env")
    monkeypatch.setenv("QINGSHE_ADMIN_TOKEN", "admin-from-env")
    monkeypatch.setenv("QINGSHE_ADMIN_USERNAME", "admin-user")
    monkeypatch.setenv("QINGSHE_ADMIN_PASSWORD_SALT", "c2FsdA==")
    monkeypatch.setenv("QINGSHE_ADMIN_PASSWORD_HASH", "aGFzaA==")
    monkeypatch.setenv("QINGSHE_ADMIN_SESSION_SECRET", "session-from-env")
    monkeypatch.setenv("QINGSHE_ALLOWED_ORIGINS", "http://localhost:4173, http://tauri.localhost")

    settings = load_settings()

    assert settings.library_root == tmp_path.resolve()
    assert settings.editor_token == "editor-from-env"
    assert settings.admin_token == "admin-from-env"
    assert settings.allowed_origins == ("http://localhost:4173", "http://tauri.localhost")


def test_editor_token_cannot_modify_catalog(tmp_path: Path) -> None:
    # Given: an editor token without administrative privileges.
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))

    # When: the editor token calls an administrative endpoint.
    response = client.post(
        "/api/v1/admin/assets/publish",
        headers={"Authorization": "Bearer editor-secret"},
        data={
            "metadata": json.dumps(
                {
                    "name": "无权限素材",
                    "category": "其他",
                    "width": 1,
                    "height": 1,
                    "needs_review": False,
                }
            )
        },
        files={
            "original": ("source.png", b"source", "image/png"),
            "processed": ("processed.png", b"processed", "image/png"),
            "thumbnail": ("thumbnail.webp", b"thumbnail", "image/webp"),
        },
    )

    # Then: the server rejects the write.
    assert response.status_code == 403, response.text


def test_admin_removes_published_asset_by_original_content_hash(tmp_path: Path) -> None:
    # Given: a cloud asset published from a local original image.
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))
    original = b"original-image"
    published = client.post(
        "/api/v1/admin/assets/publish",
        headers={"Authorization": "Bearer admin-secret"},
        data={
            "metadata": json.dumps(
                {
                    "name": "待删除云端素材",
                    "category": "花艺",
                    "width": 320,
                    "height": 240,
                    "needs_review": False,
                }
            )
        },
        files={
            "original": ("source.png", original, "image/png"),
            "processed": ("processed.png", b"transparent-image", "image/png"),
            "thumbnail": ("thumbnail.webp", b"thumbnail-image", "image/webp"),
        },
    )
    assert published.status_code == 201, published.text

    # When: the local administration flow requests deletion using that original's SHA-256 hash.
    removed = client.delete(
        "/api/v1/admin/assets/by-content-hash/27f0c6997c0fc4780eb0d9a0e8a1f5f02418196494e213a91911b54bea2816cb",
        headers={"Authorization": "Bearer admin-secret"},
    )

    # Then: the material no longer appears in the editor's ready-material catalog.
    assert removed.status_code == 200, removed.text
    assert removed.json() == {"updated": True}
    catalog = client.get("/api/v1/assets", headers={"Authorization": "Bearer editor-secret"})
    assert catalog.json() == {"assets": []}


def test_admin_observability_reports_clients_requests_and_host_capacity(tmp_path: Path) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))

    catalog = client.get(
        "/api/v1/assets",
        headers={
            "Authorization": "Bearer editor-secret",
            "X-Qingshe-Client": "device-a",
            "X-Qingshe-Platform": "macos",
            "X-Qingshe-Version": "0.1.0",
        },
    )
    assert catalog.status_code == 200
    assert client.get("/api/v1/admin/observability/summary").status_code == 403

    summary_response = client.get(
        "/api/v1/admin/observability/summary",
        headers={"Authorization": "Bearer admin-secret"},
    )
    assert summary_response.status_code == 200, summary_response.text
    summary = summary_response.json()
    assert summary["status"] in {"ready", "degraded"}
    assert summary["clients"]["active_5m"] == 1
    assert summary["requests"]["last_24h"] >= 1
    assert summary["host"]["memory"]["total_bytes"] > 0
    assert summary["host"]["disk"]["total_bytes"] > 0
    assert summary["library"]["total"] == 0


def test_observability_counts_published_library_and_media_downloads(
    tmp_path: Path, monkeypatch
) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))
    published = client.post(
        "/api/v1/admin/assets/publish",
        headers={"Authorization": "Bearer admin-secret"},
        data={
            "metadata": json.dumps(
                {
                    "name": "可观测素材",
                    "category": "花艺",
                    "width": 20,
                    "height": 10,
                    "needs_review": False,
                }
            )
        },
        files={
            "original": ("source.png", b"original-image", "image/png"),
            "processed": ("processed.png", b"transparent-image", "image/png"),
            "thumbnail": ("thumbnail.webp", b"thumbnail-image", "image/webp"),
        },
    )
    asset_id = published.json()["id"]
    monkeypatch.setattr(
        "starlette.responses.guess_type",
        lambda _path: ("application/octet-stream", None),
    )
    media = client.get(
        f"/api/v1/assets/{asset_id}/processed",
        headers={
            "Authorization": "Bearer editor-secret",
            "X-Qingshe-Client": "device-b",
            "X-Qingshe-Platform": "windows",
            "X-Qingshe-Version": "0.1.0",
        },
    )
    assert media.status_code == 200
    assert media.headers["content-type"] == "image/png"
    thumbnail = client.get(
        f"/api/v1/assets/{asset_id}/thumbnail",
        headers={"Authorization": "Bearer editor-secret"},
    )
    assert thumbnail.status_code == 200
    assert thumbnail.headers["content-type"] == "image/webp"

    summary = client.get(
        "/api/v1/admin/observability/summary",
        headers={"Authorization": "Bearer admin-secret"},
    ).json()
    assert summary["library"]["total"] == 1
    assert summary["library"]["ready"] == 1
    assert summary["library"]["bytes"] >= len(b"original-image")
    assert summary["transfers"]["downloads_24h"] == 2
    assert summary["transfers"]["download_bytes_24h"] == len(
        b"transparent-imagethumbnail-image"
    )

    clients = client.get(
        "/api/v1/admin/observability/clients",
        headers={"Authorization": "Bearer admin-secret"},
    ).json()
    assert clients["clients"][0]["platform"] == "windows"
    assert clients["clients"][0]["id"] != "device-b"

    transfers = client.get(
        "/api/v1/admin/observability/transfers",
        headers={"Authorization": "Bearer admin-secret"},
    ).json()
    assert transfers["windows"][-1]["downloads"] == 2


def test_admin_controls_persist_and_can_pause_media_downloads(tmp_path: Path) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))
    published = client.post(
        "/api/v1/admin/assets/publish",
        headers={"Authorization": "Bearer admin-secret"},
        data={
            "metadata": json.dumps(
                {
                    "name": "可控素材",
                    "category": "花艺",
                    "width": 20,
                    "height": 10,
                    "needs_review": False,
                }
            )
        },
        files={
            "original": ("source.png", b"controlled-original", "image/png"),
            "processed": ("processed.png", b"controlled-processed", "image/png"),
            "thumbnail": ("thumbnail.webp", b"controlled-thumbnail", "image/webp"),
        },
    )
    asset_id = published.json()["id"]

    assert client.patch("/api/v1/admin/controls", json={"downloads_enabled": False}).status_code == 403
    changed = client.patch(
        "/api/v1/admin/controls",
        headers={"Authorization": "Bearer admin-secret"},
        json={"downloads_enabled": False, "max_concurrent_downloads": 3},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json() == {
        "maintenance_mode": False,
        "downloads_enabled": False,
        "max_concurrent_downloads": 3,
        "active_downloads": 0,
    }

    media = client.get(
        f"/api/v1/assets/{asset_id}/processed",
        headers={"Authorization": "Bearer editor-secret"},
    )
    assert media.status_code == 503
    assert media.headers["retry-after"] == "60"
    assert client.get("/api/v1/health").json()["status"] == "degraded"

    restarted = TestClient(create_app(settings))
    summary = restarted.get(
        "/api/v1/admin/observability/summary",
        headers={"Authorization": "Bearer admin-secret"},
    ).json()
    assert summary["controls"]["downloads_enabled"] is False
    assert summary["controls"]["max_concurrent_downloads"] == 3


def test_maintenance_mode_pauses_catalog_but_keeps_health_and_admin_available(tmp_path: Path) -> None:
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
    )
    client = TestClient(create_app(settings))
    changed = client.patch(
        "/api/v1/admin/controls",
        headers={"Authorization": "Bearer admin-secret"},
        json={"maintenance_mode": True},
    )
    assert changed.status_code == 200
    catalog = client.get(
        "/api/v1/assets",
        headers={"Authorization": "Bearer editor-secret"},
    )
    assert catalog.status_code == 503
    assert client.get("/api/v1/health").json()["status"] == "maintenance"
    assert (
        client.get(
            "/api/v1/admin/observability/summary",
            headers={"Authorization": "Bearer admin-secret"},
        ).status_code
        == 200
    )


def test_cloud_control_stores_refresh_shared_state_and_merge_patches(tmp_path: Path) -> None:
    first = CloudControlsStore(tmp_path)
    second = CloudControlsStore(tmp_path)

    first.patch(CloudControlsPatch(maintenance_mode=True, max_concurrent_downloads=3))
    assert second.maintenance_mode is True
    assert second.health_status == "maintenance"

    second.patch(CloudControlsPatch(maintenance_mode=False, downloads_enabled=False))
    assert first.health_status == "degraded"
    assert first.snapshot() == {
        "maintenance_mode": False,
        "downloads_enabled": False,
        "max_concurrent_downloads": 3,
        "active_downloads": 0,
    }

    first.patch(CloudControlsPatch(downloads_enabled=True))
    assert second.health_status == "ready"
    assert second.snapshot()["max_concurrent_downloads"] == 3


def test_cloud_control_apps_refresh_shared_state_immediately(tmp_path: Path) -> None:
    def settings() -> CloudSettings:
        return CloudSettings(
            library_root=tmp_path,
            editor_token="editor-secret",
            admin_token="admin-secret",
            allowed_origins=(),
        )

    first = TestClient(create_app(settings()))
    second = TestClient(create_app(settings()))
    administrator = {"Authorization": "Bearer admin-secret"}

    changed = first.patch(
        "/api/v1/admin/controls",
        headers=administrator,
        json={"maintenance_mode": True, "max_concurrent_downloads": 3},
    )
    assert changed.status_code == 200, changed.text
    assert second.get("/api/v1/health").json() == {"status": "maintenance"}
    assert second.get("/api/v1/ready").status_code == 503

    changed = second.patch(
        "/api/v1/admin/controls",
        headers=administrator,
        json={"maintenance_mode": False, "downloads_enabled": False},
    )
    assert changed.status_code == 200, changed.text
    assert first.get("/api/v1/health").json() == {"status": "degraded"}
    assert first.get("/api/v1/ready").status_code == 503

    changed = first.patch(
        "/api/v1/admin/controls",
        headers=administrator,
        json={"downloads_enabled": True},
    )
    assert changed.status_code == 200, changed.text
    assert second.get("/api/v1/ready").json() == {"status": "ready"}
    assert second.get("/api/v1/admin/observability/summary", headers=administrator).json()[
        "controls"
    ]["max_concurrent_downloads"] == 3
