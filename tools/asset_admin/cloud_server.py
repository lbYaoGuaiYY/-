import hashlib
import hmac
import json
import os
import time
import base64
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, Path as PathParameter, Query, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.background import BackgroundTask
from starlette.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from tools.asset_admin.catalog import CATEGORIES, Catalog, LibraryPaths
from tools.asset_admin.cloud_controls import CloudControlsPatch, CloudControlsStore
from tools.asset_admin.extension_automation import ExtensionAutomationStore
from tools.asset_admin.observability import ObservabilityStore, RequestRecord
from tools.asset_admin.remote_processing import RemoteProcessingStore

MAX_INPUT_BYTES = 25 * 1024 * 1024
DEFAULT_ADMIN_USERNAME = "lbYaoGuai"
DEFAULT_ADMIN_PASSWORD_SALT = "33GXQfzVUDH_Gxvbr5FxAA=="
DEFAULT_ADMIN_PASSWORD_HASH = "kghDb6NgnaYRCQqfd8SKEeGNbOLhogs8RHy3RC_odIc="
ORIGINAL_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
MediaKind = Literal["original", "processed", "thumbnail"]
MEDIA_TYPES_BY_SUFFIX = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}
AUTOMATIC_CATEGORY = "自动识别"
AUTOMATIC_CATEGORY_HINTS = {
    "花艺": ("花艺", "花朵", "鲜花", "花束", "floral", "flower", "bouquet"),
    "家具": ("家具", "桌椅", "椅子", "桌子", "furniture", "chair", "table"),
    "标识": ("标识", "标牌", "迎宾牌", "signage", "sign", "welcome"),
    "绿植": ("绿植", "植物", "树叶", "plant", "foliage", "tree"),
    "地面": ("地面", "地毯", "地垫", "floor", "carpet", "mat"),
    "灯具": ("灯具", "吊灯", "蜡烛", "lamp", "light", "chandelier", "candle"),
    "布艺": ("布艺", "窗帘", "幕布", "fabric", "curtain", "drape", "textile"),
}


@dataclass(frozen=True, slots=True)
class CloudSettings:
    library_root: Path
    editor_token: str
    admin_token: str
    allowed_origins: tuple[str, ...]
    admin_username: str = ""
    admin_password_salt: str = ""
    admin_password_hash: str = ""
    admin_session_secret: str = ""


@dataclass(frozen=True, slots=True)
class PublishFiles:
    original: UploadFile
    processed: UploadFile
    thumbnail: UploadFile


class PublishMetadata(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str = Field(min_length=1, max_length=120)
    category: str | None = None
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    needs_review: bool = False


class AdminLoginRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=512)


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


class NodePairRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str = Field(min_length=1, max_length=80)
    platform: Literal["macos", "windows", "linux"]


class ExtensionDevicePairRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str = Field(min_length=1, max_length=80)
    platform: Literal["chrome", "firefox", "edge"]


class AutomationRunRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    provider: Literal["chatgpt", "gemini"]
    prompt: str = Field(min_length=1, max_length=4000)
    count: int = Field(ge=1, le=50)
    category: str | None = None


class AutomationItemUpdateRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: Literal["queued", "generating", "uploading", "failed"]
    error: str | None = Field(default=None, max_length=1000)


