# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = [
#   "numba==0.62.1",
#   "pillow==12.1.0",
#   "rembg[cpu]==2.0.75",
#   "torch==2.8.0",
#   "transformers==4.56.2",
# ]
# ///

from __future__ import annotations

import hashlib
import json
import logging
import mimetypes
import os
import queue
import re
import threading
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Final

from catalog import CATEGORIES, Catalog, LibraryPaths
from pipeline import AssetWorker

HOST: Final = "127.0.0.1"
PORT: Final = 7000
MAX_INPUT_BYTES: Final = 25 * 1024 * 1024
ALLOWED_MIME: Final = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
ALLOWED_ORIGINS: Final = {
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
}
LOGGER: Final = logging.getLogger("qingshe.asset_admin")
ASSET_FILE_PATTERN: Final = re.compile(r"^/assets/([0-9a-f-]+)/(original|processed|thumbnail)$")
ASSET_PATTERN: Final = re.compile(r"^/assets/([0-9a-f-]+)$")
JOB_RETRY_PATTERN: Final = re.compile(r"^/jobs/([0-9a-f-]+)/retry$")
ASSET_RESTORE_PATTERN: Final = re.compile(r"^/assets/([0-9a-f-]+)/restore$")


def etag_matches(header_value: str | None, current_etag: str) -> bool:
    if header_value is None:
        return False
    if header_value.strip() == "*":
        return True
    normalized_current = current_etag.removeprefix("W/")
    return any(
        candidate.strip().removeprefix("W/") == normalized_current
        for candidate in header_value.split(",")
    )


class EventBroker:
    def __init__(self) -> None:
        self._subscribers: set[queue.Queue[str]] = set()
        self._lock = threading.Lock()

    def publish(self, event: str, asset_id: str) -> None:
        payload = f"event: {event}\ndata: {json.dumps({'assetId': asset_id})}\n\n"
        with self._lock:
            subscribers = tuple(self._subscribers)
        for subscriber in subscribers:
            subscriber.put_nowait(payload)

    def subscribe(self) -> queue.Queue[str]:
        subscriber: queue.Queue[str] = queue.Queue()
        with self._lock:
            self._subscribers.add(subscriber)
        return subscriber

    def unsubscribe(self, subscriber: queue.Queue[str]) -> None:
        with self._lock:
            self._subscribers.discard(subscriber)


def library_root() -> Path:
    configured = os.environ.get("QINGSHE_ASSET_LIBRARY")
    if configured:
        return Path(configured).expanduser().resolve()
    local_app_data = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    return local_app_data / "轻设" / "素材库"


PATHS = LibraryPaths.create(library_root())
CATALOG = Catalog(PATHS)
EVENTS = EventBroker()
WORKER = AssetWorker(CATALOG, PATHS, EVENTS.publish)


