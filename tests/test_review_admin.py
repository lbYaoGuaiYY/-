import json
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from tools.asset_admin.catalog import CATEGORIES
from tools.asset_admin.cloud_server import CloudSettings, create_app


def _image_bytes(color: tuple[int, int, int] = (240, 80, 40)) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (4, 3), color).save(buffer, format="PNG")
    return buffer.getvalue()


def _client(tmp_path: Path) -> TestClient:
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


def _submission_headers(client: TestClient, client_id: str) -> dict[str, str]:
    identity = {"X-Qingshe-Client": client_id}
    session = client.post("/api/v1/submission-sessions", headers=identity)
    assert session.status_code == 201, session.text
    return {**identity, "Authorization": f"Bearer {session.json()['upload_token']}"}


def _publish(client: TestClient, name: str, original: bytes) -> str:
    response = client.post(
        "/api/v1/admin/assets/publish",
        headers={"Authorization": "Bearer admin-secret"},
        data={
            "metadata": json.dumps(
                {"name": name, "category": CATEGORIES[-1], "width": 4, "height": 3}
            )
        },
        files={
            "original": (f"{name}.png", original, "image/png"),
            "processed": (f"{name}.png", original, "image/png"),
            "thumbnail": (f"{name}.webp", original, "image/webp"),
        },
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def test_review_submission_appears_in_admin_dashboard_and_can_be_approved(
    tmp_path: Path,
) -> None:
    client = _client(tmp_path)
    submission = client.post(
        "/api/v1/submissions",
        headers=_submission_headers(client, "8f03cde7-3d26-4a41-a245-42fb6a358e81"),
        data={
            "metadata": json.dumps(
                {"name": "review-only", "mode": "review", "idempotency_key": "review-1"}
            )
        },
        files={"original": ("review.png", _image_bytes(), "image/png")},
    )
    assert submission.status_code == 201, submission.text
    receipt = submission.json()
    assert receipt["status"] == "pending_review"
    assert receipt["asset_id"]

    dashboard = client.get(
        "/api/v1/admin/processing-dashboard",
        headers={"Authorization": "Bearer admin-secret"},
    )
    assert dashboard.status_code == 200, dashboard.text
    assert dashboard.json()["tasks"] == []
    pending = dashboard.json()["pending_review_assets"]
    assert [asset["id"] for asset in pending] == [receipt["asset_id"]]

    approved = client.patch(
        f"/api/v1/admin/assets/{receipt['asset_id']}",
        headers={"Authorization": "Bearer admin-secret"},
        json={"category": CATEGORIES[-1], "needs_review": False},
    )
    assert approved.status_code == 200, approved.text
    status_response = client.get(
        f"/api/v1/submissions/{receipt['submission_id']}",
        headers={"Authorization": f"Bearer {receipt['status_token']}"},
    )
    assert status_response.json()["status"] == "approved"

    catalog = client.get(
        "/api/v1/assets", headers={"Authorization": "Bearer editor-secret"}
    )
    assert receipt["asset_id"] in [asset["id"] for asset in catalog.json()["assets"]]
    media = client.get(
        f"/api/v1/assets/{receipt['asset_id']}/processed",
        headers={"Authorization": "Bearer editor-secret"},
    )
    assert media.status_code == 200, media.text


def test_public_pagination_skips_hidden_assets_without_losing_later_public_rows(
    tmp_path: Path,
) -> None:
    client = _client(tmp_path)
    public_ids = [
        _publish(client, "public-1", _image_bytes((220, 40, 40))),
        _publish(client, "public-2", _image_bytes((40, 220, 40))),
    ]
    headers = _submission_headers(client, "8f03cde7-3d26-4a41-a245-42fb6a358e82")
    for index in range(3):
        response = client.post(
            "/api/v1/submissions",
            headers=headers,
            data={
                "metadata": json.dumps(
                    {
                        "name": f"hidden-{index}",
                        "mode": "review",
                        "idempotency_key": f"hidden-{index}",
                    }
                )
            },
            files={
                "original": (
                    f"hidden-{index}.png",
                    _image_bytes((40, 40 + index, 220)),
                    "image/png",
                )
            },
        )
        assert response.status_code == 201, response.text

    editor_headers = {"Authorization": "Bearer editor-secret"}
    first_page = client.get("/api/v1/assets?limit=1&offset=0", headers=editor_headers)
    second_page = client.get("/api/v1/assets?limit=1&offset=1", headers=editor_headers)
    assert first_page.status_code == second_page.status_code == 200
    assert [asset["id"] for asset in first_page.json()["assets"]] == [public_ids[1]]
    assert [asset["id"] for asset in second_page.json()["assets"]] == [public_ids[0]]
