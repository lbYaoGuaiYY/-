import { describe, expect, it } from "vitest"

import { copyLayerWithOffset } from "../src/features/editor/editor-layer-copy"
import { createAssetId, createLayerId, type ImageLayer } from "../src/features/editor/editor-model"

const SOURCE_LAYER = {
  id: createLayerId("source"),
  assetId: createAssetId("built-in:floral-arch"),
  name: "奶油花艺拱门",
  visible: true,
  locked: false,
  transform: {
    x: 300,
    y: 240,
    scaleX: 0.8,
    scaleY: 0.8,
    angle: 12,
    flipX: false,
    flipY: false,
    opacity: 1,
  },
} as const satisfies ImageLayer

describe("editor layer copy", () => {
  it("creates an independent layer with a new id and visible offset", () => {
    const copy = copyLayerWithOffset(SOURCE_LAYER, createLayerId("copy"), 12)

    expect(copy).toEqual({
      ...SOURCE_LAYER,
      id: createLayerId("copy"),
      name: "奶油花艺拱门 副本",
      transform: { ...SOURCE_LAYER.transform, x: 312, y: 252 },
    })
    expect(copy.transform).not.toBe(SOURCE_LAYER.transform)
  })
})