class AssetRequestHandler(BaseHTTPRequestHandler):
    server_version = "QingsheAssetLibrary/2.0"

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, If-None-Match")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/health":
            self._send_json({"status": "ready", "libraryRoot": str(PATHS.root), "categories": CATEGORIES})
            return
        if parsed.path == "/catalog/revision":
            revision = str(CATALOG.revision())
            self._send_conditional_json({"revision": int(revision)}, f'"{revision}"')
            return
        if parsed.path == "/assets":
            query = urllib.parse.parse_qs(parsed.query)
            review_value = query.get("needs_review", [""])[0]
            if review_value not in {"", "0", "1"}:
                self.send_error(HTTPStatus.BAD_REQUEST, "needs_review must be 0 or 1")
                return
            assets, revision = CATALOG.list_assets_with_revision(
                query.get("query", [""])[0], query.get("category", [""])[0],
                query.get("status", ["ready"])[0],
                None if review_value == "" else review_value == "1",
                self._bounded_integer(query.get("limit", ["200"])[0], 1, 500),
                self._bounded_integer(query.get("offset", ["0"])[0], 0, 1_000_000),
            )
            query_key = json.dumps(query, ensure_ascii=False, sort_keys=True)
            etag = f'"{revision}-{hashlib.sha256(query_key.encode("utf-8")).hexdigest()[:16]}"'
            self._send_conditional_json({"assets": assets}, etag, revision)
            return
        if parsed.path == "/jobs":
            self._send_json({"jobs": CATALOG.list_jobs()})
            return
        if parsed.path == "/events":
            self._stream_events()
            return
        asset_match = ASSET_PATTERN.fullmatch(parsed.path)
        if asset_match:
            asset = CATALOG.get_asset(asset_match.group(1))
            if asset is None:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            self._send_json(asset)
            return
        file_match = ASSET_FILE_PATTERN.fullmatch(parsed.path)
        if file_match:
            self._send_asset_file(file_match.group(1), file_match.group(2))
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802, BROAD_EXCEPT_OK
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/assets/import":
                self._import_asset(parsed.query)
                return
            retry_match = JOB_RETRY_PATTERN.fullmatch(parsed.path)
            if retry_match:
                changed = CATALOG.retry_job(retry_match.group(1))
                if changed:
                    WORKER.wake()
                self._send_json({"updated": changed}, HTTPStatus.OK if changed else HTTPStatus.NOT_FOUND)
                return
            restore_match = ASSET_RESTORE_PATTERN.fullmatch(parsed.path)
            if restore_match:
                changed = CATALOG.set_deleted(restore_match.group(1), False)
                self._send_json({"updated": changed}, HTTPStatus.OK if changed else HTTPStatus.NOT_FOUND)
                if changed:
                    EVENTS.publish("asset.updated", restore_match.group(1))
                return
            if parsed.path == "/maintenance/backup":
                self._send_json({"path": str(CATALOG.backup())})
                return
            if parsed.path == "/maintenance/repair":
                result = CATALOG.repair()
                WORKER.wake()
                self._send_json(result)
                return
        except ValueError as error:
            self._send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return
        except Exception:
            LOGGER.exception("Request failed: %s", parsed.path)
            self._send_json({"error": "本地素材服务处理失败"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_PATCH(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        match = ASSET_PATTERN.fullmatch(parsed.path)
        if match is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            changes = self._read_json()
        except ValueError as error:
            self._send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return
        changed = CATALOG.patch_asset(match.group(1), changes)
        self._send_json({"updated": changed}, HTTPStatus.OK if changed else HTTPStatus.NOT_FOUND)
        if changed:
            EVENTS.publish("asset.updated", match.group(1))

    def do_DELETE(self) -> None:  # noqa: N802
        match = ASSET_PATTERN.fullmatch(urllib.parse.urlparse(self.path).path)
        if match is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        changed = CATALOG.set_deleted(match.group(1), True)
        self._send_json({"updated": changed}, HTTPStatus.OK if changed else HTTPStatus.NOT_FOUND)
        if changed:
            EVENTS.publish("asset.deleted", match.group(1))

    def end_headers(self) -> None:
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Expose-Headers", "ETag, X-Catalog-Revision")
        super().end_headers()

    def log_message(self, format_string: str, *args: object) -> None:
        LOGGER.info("%s - %s", self.address_string(), format_string % args)

    def _import_asset(self, raw_query: str) -> None:
        mime_type = self.headers.get_content_type()
        if mime_type not in ALLOWED_MIME:
            raise ValueError("仅支持 PNG、JPEG 和 WebP 图片")
        source = self._read_body()
        digest = hashlib.sha256(source).hexdigest()
        name = urllib.parse.parse_qs(raw_query).get("name", ["未命名素材"])[0].strip()[:120] or "未命名素材"
        original = PATHS.originals / f"{digest}{ALLOWED_MIME[mime_type]}"
        if not original.exists():
            temporary = original.with_suffix(f"{original.suffix}.tmp")
            temporary.write_bytes(source)
            os.replace(temporary, original)
        result = CATALOG.create_asset(name=name, mime_type=mime_type, content_hash=digest, original_path=original)
        if not result["duplicate"]:
            WORKER.wake()
            EVENTS.publish("asset.queued", str(result["id"]))
        self._send_json(result, HTTPStatus.OK if result["duplicate"] else HTTPStatus.CREATED)

    def _send_asset_file(self, asset_id: str, kind: str) -> None:
        path = CATALOG.asset_path(asset_id, kind)
        if path is None or not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        body = path.read_bytes()
        mime_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.end_headers()
        self.wfile.write(body)

    def _stream_events(self) -> None:
        subscriber = EVENTS.subscribe()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            while True:
                try:
                    payload = subscriber.get(timeout=15)
                except queue.Empty:
                    payload = ": keep-alive\n\n"
                self.wfile.write(payload.encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass
        finally:
            EVENTS.unsubscribe(subscriber)

    def _read_body(self) -> bytes:
        value = self.headers.get("Content-Length")
        if value is None or not value.isdecimal():
            raise ValueError("缺少图片大小")
        size = int(value)
        if size <= 0 or size > MAX_INPUT_BYTES:
            raise ValueError("单张图片必须小于 25 MB")
        return self.rfile.read(size)

    def _read_json(self) -> dict[str, object]:
        if self.headers.get_content_type() != "application/json":
            raise ValueError("请求格式错误")
        payload = json.loads(self._read_body())
        if not isinstance(payload, dict):
            raise ValueError("请求内容必须是对象")
        category = payload.get("category")
        if category is not None and category not in CATEGORIES:
            raise ValueError("素材分类无效")
        return payload

    def _send_json(self, payload: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_conditional_json(
        self, payload: object, etag: str, revision: int | None = None
    ) -> None:
        if etag_matches(self.headers.get("If-None-Match"), etag):
            self.send_response(HTTPStatus.NOT_MODIFIED)
            self.send_header("Cache-Control", "no-cache")
            self.send_header("ETag", etag)
            if revision is not None:
                self.send_header("X-Catalog-Revision", str(revision))
            self.end_headers()
            return
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("ETag", etag)
        if revision is not None:
            self.send_header("X-Catalog-Revision", str(revision))
        self.end_headers()
        self.wfile.write(body)

    @staticmethod
    def _bounded_integer(value: str, minimum: int, maximum: int) -> int:
        try:
            return max(minimum, min(int(value), maximum))
        except ValueError:
            return minimum


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    WORKER.start()
    try:
        with ThreadingHTTPServer((HOST, PORT), AssetRequestHandler) as server:
            LOGGER.info("Qingshe local asset library ready at http://%s:%d (%s)", HOST, PORT, PATHS.root)
            server.serve_forever()
    finally:
        WORKER.stop()


if __name__ == "__main__":
    main()
