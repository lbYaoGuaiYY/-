import { describe, expect, it } from "vitest"

import { calculateFitDisplayScale, clampDisplayScale } from "../src/features/editor/fabric-display"

describe("fabric display scale", () => {
  it("fits the canvas inside the available viewport without enlarging it", () => {
    // Given a portrait design that is larger than its viewport
    const scale = calculateFitDisplayScale(1200, 1800, 800, 900)

    // Then the fit scale uses the limiting height and never exceeds 100%
    expect(scale).toBeCloseTo(836 / 1800)
  })

  it("keeps manual zoom within the usable editor range", () => {
    // When zoom values exceed the supported detail range
    // Then they are clamped instead of producing an unusable canvas
    expect(clampDisplayScale(0.01)).toBe(0.1)
    expect(clampDisplayScale(8)).toBe(4)
  })
})
