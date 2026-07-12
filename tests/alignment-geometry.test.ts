import { describe, expect, it } from "vitest"

import {
  calculateAlignment,
  calculateDistribution,
  calculateSnap,
} from "../src/features/editor/alignment-geometry"

describe("alignment geometry", () => {
  it("snaps the moving center to the canvas center when it is inside the threshold", () => {
    // Given
    const moving = { left: 446, top: 120, width: 100, height: 80 }
    const canvas = { left: 0, top: 0, width: 1000, height: 600 }

    // When
    const result = calculateSnap(moving, [], canvas, 6)

    // Then
    expect(result).toEqual({
      deltaX: 4,
      deltaY: 0,
      guides: [{ axis: "x", position: 500, start: 0, end: 600 }],
    })
  })

  it("snaps an edge to another object and leaves a distant axis unchanged", () => {
    // Given
    const moving = { left: 198, top: 20, width: 100, height: 80 }
    const reference = { left: 300, top: 180, width: 120, height: 100 }
    const canvas = { left: 0, top: 0, width: 1000, height: 600 }

    // When
    const result = calculateSnap(moving, [reference], canvas, 4)

    // Then
    expect(result).toEqual({
      deltaX: 2,
      deltaY: 0,
      guides: [{ axis: "x", position: 300, start: 20, end: 280 }],
    })
  })

  it("aligns a multi-selection against its shared bounds", () => {
    // Given
    const rectangles = [
      { left: 100, top: 60, width: 80, height: 100 },
      { left: 260, top: 120, width: 120, height: 80 },
    ]

    // When
    const deltas = calculateAlignment(rectangles, "center-x")

    // Then
    expect(deltas).toEqual([
      { index: 0, deltaX: 100, deltaY: 0 },
      { index: 1, deltaX: -80, deltaY: 0 },
    ])
  })

  it("distributes three objects with equal horizontal gaps while preserving the outer edges", () => {
    // Given
    const rectangles = [
      { left: 20, top: 20, width: 80, height: 60 },
      { left: 150, top: 80, width: 50, height: 60 },
      { left: 340, top: 40, width: 60, height: 60 },
    ]

    // When
    const deltas = calculateDistribution(rectangles, "horizontal")

    // Then
    expect(deltas).toEqual([
      { index: 0, deltaX: 0, deltaY: 0 },
      { index: 1, deltaX: 45, deltaY: 0 },
      { index: 2, deltaX: 0, deltaY: 0 },
    ])
  })
})
