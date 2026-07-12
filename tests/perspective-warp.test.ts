import { describe, expect, it } from "vitest"

import {
  calculateOpaqueBounds,
  calculateOrientationRenderPlan,
  calculatePerspectivePreviewSkew,
} from "../src/features/editor/perspective-warp"

describe("orientation renderer", () => {
  it("keeps a front-facing image rectangular", () => {
    // Given / When
    const plan = calculateOrientationRenderPlan(0)

    // Then
    expect(plan).toMatchObject({ yawDegrees: 0, sideLayerCount: 0, sideDepth: 0.035 })
  })

  it("builds a layered side edge for a right-facing image", () => {
    // Given / When
    const plan = calculateOrientationRenderPlan(60, 1)

    // Then
    expect(plan).toMatchObject({ yawDegrees: 60, sideLayerCount: 16 })
    expect(plan.sideDepth).toBeCloseTo(0.12)
    expect(plan.cameraDistance).toBeGreaterThan(4)
  })

  it("does not use a skew transform while previewing a side direction", () => {
    expect(calculatePerspectivePreviewSkew(1448, 1086, 60)).toBe(0)
    expect(calculatePerspectivePreviewSkew(1448, 1086, -60)).toBe(0)
    expect(calculatePerspectivePreviewSkew(1448, 1086, 0)).toBe(0)
  })

  it("trims only transparent padding around a rendered material", () => {
    // Given
    const data = new Uint8ClampedArray(4 * 3 * 4)
    data[(1 * 4 + 1) * 4 + 3] = 255
    data[(2 * 4 + 2) * 4 + 3] = 255

    // When
    const bounds = calculateOpaqueBounds({ data, height: 3, width: 4 })

    // Then
    expect(bounds).toEqual({ height: 2, width: 2, x: 1, y: 1 })
  })
})
