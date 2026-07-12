import { describe, expect, it } from "vitest"

import { DEFAULT_LAYER_TRANSFORM } from "../src/features/editor/editor-model"
import {
  applyPerspectivePreset,
  getActivePerspectivePreset,
} from "../src/features/editor/perspective-presets"

describe("perspective presets", () => {
  it("recognizes a newly added layer as front facing", () => {
    // Given
    const transform = { ...DEFAULT_LAYER_TRANSFORM, scaleX: 0.8, scaleY: 0.8 }

    // When
    const preset = getActivePerspectivePreset(transform)

    // Then
    expect(preset).toBe("front")
  })

  it("creates a stable right side view without shrinking on repeated use", () => {
    // Given
    const transform = { ...DEFAULT_LAYER_TRANSFORM, scaleX: 0.8, scaleY: 0.8 }

    // When
    const first = { ...transform, ...applyPerspectivePreset(transform, "right") }
    const second = { ...first, ...applyPerspectivePreset(first, "right") }

    // Then
    expect(second).toEqual(first)
    expect(second).toMatchObject({
      scaleX: 0.8,
      scaleY: 0.8,
      skewX: 0,
      skewY: 0,
      perspectiveX: 35,
    })
    expect(getActivePerspectivePreset(second)).toBe("right")
  })

  it("restores a side view to an undistorted front view", () => {
    // Given
    const transform = { ...DEFAULT_LAYER_TRANSFORM, scaleX: 0.8, scaleY: 0.8 }
    const sideView = { ...transform, ...applyPerspectivePreset(transform, "left") }

    // When
    const frontView = { ...sideView, ...applyPerspectivePreset(sideView, "front") }

    // Then
    expect(frontView).toMatchObject({
      scaleX: 0.8,
      scaleY: 0.8,
      skewX: 0,
      skewY: 0,
      perspectiveX: 0,
    })
    expect(getActivePerspectivePreset(frontView)).toBe("front")
  })
})
