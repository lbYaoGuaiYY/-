import { describe, expect, it } from "vitest"

import {
  clampAssetCenter,
  clientPointToLogicalCanvasPoint,
} from "../src/features/editor/drag-placement"

describe("drag placement", () => {
  it("maps the visible canvas center to logical coordinates when the canvas is scaled", () => {
    // Given
    const displayRect = { x: 100, y: 50, width: 600, height: 400 }
    const canvasSize = { width: 1200, height: 800 }

    // When
    const result = clientPointToLogicalCanvasPoint({ x: 400, y: 250 }, displayRect, canvasSize)

    // Then
    expect(result).toEqual({ kind: "valid", point: { x: 600, y: 400 } })
  })

  it("rejects a point outside the displayed canvas", () => {
    // Given
    const displayRect = { x: 100, y: 50, width: 600, height: 400 }

    // When
    const result = clientPointToLogicalCanvasPoint({ x: 99, y: 250 }, displayRect, {
      width: 1200,
      height: 800,
    })

    // Then
    expect(result).toEqual({ kind: "invalid", reason: "outside_canvas" })
  })

  it("rejects zero-sized display geometry", () => {
    // Given
    const displayRect = { x: 0, y: 0, width: 0, height: 400 }

    // When
    const result = clientPointToLogicalCanvasPoint({ x: 0, y: 0 }, displayRect, {
      width: 1200,
      height: 800,
    })

    // Then
    expect(result).toEqual({ kind: "invalid", reason: "invalid_size" })
  })

  it("rejects non-finite input", () => {
    // Given
    const displayRect = { x: 0, y: 0, width: 600, height: 400 }

    // When
    const result = clientPointToLogicalCanvasPoint({ x: Number.NaN, y: 20 }, displayRect, {
      width: 1200,
      height: 800,
    })

    // Then
    expect(result).toEqual({ kind: "invalid", reason: "non_finite" })
  })

  it("clamps an asset center so its scaled bounds stay inside the canvas", () => {
    // Given
    const assetSize = { width: 240, height: 160 }

    // When
    const result = clampAssetCenter({ x: 20, y: 790 }, assetSize, { width: 1200, height: 800 })

    // Then
    expect(result).toEqual({ kind: "valid", point: { x: 120, y: 720 } })
  })

  it("centers an asset on an axis when it is larger than the canvas", () => {
    // Given
    const assetSize = { width: 1600, height: 200 }

    // When
    const result = clampAssetCenter({ x: 80, y: 100 }, assetSize, { width: 1200, height: 800 })

    // Then
    expect(result).toEqual({ kind: "valid", point: { x: 600, y: 100 } })
  })
})
