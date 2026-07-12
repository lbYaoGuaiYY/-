import json
from pathlib import Path

from fastapi.testclient import TestClient

from tools.asset_admin.cloud_server import CloudSettings, create_app, load_settings


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


def test_factory_loads_environment_settings(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("QINGSHE_ASSET_LIBRARY", str(tmp_path))
    monkeypatch.setenv("QINGSHE_EDITOR_TOKEN", "editor-from-env")
    monkeypatch.setenv("QINGSHE_ADMIN_TOKEN", "admin-from-env")
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
