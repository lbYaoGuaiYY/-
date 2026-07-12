from __future__ import annotations

import logging
import os
import threading
from collections import Counter
from pathlib import Path
from typing import Callable, Final

from PIL import Image
from rembg import new_session, remove

from catalog import Catalog, LibraryPaths
from classifier import LocalImageClassifier
from processing_quality import evaluate_alpha_quality

LOGGER = logging.getLogger("qingshe.asset_admin.pipeline")
MODEL_NAME: Final = "isnet-general-use"


class AssetWorker:
    def __init__(self, catalog: Catalog, paths: LibraryPaths, notify: Callable[[str, str], None]) -> None:
        self._catalog = catalog
        self._paths = paths
        self._notify = notify
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread = threading.Thread(target=self._run, name="qingshe-asset-worker", daemon=True)
        self._session: object | None = None
        self._classifier = LocalImageClassifier(paths.models)
        os.environ["U2NET_HOME"] = str(paths.models)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        self._thread.join(timeout=5)

    def wake(self) -> None:
        self._wake.set()

    def _run(self) -> None:
        while not self._stop.is_set():
            job = self._catalog.claim_job()
            if job is None:
                self._wake.wait(timeout=1)
                self._wake.clear()
                continue
            try:
                self._process(job)
            except Exception as error:  # noqa: BLE001
                LOGGER.exception("Asset job failed: %s", job["job_id"])
                self._catalog.fail_job(str(job["job_id"]), str(job["id"]), str(error))
                self._notify("job.failed", str(job["id"]))

    def _process(self, job: dict[str, object]) -> None:
        asset_id = str(job["id"])
        source = Path(str(job["original_path"]))
        processed = self._paths.processed / f"{asset_id}.png"
        thumbnail = self._paths.thumbnails / f"{asset_id}.webp"
        if self._session is None:
            self._session = new_session(MODEL_NAME)
        result = bytes(remove(source.read_bytes(), session=self._session))
        temporary = processed.with_suffix(".png.tmp")
        temporary.write_bytes(result)
        with Image.open(temporary) as image:
            rgba = image.convert("RGBA")
            quality = evaluate_alpha_quality(rgba)
            cropped = rgba.crop(quality.bounds)
            cropped.save(temporary, format="PNG", optimize=True)
            width, height = cropped.size
            dominant = self._dominant_color(cropped)
            preview = cropped.copy()
            preview.thumbnail((480, 360), Image.Resampling.LANCZOS)
            thumb_temporary = thumbnail.with_suffix(".webp.tmp")
            preview.save(thumb_temporary, format="WEBP", quality=82, method=4)
        os.replace(temporary, processed)
        os.replace(thumb_temporary, thumbnail)
        category, classification_needs_review = self._classifier.classify(processed)
        self._catalog.complete_job(
            str(job["job_id"]), asset_id, status="ready", category=category,
            needs_review=int(quality.needs_review or classification_needs_review), width=width, height=height,
            processed_path=str(processed), thumbnail_path=str(thumbnail), dominant_color=dominant,
            tags=f'["{category}"]',
        )
        self._notify("asset.ready", asset_id)

    @staticmethod
    def _dominant_color(image: Image.Image) -> str:
        sample = image.copy()
        sample.thumbnail((64, 64))
        colors = Counter(
            (red, green, blue)
            for red, green, blue, alpha in sample.convert("RGBA").getdata()
            if alpha > 32
        )
        if not colors:
            return "#808080"
        (red, green, blue), _count = colors.most_common(1)[0]
        return f"#{red:02x}{green:02x}{blue:02x}"