class ProcessingTaskMetadata(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str = Field(min_length=1, max_length=120)
    category: str | None = None
    needs_review: bool = True


class ProcessingResultMetadata(BaseModel):
    model_config = ConfigDict(frozen=True)

    width: int = Field(gt=0)
    height: int = Field(gt=0)
    dominant_color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


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
        admin_username=os.environ.get("QINGSHE_ADMIN_USERNAME") or DEFAULT_ADMIN_USERNAME,
        admin_password_salt=os.environ.get("QINGSHE_ADMIN_PASSWORD_SALT") or DEFAULT_ADMIN_PASSWORD_SALT,
        admin_password_hash=os.environ.get("QINGSHE_ADMIN_PASSWORD_HASH") or DEFAULT_ADMIN_PASSWORD_HASH,
        admin_session_secret=os.environ.get("QINGSHE_ADMIN_SESSION_SECRET") or admin_token,
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


def category_for_ingestion(category: str | None) -> tuple[str, bool]:
    """Keep automatic classification distinguishable until the material is reviewed."""
    if category is None or category == "":
        return AUTOMATIC_CATEGORY, True
    return category, False


def automatic_category_for_name(name: str) -> str:
    normalized = name.casefold()
    for category, hints in AUTOMATIC_CATEGORY_HINTS.items():
        if any(hint in normalized for hint in hints):
            return category
    return "其他"


def category_for_completed_asset(category: str, name: str) -> tuple[str, bool]:
    if category == AUTOMATIC_CATEGORY:
        return automatic_category_for_name(name), True
    return category, False


def category_for_direct_publish(category: str | None, name: str) -> tuple[str, bool]:
    if category is None or category == "":
        return automatic_category_for_name(name), True
    return category, False


def create_app(settings: CloudSettings | None = None) -> FastAPI:
    active_settings = settings or load_settings()
    paths = LibraryPaths.create(active_settings.library_root)
    catalog = Catalog(paths)
    observability = ObservabilityStore(active_settings.library_root, active_settings.admin_token)
    controls = CloudControlsStore(active_settings.library_root)
    processing = RemoteProcessingStore(active_settings.library_root)
    automation = ExtensionAutomationStore(active_settings.library_root)
    bearer = HTTPBearer(auto_error=False)
    app = FastAPI(title="轻设云端素材库", version="1.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(active_settings.allowed_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "If-None-Match",
            "X-Qingshe-Client",
            "X-Qingshe-Platform",
            "X-Qingshe-Version",
            "X-Qingshe-Panel-Client",
        ],
        expose_headers=["ETag", "X-Catalog-Revision"],
    )
    admin_static_directory = Path(
        os.environ.get("QINGSHE_ADMIN_STATIC", "/app/admin")
    )
    app.mount(
        "/admin",
        StaticFiles(directory=admin_static_directory, html=True, check_dir=False),
        name="asset-admin",
    )
    app.mount(
        "/assets",
        StaticFiles(directory=admin_static_directory / "assets", html=False, check_dir=False),
        name="public-product-assets",
    )
    @app.get("/downloads/qingshe-processor", include_in_schema=False)
    def download_processing_agent(
        request: Request,
        platform: Literal["macos", "windows"] | None = Query(default=None),
    ) -> FileResponse:
        """Download the packaged background-removal companion for this computer."""
        requested_platform = platform
        if requested_platform is None:
            requested_platform = (
                "windows" if "windows" in request.headers.get("user-agent", "").lower() else "macos"
            )
        artifact_name, download_name, media_type = (
            (
                "qingshe-processor-windows-x64.exe",
                "轻抠.exe",
                "application/vnd.microsoft.portable-executable",
            )
            if requested_platform == "windows"
            else (
                "qingshe-processor-macos-aarch64.dmg",
                "轻抠.dmg",
                "application/x-apple-diskimage",
            )
        )
        artifact = admin_static_directory / "downloads" / artifact_name
        if not artifact.is_file():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "抠图器安装包尚未发布")
        return FileResponse(artifact, media_type=media_type, filename=download_name)

    @app.get("/", include_in_schema=False)
    def product_home() -> FileResponse:
        """Serve the public product page at the assets subdomain root."""
        product_page = admin_static_directory / "product.html"
        if not product_page.exists():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "产品页尚未部署")
        return FileResponse(product_page, media_type="text/html")

    @app.middleware("http")
    async def record_observability(request: Request, call_next):
        started_at = time.perf_counter()
        response = await call_next(request)
        observability.record(
            RequestRecord(
                path_group=observability.path_group(request.url.path),
                status_code=response.status_code,
                duration_ms=(time.perf_counter() - started_at) * 1000,
                response_bytes=int(response.headers.get("content-length", "0") or 0),
                client_id=request.headers.get("x-qingshe-client"),
                platform=request.headers.get("x-qingshe-platform"),
                version=request.headers.get("x-qingshe-version"),
            )
        )
        return response

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

    def session_is_valid(value: str | None) -> bool:
        if value is None or active_settings.admin_session_secret == "":
            return False
        try:
            expires_text, signature = value.split(".", 1)
            expires = int(expires_text)
        except (TypeError, ValueError):
            return False
        expected = hmac.new(
            active_settings.admin_session_secret.encode("utf-8"),
            expires_text.encode("ascii"),
            hashlib.sha256,
        ).hexdigest()
        return expires > int(time.time()) and hmac.compare_digest(signature, expected)

    def password_is_valid(password: str) -> bool:
        if (
            active_settings.admin_password_salt == ""
            or active_settings.admin_password_hash == ""
        ):
            return False
        try:
            salt = base64.urlsafe_b64decode(active_settings.admin_password_salt.encode("ascii"))
            expected = base64.urlsafe_b64decode(active_settings.admin_password_hash.encode("ascii"))
        except (ValueError, UnicodeEncodeError):
            return False
        candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
        return hmac.compare_digest(candidate, expected)

    def require_admin(
        request: Request,
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ) -> None:
        bearer_is_valid = credentials is not None and hmac.compare_digest(
            credentials.credentials, active_settings.admin_token
        )
        if not bearer_is_valid and not session_is_valid(request.cookies.get("qingshe_admin_session")):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "素材管理凭证无效")

    def require_node(
        request: Request,
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ) -> str:
        if credentials is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "处理节点凭证无效")
        node_id = processing.authenticate_node(
            credentials.credentials,
            request.headers.get("X-Qingshe-Panel-Client"),
        )
        if node_id is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "处理节点凭证无效")
        return node_id

    def require_extension_device(
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ) -> str:
        if credentials is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "浏览器插件凭证无效")
        device_id = automation.authenticate_device(credentials.credentials)
        if device_id is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "浏览器插件凭证无效")
        return device_id

    @app.get("/api/v1/health")
    def health() -> dict[str, str]:
        return {"status": controls.health_status}

    @app.post("/api/v1/auth/login")
    def login(payload: AdminLoginRequest, response: Response) -> dict[str, bool]:
        if active_settings.admin_username == "" or active_settings.admin_session_secret == "":
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "管理登录尚未配置")
        username_is_valid = hmac.compare_digest(payload.username, active_settings.admin_username)
        if not username_is_valid or not password_is_valid(payload.password):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "账号或密码错误")
        expires = str(int(time.time()) + 12 * 60 * 60)
        signature = hmac.new(
            active_settings.admin_session_secret.encode("utf-8"),
            expires.encode("ascii"),
            hashlib.sha256,
        ).hexdigest()
        response.set_cookie(
            key="qingshe_admin_session",
            value=f"{expires}.{signature}",
            max_age=12 * 60 * 60,
            httponly=True,
            secure=True,
            samesite="strict",
            path="/api/v1",
        )
        return {"authenticated": True}

    @app.get(
        "/api/v1/admin/observability/summary", dependencies=[Depends(require_admin)]
    )
    def observability_summary() -> dict[str, object]:
        return {
            **observability.summary(catalog.statistics()),
            "controls": controls.snapshot(),
        }

    @app.get(
        "/api/v1/admin/observability/clients", dependencies=[Depends(require_admin)]
    )
    def observability_clients() -> dict[str, object]:
        return observability.clients_payload()

    @app.get(
        "/api/v1/admin/observability/transfers", dependencies=[Depends(require_admin)]
    )
    def observability_transfers() -> dict[str, object]:
        return observability.transfers_payload()

    @app.patch("/api/v1/admin/controls", dependencies=[Depends(require_admin)])
    def patch_controls(payload: CloudControlsPatch) -> dict[str, int | bool]:
        return controls.patch(payload)

    @app.post(
        "/api/v1/admin/processing-nodes/pair",
        status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(require_admin)],
    )
    def pair_processing_node(payload: NodePairRequest) -> dict[str, str]:
        return processing.pair_node(payload.name, payload.platform)

    @app.post(
        "/api/v1/processing-nodes/register",
        status_code=status.HTTP_201_CREATED,
    )
    def register_processing_node(payload: NodePairRequest) -> dict[str, str]:
        """Allow a local cutout worker to come online without admin pairing."""
        return processing.register_node(payload.name, payload.platform)

    @app.post(
        "/api/v1/admin/extension-devices/pair",
        status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(require_admin)],
    )
    def pair_extension_device(payload: ExtensionDevicePairRequest) -> dict[str, str]:
        return automation.pair_device(payload.name, payload.platform)

    @app.post("/api/v1/extension-devices/heartbeat")
    def extension_device_heartbeat(
        _device_id: Annotated[str, Depends(require_extension_device)],
    ) -> dict[str, bool]:
        return {"ok": True}

    @app.post("/api/v1/extension-runs", status_code=status.HTTP_201_CREATED)
    def create_extension_run(
        payload: AutomationRunRequest,
        device_id: Annotated[str, Depends(require_extension_device)],
    ) -> dict[str, object]:
        if payload.category is not None and payload.category not in CATEGORIES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "素材分类无效")
        return automation.create_run(
            device_id,
            provider=payload.provider,
            prompt=payload.prompt,
            count=payload.count,
            category=payload.category,
        )

    @app.get("/api/v1/extension-runs/{run_id}")
    def read_extension_run(
        run_id: str, device_id: Annotated[str, Depends(require_extension_device)]
    ) -> dict[str, object]:
        payload = automation.run_payload(run_id, device_id)
        if payload is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "自动运行不存在")
        return payload

    @app.post("/api/v1/extension-runs/{run_id}/cancel")
    def cancel_extension_run(
        run_id: str, device_id: Annotated[str, Depends(require_extension_device)]
    ) -> dict[str, object]:
        payload = automation.cancel_run(run_id, device_id)
        if payload is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "自动运行不存在")
        return payload

    @app.patch("/api/v1/extension-runs/{run_id}/items/{item_id}")
    def update_extension_run_item(
        run_id: str,
        item_id: str,
        payload: AutomationItemUpdateRequest,
        device_id: Annotated[str, Depends(require_extension_device)],
    ) -> dict[str, object]:
        try:
            item = automation.update_item(
                run_id,
                item_id,
                device_id,
                status=payload.status,
                error=payload.error,
            )
        except ValueError as error:
            raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error
        if item is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "自动运行项不存在")
        return item

    @app.post(
        "/api/v1/extension-runs/{run_id}/items/{item_id}/upload",
        status_code=status.HTTP_201_CREATED,
    )
    async def upload_extension_run_item(
        run_id: str,
        item_id: str,
        response: Response,
        original: Annotated[UploadFile, File()],
        device_id: Annotated[str, Depends(require_extension_device)],
    ) -> dict[str, str | bool]:
        mime_type = original.content_type or ""
        extension = ORIGINAL_EXTENSIONS.get(mime_type)
        if extension is None:
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "原图格式无效")
        content = await read_limited(original)

        def create_item_task(run: dict[str, object], item: dict[str, object]) -> dict[str, str]:
            prompt = str(run["prompt"])
            ordinal = int(item["ordinal"])
            configured_category = run.get("category")
            category = (
                str(configured_category)
                if configured_category is not None
                else automatic_category_for_name(prompt)
            )
            return processing.create_task(
                original=content,
                original_mime=mime_type,
                extension=extension,
                name=f"{prompt[:112]} {ordinal:02d}",
                category=category,
                needs_review=False,
            )

        result = automation.get_or_create_processing_task(
            run_id, item_id, device_id, create_item_task
        )
        if result is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "自动运行项不存在")
        task_id, created = result
        if not created:
            response.status_code = status.HTTP_200_OK
        return {"task_id": task_id, "created": created}

    @app.get(
        "/api/v1/admin/processing-dashboard", dependencies=[Depends(require_admin)]
    )
    def processing_dashboard() -> dict[str, object]:
        return {
            "nodes": processing.nodes_payload(),
            "tasks": processing.tasks_payload(),
            "extension_devices": automation.devices_payload(),
            "automation_runs": automation.runs_payload(),
        }

    @app.post(
        "/api/v1/admin/processing-tasks",
        status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(require_admin)],
    )
    async def create_processing_task(
        metadata_json: Annotated[str, Form(alias="metadata")],
        original: Annotated[UploadFile, File()],
    ) -> dict[str, str]:
        try:
            metadata = ProcessingTaskMetadata.model_validate_json(metadata_json)
        except ValidationError as error:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "入库任务信息无效") from error
        if metadata.category is not None and metadata.category not in CATEGORIES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "素材分类无效")
        category, needs_review = category_for_ingestion(metadata.category)
        mime_type = original.content_type or ""
        extension = ORIGINAL_EXTENSIONS.get(mime_type)
        if extension is None:
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "原图格式无效")
        return processing.create_task(
            original=await read_limited(original),
            original_mime=mime_type,
            extension=extension,
            name=metadata.name,
            category=category,
            needs_review=metadata.needs_review or needs_review,
        )

    @app.post("/api/v1/processing-nodes/poll")
    def poll_processing_node(node_id: Annotated[str, Depends(require_node)]) -> dict[str, object]:
        task = processing.claim_task(node_id)
        if task is None:
            return {"task": None}
        return {
            "task": {
                "id": task.id,
                "name": task.name,
                "category": task.category,
                "needs_review": task.needs_review,
            }
        }

    @app.post("/api/v1/processing-nodes/heartbeat")
    def heartbeat_processing_node(
        _node_id: Annotated[str, Depends(require_node)],
    ) -> dict[str, bool]:
        """Refresh node liveness without claiming another processing task."""
        return {"ok": True}

    @app.get("/api/v1/processing-tasks/{task_id}/original")
    def read_processing_original(
        task_id: str, node_id: Annotated[str, Depends(require_node)]
    ) -> FileResponse:
        task = processing.task_for_node(task_id, node_id)
        if task is None or not task.original_path.is_file():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "处理任务不存在")
        return FileResponse(task.original_path, media_type=task.original_mime)

    @app.post("/api/v1/processing-tasks/{task_id}/complete", status_code=status.HTTP_201_CREATED)
    async def complete_processing_task(
        task_id: str,
        metadata_json: Annotated[str, Form(alias="metadata")],
        processed: Annotated[UploadFile, File()],
        thumbnail: Annotated[UploadFile, File()],
        node_id: Annotated[str, Depends(require_node)],
    ) -> dict[str, str | bool | None]:
        task = processing.task_for_node(task_id, node_id)
        if task is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "处理任务不存在")
        try:
            metadata = ProcessingResultMetadata.model_validate_json(metadata_json)
        except ValidationError as error:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "处理结果信息无效") from error
        if processed.content_type != "image/png" or thumbnail.content_type != "image/webp":
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "处理结果格式无效")
        processed_content, thumbnail_content = await read_limited(processed), await read_limited(thumbnail)
        result = catalog.create_asset(
            name=task.name,
            mime_type=task.original_mime,
            content_hash=task.content_hash,
            original_path=task.original_path,
        )
        asset_id = str(result["id"])
        if not bool(result["duplicate"]):
            category, automatic_review = category_for_completed_asset(task.category, task.name)
            processed_path = paths.processed / f"{asset_id}.png"
            thumbnail_path = paths.thumbnails / f"{asset_id}.webp"
            atomic_write(processed_path, processed_content)
            atomic_write(thumbnail_path, thumbnail_content)
            catalog.complete_job(
                str(result["job_id"]),
                asset_id,
                status="ready",
                category=category,
                needs_review=int(task.needs_review or automatic_review),
                width=metadata.width,
                height=metadata.height,
                processed_path=str(processed_path),
                thumbnail_path=str(thumbnail_path),
                dominant_color=metadata.dominant_color,
                tags=json.dumps([category], ensure_ascii=False),
            )
        if not processing.complete_task(task_id, node_id, asset_id):
            raise HTTPException(status.HTTP_409_CONFLICT, "处理任务状态已变化")
        automation.complete_processing_task(task_id, asset_id)
        return {"asset_id": asset_id, "duplicate": bool(result["duplicate"])}

    @app.get("/api/v1/catalog/revision", dependencies=[Depends(require_editor)])
    def catalog_revision(request: Request) -> Response:
        if controls.maintenance_mode:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "素材云正在维护，请稍后重试",
                headers={"Retry-After": "60"},
            )
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
        if controls.maintenance_mode:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "素材云正在维护，请稍后重试",
                headers={"Retry-After": "60"},
            )
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
        blocked_reason = controls.try_acquire_download()
        if blocked_reason is not None:
            status_code = (
                status.HTTP_429_TOO_MANY_REQUESTS
                if blocked_reason == "busy"
                else status.HTTP_503_SERVICE_UNAVAILABLE
            )
            raise HTTPException(
                status_code,
                "素材下载暂不可用，请稍后重试",
                headers={"Retry-After": "5" if blocked_reason == "busy" else "60"},
            )
        path = catalog.asset_path(asset_id, kind)
        if path is None or not path.is_file():
            controls.release_download()
            raise HTTPException(status.HTTP_404_NOT_FOUND, "素材文件不存在")
        stat = path.stat()
        headers = {
            "Cache-Control": "public, max-age=31536000, immutable",
            "ETag": f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"',
        }
        return FileResponse(
            path,
            media_type=MEDIA_TYPES_BY_SUFFIX.get(path.suffix.lower(), "application/octet-stream"),
            headers=headers,
            background=BackgroundTask(controls.release_download),
        )

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
        if metadata.category is not None and metadata.category not in CATEGORIES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "素材分类无效")
        category, needs_review = category_for_direct_publish(metadata.category, metadata.name)
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
            category=category,
            needs_review=int(metadata.needs_review or needs_review),
            width=metadata.width,
            height=metadata.height,
            processed_path=str(processed_path),
            thumbnail_path=str(thumbnail_path),
            tags=json.dumps([category], ensure_ascii=False),
        )
        return PublishResponse(id=asset_id, code=str(result["code"]), duplicate=False)

    @app.post(
        "/api/v1/admin/assets/publish-processed",
        response_model=PublishResponse,
        status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(require_admin)],
    )
    async def publish_processed_asset(
        metadata_json: Annotated[str, Form(alias="metadata")],
        processed: Annotated[UploadFile, File()],
        thumbnail: Annotated[UploadFile, File()],
    ) -> PublishResponse:
        try:
            metadata = PublishMetadata.model_validate_json(metadata_json)
        except ValidationError as error:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "素材信息格式无效") from error
        if metadata.category is not None and metadata.category not in CATEGORIES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "素材分类无效")
        category, needs_review = category_for_direct_publish(metadata.category, metadata.name)
        if processed.content_type != "image/png" or thumbnail.content_type != "image/webp":
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "请上传透明 PNG 与 WebP 缩略图")
        processed_content = await read_limited(processed)
        thumbnail_content = await read_limited(thumbnail)
        digest = hashlib.sha256(processed_content).hexdigest()
        original_path = paths.originals / f"{digest}.png"
        if not original_path.exists():
            atomic_write(original_path, processed_content)
        result = catalog.create_asset(
            name=metadata.name,
            mime_type="image/png",
            content_hash=digest,
            original_path=original_path,
        )
        if bool(result["duplicate"]):
            return PublishResponse.model_validate(result)
        asset_id = str(result["id"])
        processed_path = paths.processed / f"{asset_id}.png"
        thumbnail_path = paths.thumbnails / f"{asset_id}.webp"
        atomic_write(processed_path, processed_content)
        atomic_write(thumbnail_path, thumbnail_content)
        catalog.complete_job(
            str(result["job_id"]),
            asset_id,
            status="ready",
            category=category,
            needs_review=int(metadata.needs_review or needs_review),
            width=metadata.width,
            height=metadata.height,
            processed_path=str(processed_path),
            thumbnail_path=str(thumbnail_path),
            tags=json.dumps([category], ensure_ascii=False),
        )
        return PublishResponse(id=asset_id, code=str(result["code"]), duplicate=False)

    @app.patch("/api/v1/admin/assets/{asset_id}", dependencies=[Depends(require_admin)])
    def patch_asset(asset_id: str, payload: AssetPatch) -> MutationResponse:
        if payload.category is not None and payload.category not in CATEGORIES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "素材分类无效")
        updated = catalog.patch_asset(asset_id, payload.model_dump(exclude_none=True))
        if updated and payload.needs_review is False:
            processing.resolve_asset_review(asset_id, payload.category)
        return MutationResponse(updated=updated)

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

    app.mount(
        "/downloads",
        StaticFiles(directory=admin_static_directory / "downloads", html=False, check_dir=False),
        name="public-product-downloads",
    )

    return app


async def files_content(files: PublishFiles) -> tuple[bytes, bytes, bytes]:
    return (
        await read_limited(files.original),
        await read_limited(files.processed),
        await read_limited(files.thumbnail),
    )
