import { describe, expect, it } from "vitest"

import { getCanvasBoundsTranslation } from "../src/features/editor/canvas-bounds"

describe("canvas object bounds", () => {
  it("moves a dragged layer fully back inside the canvas", () => {
    expect(
      getCanvasBoundsTranslation(
        { left: -24, top: 740, width: 160, height: 120 },
        { width: 1200, height: 800 },
      ),
    ).toEqual({ x: 24, y: -60 })
  })

  it("centers a layer that is larger than the canvas instead of losing its controls", () => {
    expect(
      getCanvasBoundsTranslation(
        { left: -120, top: -80, width: 1440, height: 960 },
        { width: 1200, height: 800 },
      ),
    ).toEqual({ x: 0, y: 0 })
  })
})
