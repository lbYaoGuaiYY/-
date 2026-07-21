import json
import sqlite3
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from tools.asset_admin.cloud_server import (
    CloudSettings,
    create_app,
    hash_anonymous_identifier,
    issue_upload_capability,
    verify_upload_capability,
)
from tools.asset_admin.submissions import SubmissionStore


CLIENT_A = "8f03cde7-3d26-4a41-a245-42fb6a358e81"
CLIENT_B = "9f03cde7-3d26-4a41-a245-42fb6a358e82"


def image_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (4, 3), (240, 80, 40)).save(buffer, format="PNG")
    return buffer.getvalue()


def client(tmp_path: Path) -> TestClient:
    return TestClient(
        create_app(
            CloudSettings(
                library_root=tmp_path,
                editor_token="editor-secret",
                admin_token="admin-secret",
                allowed_origins=(),
                submission_token="submission-secret",
            )
        )
    )


def headers(client_id: str = CLIENT_A) -> dict[str, str]:
    return {"X-Qingshe-Client": client_id}


def session_token(api: TestClient, client_id: str = CLIENT_A) -> str:
    response = api.post("/api/v1/submission-sessions", headers=headers(client_id))
    assert response.status_code == 201, response.text
    return response.json()["upload_token"]


def post_review(
    api: TestClient,
    token: str,
    key: str,
    client_id: str = CLIENT_A,
    name: str = "review",
):
    return api.post(
        "/api/v1/submissions",
        headers={**headers(client_id), "Authorization": f"Bearer {token}"},
        data={
            "metadata": json.dumps(
                {"name": name, "mode": "review", "idempotency_key": key}
            )
        },
        files={"original": ("x.png", image_bytes(), "image/png")},
    )


def test_submission_session_requires_uuid_client_and_legacy_header_is_rejected(tmp_path: Path):
    api = client(tmp_path)
    assert api.post("/api/v1/submission-sessions").status_code == 401
    assert api.post(
        "/api/v1/submission-sessions", headers={"X-Qingshe-Client": "not-a-uuid"}
    ).status_code == 401
    assert api.post(
        "/api/v1/submissions",
        headers={"X-Qingshe-Submission-Token": "submission-secret", **headers()},
    ).status_code in {401, 422}


def test_upload_capability_is_signed_expiring_and_client_bound():
    token, expires_at = issue_upload_capability("secret", CLIENT_A, now=1000, ttl_seconds=600)
    assert expires_at == 1600
    assert verify_upload_capability("secret", token, CLIENT_A, now=1001)
    assert not verify_upload_capability("secret", token[:-1] + "x", CLIENT_A, now=1001)
    assert not verify_upload_capability("secret", token, CLIENT_B, now=1001)
    assert not verify_upload_capability("secret", token, CLIENT_A, now=1600)


def test_valid_capability_upload_and_status_token_are_independent(tmp_path: Path):
    api = client(tmp_path)
    upload_token = session_token(api)
    response = post_review(api, upload_token, "valid-1")
    assert response.status_code == 201, response.text
    receipt = response.json()
    status_response = api.get(
        f"/api/v1/submissions/{receipt['submission_id']}",
        headers={"Authorization": f"Bearer {receipt['status_token']}"},
    )
    assert status_response.status_code == 200
    assert api.get(
        f"/api/v1/submissions/{receipt['submission_id']}",
        headers={"Authorization": f"Bearer {upload_token}"},
    ).status_code == 404


def test_daily_quota_is_atomic_and_idempotent_retry_does_not_consume_again(tmp_path: Path):
    api = client(tmp_path)
    upload_token = session_token(api)
    first = post_review(api, upload_token, "quota-0")
    assert first.status_code == 201
    retry = post_review(api, upload_token, "quota-0")
    assert retry.status_code == 200
    assert retry.json()["submission_id"] == first.json()["submission_id"]
    for index in range(1, 20):
        assert post_review(api, upload_token, f"quota-{index}").status_code == 201
    limited = post_review(api, upload_token, "quota-20")
    assert limited.status_code == 429
    assert limited.headers.get("retry-after") == "86400"


def test_session_rate_limit_does_not_consume_other_bucket_on_rejection(tmp_path: Path):
    store = SubmissionStore(tmp_path)
    assert (
        store.consume_session_rate_limit(
            client_hash="client-a", remote_hash="remote-a", now_epoch=1_700_000_000,
            client_limit=2, remote_limit=1,
        )
        is None
    )
    # The remote bucket is full. The new client bucket must remain at zero,
    # despite being checked in the same request.
    assert (
        store.consume_session_rate_limit(
            client_hash="client-b", remote_hash="remote-a", now_epoch=1_700_000_001,
            client_limit=2, remote_limit=1,
        )
        is not None
    )
    with store._connection:  # noqa: SLF001 - inspect durable atomic counter
        row = store._connection.execute(  # noqa: SLF001
            "SELECT count FROM submission_session_rate_limit "
            "WHERE bucket='client' AND bucket_hash='client-b'"
        ).fetchone()
    assert row is None or row["count"] == 0
    assert (
        store.consume_session_rate_limit(
            client_hash="client-b", remote_hash="remote-b", now_epoch=1_700_000_001,
            client_limit=2, remote_limit=1,
        )
        is None
    )


def test_forwarded_ip_is_used_only_for_the_pinned_caddy_peer(tmp_path: Path):
    settings = CloudSettings(
        library_root=tmp_path,
        editor_token="editor-secret",
        admin_token="admin-secret",
        allowed_origins=(),
        submission_token="submission-secret",
        trusted_proxy_ips=("172.30.232.3/32",),
    )
    trusted = TestClient(create_app(settings), client=("172.30.232.3", 50000))
    assert trusted.post(
        "/api/v1/submission-sessions",
        headers={
            **headers(),
            "X-Qingshe-Client-IP": "203.0.113.42",
            "X-Forwarded-For": "192.0.2.123, 203.0.113.42",
        },
    ).status_code == 201

    with sqlite3.connect(tmp_path / "submissions.db") as connection:
        remote_hashes = {
            str(row[0])
            for row in connection.execute(
                "SELECT bucket_hash FROM submission_session_rate_limit WHERE bucket='remote'"
            )
        }
    assert hash_anonymous_identifier("203.0.113.42") in remote_hashes

    untrusted = TestClient(create_app(settings), client=("198.51.100.7", 50000))
    assert untrusted.post(
        "/api/v1/submission-sessions",
        headers={
            **headers(CLIENT_B),
            "X-Qingshe-Client-IP": "203.0.113.99",
            "X-Forwarded-For": "203.0.113.99",
        },
    ).status_code == 201
    with sqlite3.connect(tmp_path / "submissions.db") as connection:
        remote_hashes = {
            str(row[0])
            for row in connection.execute(
                "SELECT bucket_hash FROM submission_session_rate_limit WHERE bucket='remote'"
            )
        }
    assert hash_anonymous_identifier("198.51.100.7") in remote_hashes
    assert hash_anonymous_identifier("203.0.113.99") not in remote_hashes
