from PIL import Image, ImageDraw
import pytest

from tools.asset_admin.processing_quality import EmptyForegroundError, evaluate_alpha_quality


def test_evaluate_alpha_quality_keeps_a_clearly_isolated_material_out_of_review() -> None:
    # Given: a material with transparent margins around its visible content.
    image = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    ImageDraw.Draw(image).rectangle((20, 20, 79, 79), fill=(180, 90, 40, 255))

    # When: the asset worker evaluates the alpha channel before cropping.
    quality = evaluate_alpha_quality(image)

    # Then: it crops tightly and does not require manual review.
    assert quality.bounds == (20, 20, 80, 80)
    assert quality.needs_review is False


def test_evaluate_alpha_quality_sends_an_opaque_result_to_review() -> None:
    # Given: a result that still covers the entire source image.
    image = Image.new("RGBA", (100, 100), (180, 90, 40, 255))

    # When: the alpha channel is evaluated.
    quality = evaluate_alpha_quality(image)

    # Then: the result is usable but must be checked before publishing.
    assert quality.needs_review is True


def test_evaluate_alpha_quality_rejects_an_empty_result() -> None:
    # Given: a transparent image with no visible subject.
    image = Image.new("RGBA", (100, 100), (0, 0, 0, 0))

    # When / Then: processing fails so the existing retry path can handle it.
    with pytest.raises(EmptyForegroundError):
        evaluate_alpha_quality(image)
