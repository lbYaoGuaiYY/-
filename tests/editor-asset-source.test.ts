import { describe, expect, it } from "vitest"

import type { LibraryAsset } from "../src/features/assets/asset-library"
import { selectEditorAssetSource } from "../src/features/assets/use-editor-asset-library"
import { createAssetId } from "../src/features/editor/editor-model"

const builtInAsset = {
  id: "built-in",
  assetId: createAssetId("built-in:test"),
  name: "内置素材",
  category: "花艺",
  src: "data:image/png;base64,",
  width: 1,
  height: 1,
  source: {
    kind: "built-in",
    asset: {
      id: "test",
      name: "内置素材",
      category: "花艺",
      src: "data:image/png;base64,",
      width: 1,
      height: 1,
    },
  },
} as const satisfies LibraryAsset
const managedAsset = {
  id: "managed",
  assetId: createAssetId("local:catalog:test"),
  name: "在库素材",
  category: "家具",
  src: "http://127.0.0.1/asset.png",
  width: 1,
  height: 1,
  source: {
    kind: "managed",
    localAsset: null,
    processedUrl: "http://127.0.0.1/asset.png",
  },
} as const satisfies LibraryAsset

describe("editor asset source", () => {
  it("uses the managed catalog as the source of truth when the service is ready", () => {
    // Given / When
    const assets = selectEditorAssetSource("ready", [builtInAsset], [managedAsset])

    // Then
    expect(assets.map((asset) => asset.id)).toEqual(["managed"])
  })

  it("uses built-in assets only when the local service is unavailable", () => {
    // Given / When
    const assets = selectEditorAssetSource("error", [builtInAsset], [managedAsset])

    // Then
    expect(assets.map((asset) => asset.id)).toEqual(["built-in"])
  })
})
