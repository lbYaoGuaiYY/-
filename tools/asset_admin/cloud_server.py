import hashlib
import hmac
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, Path as PathParameter, Query, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from tools.asset_admin.catalog import CATEGORIES, Catalog, LibraryPaths

MAX_INPUT_BYTES = 25 * 1024 * 1024
ORIGINAL_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
MediaKind = Literal["original", "processed", "thumbnail"]


@dataclass(frozen=True, slots=True)
class CloudSettings:
    library_root: Path
    editor_token: str
    admin_token: str
    allowed_origins: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class PublishFiles:
    original: UploadFile
    processed: UploadFile
    thumbnail: UploadFile


class PublishMetadata(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str = Field(min_length=1, max_length=120)
    category: str
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    needs_review: bool = False


class AssetPatch(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str | None = Field(default=None, min_length=1, max_length=120)
    category: str | None = None
    favorite: bool | None = None
    needs_review: bool | None = None


class ServiceAsset(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    code: str
    name: str
    category: str
    status: str
    mime_type: str
    width: int
    height: int
    version: int
    needs_review: bool
    favorite: bool
    dominant_color: str | None
    tags: tuple[str, ...]
    usage_count: int
    created_at: str
    updated_at: str


class AssetsResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    assets: tuple[ServiceAsset, ...]


class PublishResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    code: str
    duplicate: bool


class MutationResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    updated: bool


class CatalogRevisionResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    revision: int


class AssetQuery(BaseModel):
    model_config = ConfigDict(frozen=True)

    query: str = ""
    category: str = ""
    status: str = "ready"
    needs_review: bool | None = None
    limit: int = Field(default=120, ge=1, le=500)
    offset: int = Field(default=0, ge=0, le=1_000_000)


def load_settings() -> CloudSettings:
    editor_token = os.environ.get("QINGSHE_EDITOR_TOKEN", "")
    admin_token = os.environ.get("QINGSHE_ADMIN_TOKEN", "")
    if not editor_token or not admin_token:
        raise RuntimeError("QINGSHE_EDITOR_TOKEN and QINGSHE_ADMIN_TOKEN are required")
    origins = tuple(
        value.strip()
        for value in os.environ.get("QINGSHE_ALLOWED_ORIGINS", "").split(",")
        if value.strip()
    )
    return CloudSettings(
        library_root=Path(os.environ.get("QINGSHE_ASSET_LIBRARY", "/data")).resolve(),
        editor_token=editor_token,
        admin_token=admin_token,
        allowed_origins=origins,
    )


def etag_matches(header_value: str | None, current_etag: str) -> bool:
    if header_value is None:
        return False
    if header_value.strip() == "*":
        return True
    normalized_current = current_etag.removeprefix('W/')
    return any(
        candidate.strip().removeprefix("W/") == normalized_current
        for candidate in header_value.split(",")
    )
async def read_publish_files(
    original: Annotated[UploadFile, File()],
    processed: Annotated[UploadFile, File()],
    thumbnail: Annotated[UploadFile, File()],
) -> PublishFiles:
    return PublishFiles(original=original, processed=processed, thumbnail=thumbnail)


async def read_limited(upload: UploadFile) -> bytes:
    content = await upload.read(MAX_INPUT_BYTES + 1)
    if not content or len(content) > MAX_INPUT_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "文件必须小于 25 MB")
    return content


def atomic_write(path: Path, content: bytes) -> None:
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_bytes(content)
    os.replace(temporary, path)


def create_app(settings: CloudSettings | None = None) -> FastAPI:
    active_settings = settings or load_settings()
    paths = LibraryPaths.create(active_settings.library_root)
    catalog = Catalog(paths)
    bearer = HTTPBearer(auto_error=False)
    app = FastAPI(title="轻设云端素材库", version="1.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(active_settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "If-None-Match"],
        expose_headers=["ETag", "X-Catalog-Revision"],
    )

    def require_editor(
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
        access_token: Annotated[str | None, Query()] = None,
    ) -> None:
        token = credentials.credentials if credentials is not None else access_token
        valid = token is not None and (
            hmac.compare_digest(token, active_settings.editor_token)
            or hmac.compare_digest(token, active_settings.admin_token)
        )
        if not valid:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "素材读取凭证无效")

    def require_admin(
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ) -> None:
        if credentials is None or not hmac.compare_digest(
            credentials.credentials, active_settings.admin_token
        ):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "素材管理凭证无效")

    @app.get("/api/v1/health")
    def health() -> dict[str, str]:
        return {"status": "ready"}

    @app.get("/api/v1/catalog/revision", dependencies=[Depends(require_editor)])
    def catalog_revision(request: Request) -> Response:
        revision = catalog.revision()
        etag = f'"{revision}"'
        headers = {"Cache-Control": "no-cache", "ETag": etag}
        if etag_matches(request.headers.get("if-none-match"), etag):
            return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
        return JSONResponse(
            content=CatalogRevisionResponse(revision=revision).model_dump(),
            headers=headers,
        )

    @app.get("/api/v1/assets", dependencies=[Depends(require_editor)])
    def list_assets(filters: Annotated[AssetQuery, Query()], request: Request) -> Response:
        rows, revision = catalog.list_assets_with_revision(
            filters.query,
            filters.category,
            filters.status,
            filters.needs_review,
            filters.limit,
            filters.offset,
        )
        query_key = json.dumps(filters.model_dump(), ensure_ascii=False, sort_keys=True)
        etag = f'"{revision}-{hashlib.sha256(query_key.encode("utf-8")).hexdigest()[:16]}"'
        headers = {
            "Cache-Control": "no-cache",
            "ETag": etag,
            "X-Catalog-Revision": str(revision),
        }
        if etag_matches(request.headers.get("if-none-match"), etag):
            return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
        payload = AssetsResponse(
            assets=tuple(ServiceAsset.model_validate(row) for row in rows)
        ).model_dump()
        return JSONResponse(content=payload, headers=headers)

    @app.get("/api/v1/assets/{asset_id}/{kind}", dependencies=[Depends(require_editor)])
    def read_asset(asset_id: str, kind: MediaKind) -> FileResponse:
        path = catalog.asset_path(asset_id, kind)
        if path is None or not path.is_file():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "素材文件不存在")
        stat = path.stat()
        headers = {
            "Cache-Control": "public, max-age=31536000, immutable",
            "ETag": f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"',
        }
        return FileResponse(path, headers=headers)

    @app.post(
        "/api/v1/admin/assets/publish",
        response_model=PublishResponse,
        status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(require_admin)],
    )
    async def publish_asset(
        metadata_json: Annotated[str, Form(alias="metadata")],
        files: Annotated[PublishFiles, Depends(read_publish_files)],
    ) -> PublishResponse:
        try:
            metadata = PublishMetadata.model_validate_json(metadata_json)
        except ValidationError as error:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "素材信息格式无效"
            ) from error
        if metadata.category not in CATEGORIES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "素材分类无效")
        mime_type = files.original.content_type or ""
        extension = ORIGINAL_EXTENSIONS.get(mime_type)
        if extension is None:
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "原图格式无效")
        if files.processed.content_type != "image/png":
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "透明成品必须是 PNG")
        if files.thumbnail.content_type != "image/webp":
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "缩略图必须是 WebP")
        original, processed, thumbnail = await files_content(files)
        digest = hashlib.sha256(original).hexdigest()
        original_path = paths.originals / f"{digest}{extension}"
        if not original_path.exists():
            atomic_write(original_path, original)
        result = catalog.create_asset(
            name=metadata.name,
            mime_type=mime_type,
            content_hash=digest,
            original_path=original_path,
        )
        if bool(result["duplicate"]):
            return PublishResponse.model_validate(result)
        asset_id = str(result["id"])
        processed_path = paths.processed / f"{asset_id}.png"
        thumbnail_path = paths.thumbnails / f"{asset_id}.webp"
        atomic_write(processed_path, processed)
        atomic_write(thumbnail_path, thumbnail)
        catalog.complete_job(
            str(result["job_id"]),
            asset_id,
            status="ready",
            category=metadata.category,
            needs_review=int(metadata.needs_review),
            width=metadata.width,
            height=metadata.height,
            processed_path=str(processed_path),
            thumbnail_path=str(thumbnail_path),
            tags=json.dumps([metadata.category], ensure_ascii=False),
        )
        return PublishResponse(id=asset_id, code=str(result["code"]), duplicate=False)

    @app.patch("/api/v1/admin/assets/{asset_id}", dependencies=[Depends(require_admin)])
    def patch_asset(asset_id: str, payload: AssetPatch) -> MutationResponse:
        if payload.category is not None and payload.category not in CATEGORIES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "素材分类无效")
        return MutationResponse(
            updated=catalog.patch_asset(asset_id, payload.model_dump(exclude_none=True))
        )

    @app.delete("/api/v1/admin/assets/{asset_id}", dependencies=[Depends(require_admin)])
    def delete_asset(asset_id: str) -> MutationResponse:
        return MutationResponse(updated=catalog.set_deleted(asset_id, True))

    @app.delete(
        "/api/v1/admin/assets/by-content-hash/{content_hash}",
        dependencies=[Depends(require_admin)],
    )
    def delete_asset_by_content_hash(
        content_hash: Annotated[str, PathParameter(pattern=r"^[a-f0-9]{64}$")],
    ) -> MutationResponse:
        return MutationResponse(updated=catalog.set_deleted_by_content_hash(content_hash))

    @app.post("/api/v1/admin/assets/{asset_id}/restore", dependencies=[Depends(require_admin)])
    def restore_asset(asset_id: str) -> MutationResponse:
        return MutationResponse(updated=catalog.set_deleted(asset_id, False))

    return app


async def files_content(files: PublishFiles) -> tuple[bytes, bytes, bytes]:
    return (
        await read_limited(files.original),
        await read_limited(files.processed),
        await read_limited(files.thumbnail),
    )
