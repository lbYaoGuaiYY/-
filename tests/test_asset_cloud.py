import json
from pathlib import Path

from fastapi.testclient import TestClient

from tools.asset_admin.cloud_server import CloudSettings, create_app


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
    assert client.get("/api/v1/assets").status_code == 401


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
