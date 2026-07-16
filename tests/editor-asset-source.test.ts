import { afterEach, describe, expect, it, vi } from "vitest"

import { createServiceLibraryAsset, type LibraryAsset } from "../src/features/assets/asset-library"
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

afterEach(() => vi.unstubAllGlobals())

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

  it("renders a cached processed file locally instead of requesting the cloud URL again", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cached-material")
    const cached = new Blob(["cached image"], { type: "image/png" })

    const asset = createServiceLibraryAsset(
      {
        id: "00000000-0000-4000-8000-000000000001",
        code: "QS-000001",
        name: "离线花艺",
        category: "花艺",
        status: "ready",
        mime_type: "image/png",
        width: 320,
        height: 240,
        version: 1,
        needs_review: false,
        favorite: false,
        dominant_color: null,
        tags: [],
        usage_count: 0,
        created_at: "2026-07-13T00:00:00+00:00",
        updated_at: "2026-07-13T00:00:00+00:00",
      },
      cached,
    )

    expect(asset.src).toBe("blob:cached-material")
    expect(asset.thumbnailSrc).toBe("blob:cached-material")
    expect(asset.source.kind === "managed" && asset.source.localAsset?.blob).toBe(cached)
  })
})
