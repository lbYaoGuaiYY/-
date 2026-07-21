import hashlib
import hmac
import json
import os
import time
import base64
import ipaddress
import secrets
import shutil
import warnings
from dataclasses import dataclass, replace
from io import BytesIO
from pathlib import Path
from threading import Lock
from typing import Annotated, Literal
from uuid import RFC_4122, UUID

from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, Path as PathParameter, Query, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.background import BackgroundTask
from starlette.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from PIL import Image, ImageFile
from PIL.Image import DecompressionBombError, DecompressionBombWarning

from tools.asset_admin.catalog import CATEGORIES, Catalog, LibraryPaths
from tools.asset_admin.cloud_controls import CloudControlsPatch, CloudControlsStore
from tools.asset_admin.extension_automation import ExtensionAutomationStore
from tools.asset_admin.observability import ObservabilityStore, RequestRecord
from tools.asset_admin.remote_processing import RemoteProcessingStore
from tools.asset_admin.submissions import (
    SubmissionConflict,
    SubmissionQuotaExceeded,
    SubmissionStore,
)

MAX_INPUT_BYTES = 25 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
UPLOAD_CAPABILITY_TTL_SECONDS = 10 * 60
UPLOAD_CAPABILITY_REFRESH_SECONDS = 30
SUBMISSION_CLIENT_DAILY_LIMIT = 20
SUBMISSION_REMOTE_DAILY_LIMIT = 60
SUBMISSION_SESSION_CLIENT_MINUTE_LIMIT = 10
SUBMISSION_SESSION_REMOTE_MINUTE_LIMIT = 30
SUBMISSION_MIN_FREE_BYTES = 50 * 1024 * 1024
_UPLOAD_CAPABILITY_VERSION = "v1"
_CLIENT_ID_HEADER = "x-qingshe-client"
_IMAGE_VALIDATION_LOCK = Lock()
# Multipart framing and metadata overhead is deliberately bounded separately
# from the per-file 25 MB limit.  These limits run before Starlette spools file
# parts to disk, so a hostile request cannot bypass read_limited().
MAX_MULTIPART_OVERHEAD = 1 * 1024 * 1024
UPLOAD_REQUEST_LIMITS = {
    "/api/v1/submissions": MAX_INPUT_BYTES + MAX_MULTIPART_OVERHEAD,
    "/api/v1/admin/processing-tasks": MAX_INPUT_BYTES + MAX_MULTIPART_OVERHEAD,
    "/api/v1/extension-runs/": MAX_INPUT_BYTES + MAX_MULTIPART_OVERHEAD,
    "/api/v1/admin/assets/publish": 3 * MAX_INPUT_BYTES + 2 * MAX_MULTIPART_OVERHEAD,
    "/api/v1/admin/assets/publish-processed": 2 * MAX_INPUT_BYTES + 2 * MAX_MULTIPART_OVERHEAD,
    "/api/v1/processing-tasks/": 2 * MAX_INPUT_BYTES + MAX_MULTIPART_OVERHEAD,
}
LOGIN_RATE_LIMIT = 5
LOGIN_RATE_WINDOW_SECONDS = 60
LOGIN_FAILURE_DELAY_SECONDS = 0.25
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
    submission_token: str = ""
    processing_registration_token: str = ""
    admin_username: str = ""
    admin_password_salt: str = ""
    admin_password_hash: str = ""
    admin_session_secret: str = ""
    trusted_proxy_ips: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class PublishFiles:
    original: UploadFile
    processed: UploadFile
    thumbnail: UploadFile


@dataclass(frozen=True, slots=True)
class SubmissionRequestContext:
    client_id: str
    client_hash: str
    remote_hash: str


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


