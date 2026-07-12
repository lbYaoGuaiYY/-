from __future__ import annotations

import logging
from pathlib import Path
from collections.abc import Callable
from typing import Final

LOGGER = logging.getLogger("qingshe.asset_admin.classifier")
LABELS: Final = {
    "floral arrangement or flowers": "花艺",
    "chair table cabinet or furniture": "家具",
    "welcome sign display board or wedding signage": "标识",
    "green plant tree leaf or foliage": "绿植",
    "carpet floor mat or stage flooring": "地面",
    "lamp chandelier candle or lighting": "灯具",
    "curtain drape fabric or textile decoration": "布艺",
    "other wedding event decoration": "其他",
}


class LocalImageClassifier:
    def __init__(self, model_directory: Path) -> None:
        self._model_directory = model_directory
        self._pipeline: Callable[..., object] | None = None
        self._unavailable = False

    def classify(self, image_path: Path) -> tuple[str, bool]:
        if self._unavailable:
            return "其他", True
        try:
            pipeline = self._get_pipeline()
            results = pipeline(str(image_path), candidate_labels=list(LABELS))
            if not isinstance(results, list) or not results or not isinstance(results[0], dict):
                raise ValueError("分类模型返回了无效结果")
            best = results[0]
            label = LABELS.get(str(best["label"]), "其他")
            confidence = float(best["score"])
            return label, confidence < 0.48 or label == "其他"
        except Exception:  # noqa: BLE001
            LOGGER.exception("Local image classification unavailable; using review queue")
            self._unavailable = True
            return "其他", True

    def _get_pipeline(self) -> Callable[..., object]:
        if self._pipeline is None:
            from transformers import pipeline

            classifier = pipeline(
                task="zero-shot-image-classification",
                model="openai/clip-vit-base-patch32",
                model_kwargs={"cache_dir": str(self._model_directory)},
            )
            if not callable(classifier):
                raise TypeError("分类模型不可调用")
            self._pipeline = classifier
        return self._pipeline
