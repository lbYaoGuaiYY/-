from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from PIL import Image

VISIBLE_ALPHA_THRESHOLD: Final = 32
REVIEW_COVERAGE_THRESHOLD: Final = 0.96


@dataclass(frozen=True, slots=True)
class AlphaQuality:
    bounds: tuple[int, int, int, int]
    needs_review: bool


class EmptyForegroundError(RuntimeError):
    pass


def evaluate_alpha_quality(image: Image.Image) -> AlphaQuality:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    bounds = alpha.getbbox()
    if bounds is None:
        raise EmptyForegroundError("Background removal produced no visible foreground")
    visible_pixels = sum(alpha.histogram()[VISIBLE_ALPHA_THRESHOLD + 1 :])
    coverage = visible_pixels / (rgba.width * rgba.height)
    return AlphaQuality(bounds=bounds, needs_review=coverage >= REVIEW_COVERAGE_THRESHOLD)