class SubmissionMetadata(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str = Field(min_length=1, max_length=120)
    category: str | None = None
    mode: Literal["cutout", "review"] = "cutout"
    idempotency_key: str = Field(min_length=1, max_length=200)


class SubmissionSessionRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    platform: str | None = Field(default=None, max_length=32)
    version: str | None = Field(default=None, max_length=64)


class SubmissionSessionResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    upload_token: str
    expires_at: int


class SubmissionResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    submission_id: str
    status: Literal["queued", "processing", "pending_review", "approved", "failed"]
    status_token: str
    asset_id: str | None = None


class SubmissionStatusResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    submission_id: str
    status: Literal["queued", "processing", "pending_review", "approved", "failed"]
    asset_id: str | None = None
    error: str | None = None


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
    required = (
        "QINGSHE_EDITOR_TOKEN",
        "QINGSHE_ADMIN_TOKEN",
        "QINGSHE_ADMIN_USERNAME",
        "QINGSHE_ADMIN_PASSWORD_SALT",
        "QINGSHE_ADMIN_PASSWORD_HASH",
        "QINGSHE_ADMIN_SESSION_SECRET",
    )
    missing = tuple(key for key in required if not os.environ.get(key, "").strip())
    if missing:
        raise RuntimeError(f"required cloud settings are missing: {', '.join(missing)}")
    editor_token = os.environ["QINGSHE_EDITOR_TOKEN"]
    admin_token = os.environ["QINGSHE_ADMIN_TOKEN"]
    origins = tuple(
        value.strip()
        for value in os.environ.get("QINGSHE_ALLOWED_ORIGINS", "").split(",")
        if value.strip()
    )
    trusted_proxy_ips = tuple(
        value.strip()
        for value in os.environ.get("QINGSHE_TRUSTED_PROXY_IPS", "").split(",")
        if value.strip()
    )
    return CloudSettings(
        library_root=Path(os.environ.get("QINGSHE_ASSET_LIBRARY", "/data")).resolve(),
        editor_token=editor_token,
        admin_token=admin_token,
        allowed_origins=origins,
        submission_token=os.environ.get("QINGSHE_SUBMISSION_TOKEN", ""),
        processing_registration_token=os.environ.get(
            "QINGSHE_PROCESSING_REGISTRATION_TOKEN", ""
        ),
        admin_username=os.environ["QINGSHE_ADMIN_USERNAME"],
        admin_password_salt=os.environ["QINGSHE_ADMIN_PASSWORD_SALT"],
        admin_password_hash=os.environ["QINGSHE_ADMIN_PASSWORD_HASH"],
        admin_session_secret=os.environ["QINGSHE_ADMIN_SESSION_SECRET"],
        trusted_proxy_ips=trusted_proxy_ips,
    )


def _urlsafe_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _urlsafe_decode(value: str) -> bytes:
    decoded = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    if _urlsafe_encode(decoded) != value:
        raise ValueError("non-canonical base64")
    return decoded


def normalize_client_id(value: str | None) -> str | None:
    """Return the canonical UUID used by the existing anonymous client identity."""
    if value is None:
        return None
    try:
        parsed = UUID(value.strip())
        if parsed.variant != RFC_4122 or parsed.version is None:
            return None
        return str(parsed)
    except (AttributeError, TypeError, ValueError):
        return None


def issue_upload_capability(
    secret: str,
    client_id: str,
    *,
    now: int | None = None,
    ttl_seconds: int = UPLOAD_CAPABILITY_TTL_SECONDS,
) -> tuple[str, int]:
    """Issue a short-lived HMAC capability without persisting its raw value."""
    issued_at = int(time.time()) if now is None else int(now)
    expires_at = issued_at + max(1, int(ttl_seconds))
    nonce = _urlsafe_encode(secrets.token_bytes(18))
    payload = f"{_UPLOAD_CAPABILITY_VERSION}.{client_id}.{expires_at}.{nonce}"
    signature = hmac.new(secret.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest()
    return f"{_urlsafe_encode(payload.encode('ascii'))}.{_urlsafe_encode(signature)}", expires_at


def verify_upload_capability(
    secret: str,
    token: str | None,
    client_id: str,
    *,
    now: int | None = None,
) -> bool:
    """Verify an upload capability, including expiry and client binding."""
    if not secret or not token:
        return False
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
        payload_bytes = _urlsafe_decode(encoded_payload)
        signature = _urlsafe_decode(encoded_signature)
        payload = payload_bytes.decode("ascii")
        version, bound_client, expires_text, nonce = payload.split(".", 3)
        expires_at = int(expires_text)
        if (
            version != _UPLOAD_CAPABILITY_VERSION
            or bound_client != client_id
            or not nonce
            or expires_at <= (int(time.time()) if now is None else int(now))
        ):
            return False
        expected = hmac.new(secret.encode("utf-8"), payload_bytes, hashlib.sha256).digest()
        return hmac.compare_digest(signature, expected)
    except (UnicodeDecodeError, ValueError, TypeError):
        return False


def hash_anonymous_identifier(value: str) -> str:
    """Hash an anonymous abuse-control key; raw values are never persisted."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


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


class RequestBodyTooLarge(Exception):
    """Raised by the receive wrapper before Starlette parses multipart data."""


def upload_request_limit(path: str) -> int | None:
    exact = UPLOAD_REQUEST_LIMITS.get(path)
    if exact is not None:
        return exact
    for prefix, limit in UPLOAD_REQUEST_LIMITS.items():
        if path.startswith(prefix):
            return limit
    return None


class InvalidSubmissionImage(ValueError):
    """The upload is not a safe, decodable image matching its MIME type."""


def validate_submission_image(content: bytes, mime_type: str) -> tuple[int, int]:
    """Validate image bytes, format declaration, dimensions, and full decoding."""
    signatures = {
        "image/jpeg": lambda value: value.startswith(b"\xff\xd8\xff"),
        "image/png": lambda value: value.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": lambda value: (
            len(value) >= 12 and value[:4] == b"RIFF" and value[8:12] == b"WEBP"
        ),
    }
    signature = signatures.get(mime_type)
    if signature is None or not signature(content):
        raise InvalidSubmissionImage

    with _IMAGE_VALIDATION_LOCK:
        previous_truncated = ImageFile.LOAD_TRUNCATED_IMAGES
        ImageFile.LOAD_TRUNCATED_IMAGES = False
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", DecompressionBombWarning)
                try:
                    with Image.open(BytesIO(content)) as image:
                        expected_format = {
                            "image/jpeg": "JPEG",
                            "image/png": "PNG",
                            "image/webp": "WEBP",
                        }[mime_type]
                        if image.format != expected_format:
                            raise InvalidSubmissionImage
                        width, height = image.size
                        if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
                            raise InvalidSubmissionImage
                        image.verify()
                    # verify() does not decode pixel data; load() catches truncated
                    # and malformed payloads that pass container-level checks.
                    with Image.open(BytesIO(content)) as decoded:
                        if decoded.format != expected_format:
                            raise InvalidSubmissionImage
                        decoded.load()
                except (
                    DecompressionBombError,
                    DecompressionBombWarning,
                    OSError,
                    ValueError,
                ) as error:
                    raise InvalidSubmissionImage from error
        finally:
            ImageFile.LOAD_TRUNCATED_IMAGES = previous_truncated
    return width, height


class UploadBodyLimitMiddleware:
    """Cap upload request bodies before multipart parts are spooled by Starlette."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        limit = upload_request_limit(str(scope.get("path", "")))
        if limit is None:
            await self.app(scope, receive, send)
            return
        headers = {
            key.lower(): value
            for key, value in scope.get("headers", [])
        }
        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                if int(content_length) > limit:
                    await send(
                        {
                            "type": "http.response.start",
                            "status": status.HTTP_413_CONTENT_TOO_LARGE,
                            "headers": [(b"content-type", b"application/json")],
                        }
                    )
                    await send(
                        {
                            "type": "http.response.body",
                            "body": b'{"detail":"request body exceeds upload limit"}',
                        }
                    )
                    return
            except ValueError:
                # Let the server parser handle malformed Content-Length.
                pass

        response_started = False

        async def guarded_send(message):
            nonlocal response_started
            if message.get("type") == "http.response.start":
                response_started = True
            await send(message)

        total = 0

        async def guarded_receive():
            nonlocal total
            message = await receive()
            if message.get("type") == "http.request":
                total += len(message.get("body", b""))
                if total > limit:
                    raise RequestBodyTooLarge
            return message

        try:
            await self.app(scope, guarded_receive, guarded_send)
        except RequestBodyTooLarge:
            if not response_started:
                await send(
                    {
                        "type": "http.response.start",
                        "status": status.HTTP_413_CONTENT_TOO_LARGE,
                        "headers": [(b"content-type", b"application/json")],
                    }
                )
                await send(
                    {
                        "type": "http.response.body",
                        "body": b'{"detail":"request body exceeds upload limit"}',
                    }
                )


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


def processing_task_handle(task_id: str, lease_owner: str) -> str:
    return f"{task_id}.{lease_owner}"


def parse_processing_task_handle(value: str) -> tuple[str, str | None]:
    task_id, separator, lease_owner = value.partition(".")
    return task_id, lease_owner if separator and lease_owner else None


def create_app(settings: CloudSettings | None = None) -> FastAPI:
    active_settings = settings or load_settings()
    paths = LibraryPaths.create(active_settings.library_root)
    catalog = Catalog(paths)
    observability = ObservabilityStore(active_settings.library_root, active_settings.admin_token)
    controls = CloudControlsStore(active_settings.library_root)
    processing = RemoteProcessingStore(active_settings.library_root)
    submissions = SubmissionStore(active_settings.library_root)
    automation = ExtensionAutomationStore(active_settings.library_root)

    def reconcile_processing_completions() -> None:
        for task_id, asset_id in processing.pending_completion_outbox():
            try:
                asset = catalog.get_asset(asset_id)
                if asset is None:
                    continue
                submission = submissions.get_by_task(task_id)
                if submission is not None:
                    submission_status = (
                        "approved"
                        if str(asset.get("status")) == "ready"
                        and not bool(asset.get("needs_review"))
                        else "pending_review"
                    )
                    submissions.mark_task_complete(
                        task_id, asset_id, status=submission_status
                    )
                processing.remove_task_original(task_id)
                automation.complete_processing_task(task_id, asset_id)
                processing.acknowledge_completion(task_id)
            except Exception:  # noqa: BLE001
                # The durable outbox remains for the next health poll/startup.
                continue

    reconcile_processing_completions()
    bearer = HTTPBearer(auto_error=False)
    login_attempts: dict[str, list[float]] = {}
    login_attempts_lock = Lock()
    app = FastAPI(title="轻设云端素材库", version="1.0.0")
    app.add_middleware(UploadBodyLimitMiddleware)
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
            "X-Qingshe-Processing-Registration-Token",
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
        if credentials is not None:
            token = credentials.credentials
            valid = hmac.compare_digest(token, active_settings.editor_token) or hmac.compare_digest(
                token, active_settings.admin_token
            )
        else:
            # Query-string access is retained for legacy media/catalog clients,
            # but an admin credential must never enter URL logs.
            valid = access_token is not None and hmac.compare_digest(
                access_token, active_settings.editor_token
            )
        if not valid:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "素材读取凭证无效")

    def client_id_from_request(request: Request) -> str:
        client_id = normalize_client_id(request.headers.get(_CLIENT_ID_HEADER))
        if client_id is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "submission client identity invalid")
        return client_id

    def remote_address(request: Request) -> str:
        """Use forwarding headers only when the direct proxy peer is trusted."""
        peer = request.client.host if request.client is not None else "unknown"
        trusted = False
        try:
            peer_ip = ipaddress.ip_address(peer)
            for configured in active_settings.trusted_proxy_ips:
                try:
                    if peer_ip in ipaddress.ip_network(configured, strict=False):
                        trusted = True
                        break
                except ValueError:
                    continue
        except ValueError:
            pass
        if trusted:
            # Caddy overwrites this private hop header with its already parsed
            # `{client_ip}` value. Never parse the left edge of a forwarded
            # chain here: a CDN/client can otherwise prepend a spoofed value.
            forwarded = request.headers.get("x-qingshe-client-ip")
            if forwarded:
                try:
                    return str(ipaddress.ip_address(forwarded.strip()))
                except ValueError:
                    pass
        return peer

    def enforce_login_rate_limit(request: Request) -> None:
        """Limit password attempts per source address without persisting credentials."""
        now = time.monotonic()
        key = remote_address(request)
        with login_attempts_lock:
            attempts = [
                attempt
                for attempt in login_attempts.get(key, [])
                if now - attempt < LOGIN_RATE_WINDOW_SECONDS
            ]
            if len(attempts) >= LOGIN_RATE_LIMIT:
                retry_after = max(
                    1,
                    int(LOGIN_RATE_WINDOW_SECONDS - (now - attempts[0])) + 1,
                )
                login_attempts[key] = attempts
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    "登录尝试过于频繁，请稍后重试",
                    headers={"Retry-After": str(retry_after)},
                )
            attempts.append(now)
            login_attempts[key] = attempts

    def submission_context(request: Request) -> SubmissionRequestContext:
        if active_settings.submission_token == "":
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "submission service is not configured")
        client_id = client_id_from_request(request)
        return SubmissionRequestContext(
            client_id=client_id,
            client_hash=hash_anonymous_identifier(client_id),
            remote_hash=hash_anonymous_identifier(remote_address(request)),
        )

    def require_submission_capability(
        request: Request,
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ) -> SubmissionRequestContext:
        context = submission_context(request)
        if credentials is None or not verify_upload_capability(
            active_settings.submission_token,
            credentials.credentials if credentials is not None else None,
            context.client_id,
        ):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "submission capability invalid")
        return context

    def ensure_submission_capacity() -> None:
        try:
            free_bytes = shutil.disk_usage(active_settings.library_root).free
        except OSError as error:
            raise HTTPException(
                status.HTTP_507_INSUFFICIENT_STORAGE,
                "submission storage state unavailable",
            ) from error
        if free_bytes < SUBMISSION_MIN_FREE_BYTES:
            raise HTTPException(
                status.HTTP_507_INSUFFICIENT_STORAGE,
                "submission storage capacity is exhausted",
            )

    def require_processing_registration(request: Request) -> None:
        """Authenticate enrollment with a dedicated, constant-time token."""
        configured = active_settings.processing_registration_token
        if configured == "":
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "处理节点注册服务尚未配置",
            )
        token = request.headers.get("X-Qingshe-Processing-Registration-Token")
        if token is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "处理节点注册凭证缺失")
        if not hmac.compare_digest(token, configured):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "处理节点注册凭证无效")

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
        reconcile_processing_completions()
        return {"status": controls.health_status}

    @app.get("/api/v1/ready")
    def ready() -> dict[str, str]:
        service_status = controls.health_status
        if service_status != "ready":
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={"status": service_status},
                headers={"Retry-After": "5"},
            )
        return {"status": service_status}

    @app.post(
        "/api/v1/submission-sessions",
        response_model=SubmissionSessionResponse,
        status_code=status.HTTP_201_CREATED,
    )
    def create_submission_session(
        request: Request,
        _payload: SubmissionSessionRequest | None = Body(default=None),
    ) -> SubmissionSessionResponse:
        context = submission_context(request)
        retry_after = submissions.consume_session_rate_limit(
            client_hash=context.client_hash,
            remote_hash=context.remote_hash,
            client_limit=SUBMISSION_SESSION_CLIENT_MINUTE_LIMIT,
            remote_limit=SUBMISSION_SESSION_REMOTE_MINUTE_LIMIT,
        )
        if retry_after is not None:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "submission session rate limit exceeded",
                headers={"Retry-After": str(retry_after)},
            )
        upload_token, expires_at = issue_upload_capability(
            active_settings.submission_token, context.client_id
        )
        return SubmissionSessionResponse(upload_token=upload_token, expires_at=expires_at)

    @app.post(
        "/api/v1/submissions",
        response_model=SubmissionResponse,
        status_code=status.HTTP_201_CREATED,
    )
    async def create_submission(
        response: Response,
        metadata_json: Annotated[str, Form(alias="metadata")],
        original: Annotated[UploadFile, File()],
        context: Annotated[SubmissionRequestContext, Depends(require_submission_capability)],
    ) -> SubmissionResponse:
        ensure_submission_capacity()
        try:
            metadata = SubmissionMetadata.model_validate_json(metadata_json)
        except ValidationError as error:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "投稿信息格式无效"
            ) from error
        if metadata.category is not None and metadata.category not in CATEGORIES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "素材分类无效")

        mime_type = original.content_type or ""
        extension = ORIGINAL_EXTENSIONS.get(mime_type)
        if extension is None:
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "原图格式无效")
        content = await read_limited(original)
        try:
            image_width, image_height = validate_submission_image(content, mime_type)
        except InvalidSubmissionImage as error:
            raise HTTPException(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "原图内容与声明格式不匹配或无法解码"
            ) from error
        content_hash = hashlib.sha256(content).hexdigest()
        category, _automatic_review = category_for_ingestion(metadata.category)
        initial_status = "pending_review" if metadata.mode == "review" else "queued"
        try:
            submission, created = submissions.create_or_get(
                idempotency_key=metadata.idempotency_key,
                content_hash=content_hash,
                mode=metadata.mode,
                name=metadata.name,
                category=category,
                needs_review=True,
                status=initial_status,
                client_id_hash=context.client_hash,
                quota_buckets=(
                    ("client", context.client_hash, SUBMISSION_CLIENT_DAILY_LIMIT),
                    ("remote", context.remote_hash, SUBMISSION_REMOTE_DAILY_LIMIT),
                ),
            )
        except SubmissionQuotaExceeded as error:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "anonymous submission quota exceeded",
                headers={"Retry-After": "86400"},
            ) from error
        except SubmissionConflict as error:
            raise HTTPException(status.HTTP_409_CONFLICT, "幂等键已用于不同投稿") from error
        if not created:
            response.status_code = status.HTTP_200_OK
            return SubmissionResponse(
                submission_id=submission.id,
                status=submission.status,  # type: ignore[arg-type]
                status_token=submission.status_token or "",
                asset_id=submission.asset_id,
            )

        if metadata.mode == "cutout":
            try:
                task = processing.create_task(
                    original=content,
                    original_mime=mime_type,
                    extension=extension,
                    name=metadata.name,
                    category=category,
                    needs_review=True,
                )
                submissions.bind_task(submission.id, str(task["id"]))
            except Exception as error:
                submissions.mark_failed(submission.id, str(error))
                raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "投稿处理失败") from error
        else:
            # Review-only submissions are normalized into the catalog directly;
            # an administrator still has to approve them before publication.
            original_path = paths.originals / f"{content_hash}{extension}"
            try:
                if not original_path.exists():
                    atomic_write(original_path, content)
                result = catalog.create_asset(
                    name=metadata.name,
                    mime_type=mime_type,
                    content_hash=content_hash,
                    original_path=original_path,
                )
                asset_id = str(result["id"])
                approved = bool(result.get("needs_review") is not None and not result.get("needs_review"))
                if not bool(result["duplicate"]):
                    completed_category, _ = category_for_completed_asset(category, metadata.name)
                    catalog_completed = catalog.complete_job(
                        str(result["job_id"]),
                        asset_id,
                        status="ready",
                        category=completed_category,
                        needs_review=1,
                        width=image_width,
                        height=image_height,
                        processed_path=str(original_path),
                        thumbnail_path=str(original_path),
                        tags=json.dumps([completed_category], ensure_ascii=False),
                    )
                    if not catalog_completed:
                        raise HTTPException(status.HTTP_409_CONFLICT, "Catalog job state has changed")
                    approved = False
                submissions.bind_asset(
                    submission.id,
                    asset_id,
                    status="approved" if approved else "pending_review",
                )
                updated_submission = submissions.get(submission.id)
                if updated_submission is not None:
                    submission = replace(updated_submission, status_token=submission.status_token)
            except Exception as error:
                submissions.mark_failed(submission.id, str(error))
                raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "投稿入库失败") from error

        return SubmissionResponse(
            submission_id=submission.id,
            status=submission.status,  # type: ignore[arg-type]
            status_token=submission.status_token or "",
            asset_id=submission.asset_id,
        )

    @app.get(
        "/api/v1/submissions/{submission_id}",
        response_model=SubmissionStatusResponse,
    )
    def read_submission(
        submission_id: str,
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ) -> SubmissionStatusResponse:
        status_token = credentials.credentials if credentials is not None else None
        submission = (
            submissions.get_for_status_token(submission_id, status_token)
            if status_token is not None
            else None
        )
        if submission is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "投稿不存在或凭证无效")
        return SubmissionStatusResponse(
            submission_id=submission.id,
            status=submission.status,  # type: ignore[arg-type]
            asset_id=submission.asset_id,
            error=submission.error if submission.status == "failed" else None,
        )

    @app.post("/api/v1/auth/login")
    def login(
        request: Request,
        payload: AdminLoginRequest,
        response: Response,
    ) -> dict[str, bool]:
        enforce_login_rate_limit(request)
        if active_settings.admin_username == "" or active_settings.admin_session_secret == "":
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "管理登录尚未配置")
        username_is_valid = hmac.compare_digest(payload.username, active_settings.admin_username)
        if not username_is_valid or not password_is_valid(payload.password):
            time.sleep(LOGIN_FAILURE_DELAY_SECONDS)
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
            secure=request.url.scheme == "https",
            samesite="strict",
            path="/api/v1",
        )
        return {"authenticated": True}

    @app.post("/api/v1/auth/logout")
    def logout(request: Request, response: Response) -> dict[str, bool]:
        response.delete_cookie(
            key="qingshe_admin_session",
            path="/api/v1",
            secure=request.url.scheme == "https",
            httponly=True,
            samesite="strict",
        )
        return {"authenticated": False}

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
        dependencies=[Depends(require_processing_registration)],
    )
    def register_processing_node(payload: NodePairRequest) -> dict[str, str]:
        """Enroll a local cutout worker using the dedicated registration token."""
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
        # Review-only submissions are cataloged directly and intentionally do
        # not create a remote processing task. Keep them in an explicit
        # dashboard collection so the administrator can approve them through
        # the same asset mutation endpoint as processed submissions.
        pending_review_assets, _revision = catalog.list_assets_with_revision(
            "", "", "ready", True, 500, 0
        )
        return {
            "nodes": processing.nodes_payload(),
            "tasks": processing.tasks_payload(),
            "pending_review_assets": pending_review_assets,
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
        submissions.mark_processing(task.id)
        return {
            "task": {
                "id": processing_task_handle(task.id, task.lease_owner or node_id),
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
        raw_task_id, lease_owner = parse_processing_task_handle(task_id)
        task = processing.task_for_node(raw_task_id, node_id, lease_owner)
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
        raw_task_id, lease_owner = parse_processing_task_handle(task_id)
        task = processing.task_for_node(raw_task_id, node_id, lease_owner)
        if task is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "处理任务不存在")
        try:
            metadata = ProcessingResultMetadata.model_validate_json(metadata_json)
        except ValidationError as error:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "处理结果信息无效") from error
        if processed.content_type != "image/png" or thumbnail.content_type != "image/webp":
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "处理结果格式无效")
        processed_content, thumbnail_content = await read_limited(processed), await read_limited(thumbnail)
        try:
            processed_width, processed_height = validate_submission_image(
                processed_content, "image/png"
            )
            validate_submission_image(thumbnail_content, "image/webp")
        except InvalidSubmissionImage as error:
            raise HTTPException(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "处理结果内容无效"
            ) from error
        if (processed_width, processed_height) != (metadata.width, metadata.height):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "处理结果尺寸不匹配")
        with processing.task_commit(raw_task_id, node_id, lease_owner) as finish_task:
            if finish_task is None:
                raise HTTPException(status.HTTP_409_CONFLICT, "Processing task lease has changed")
            submission = submissions.get_by_task(raw_task_id)
            catalog_original_path = task.original_path
            if submission is not None:
                # Keep a durable originals copy; incoming is only a processing
                # scratch area and is removed once this transaction succeeds.
                catalog_original_path = (
                    paths.originals / f"{task.content_hash}{task.original_path.suffix}"
                )
                if not catalog_original_path.exists():
                    atomic_write(catalog_original_path, task.original_path.read_bytes())
            result = catalog.create_asset(
                name=task.name,
                mime_type=task.original_mime,
                content_hash=task.content_hash,
                original_path=catalog_original_path,
            )
            asset_id = str(result["id"])
            duplicate = bool(result["duplicate"])
            existing_asset = catalog.get_asset(asset_id) if duplicate else None
            should_finalize = not duplicate or (
                existing_asset is not None and str(existing_asset.get("status")) != "ready"
            )
            if should_finalize:
                category, automatic_review = category_for_completed_asset(task.category, task.name)
                processed_path = paths.processed / f"{asset_id}.png"
                thumbnail_path = paths.thumbnails / f"{asset_id}.webp"
                atomic_write(processed_path, processed_content)
                atomic_write(thumbnail_path, thumbnail_content)
                catalog_completed = catalog.complete_direct_asset(
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
                if not catalog_completed:
                    raise HTTPException(status.HTTP_409_CONFLICT, "Catalog job state has changed")
            if not finish_task(asset_id):
                raise HTTPException(status.HTTP_409_CONFLICT, "处理任务状态已变化")
        reconcile_processing_completions()
        return {"asset_id": asset_id, "duplicate": duplicate}

    @app.post("/api/v1/processing-tasks/{task_id}/fail")
    def fail_processing_task(
        task_id: str,
        payload: dict[str, str],
        node_id: Annotated[str, Depends(require_node)],
    ) -> dict[str, bool]:
        raw_task_id, lease_owner = parse_processing_task_handle(task_id)
        message = str(payload.get("error", "本地处理节点处理失败"))[:500]
        if processing.task_for_node(raw_task_id, node_id, lease_owner) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "处理任务不存在")
        if not processing.fail_task(raw_task_id, node_id, message, lease_owner):
            raise HTTPException(status.HTTP_409_CONFLICT, "处理任务状态已变化")
        submission = submissions.get_by_task(raw_task_id)
        if submission is not None:
            submissions.mark_failed(submission.id, message)
        return {"ok": True}

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
        # Submission approval is stored in a separate database from the
        # catalog, so it cannot be represented as a SQL JOIN here. Walk the
        # catalog pages before applying the public-visibility predicate; doing
        # the filtering after one SQL page would let private rows consume the
        # requested page and hide later public assets.
        visible_rows: list[dict[str, object]] = []
        raw_offset = 0
        raw_page_size = min(500, max(filters.limit, 100))
        target_count = filters.offset + filters.limit
        revision = catalog.revision()
        while len(visible_rows) < target_count:
            page, revision = catalog.list_assets_with_revision(
                filters.query,
                filters.category,
                filters.status,
                filters.needs_review,
                raw_page_size,
                raw_offset,
            )
            if not page:
                break
            visible_rows.extend(
                row
                for row in page
                if str(row.get("status", "")) == "ready"
                and submissions.asset_is_public(str(row["id"]))
            )
            raw_offset += len(page)
            if len(page) < raw_page_size:
                break
        rows = visible_rows[filters.offset : filters.offset + filters.limit]
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
        asset = catalog.get_asset(asset_id)
        if (
            asset is None
            or str(asset.get("status")) != "ready"
            or bool(asset.get("needs_review"))
            or not submissions.asset_is_public(asset_id)
        ):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "素材尚未审核通过")
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
        catalog_completed = catalog.complete_job(
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
        if not catalog_completed:
            raise HTTPException(status.HTTP_409_CONFLICT, "Catalog job state has changed")
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
        catalog_completed = catalog.complete_job(
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
        if not catalog_completed:
            raise HTTPException(status.HTTP_409_CONFLICT, "Catalog job state has changed")
        return PublishResponse(id=asset_id, code=str(result["code"]), duplicate=False)

    @app.patch("/api/v1/admin/assets/{asset_id}", dependencies=[Depends(require_admin)])
    def patch_asset(asset_id: str, payload: AssetPatch) -> MutationResponse:
        if payload.category is not None and payload.category not in CATEGORIES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "素材分类无效")
        updated = catalog.patch_asset(asset_id, payload.model_dump(exclude_none=True))
        if updated and payload.needs_review is False:
            processing.resolve_asset_review(asset_id, payload.category)
            submissions.approve_asset(asset_id, payload.category)
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
