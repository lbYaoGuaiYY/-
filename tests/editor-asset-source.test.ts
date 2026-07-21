import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createServiceLibraryAsset,
  type LibraryAsset,
  revokeUnusedServiceAssetObjectUrls,
} from "../src/features/assets/asset-library"
import type { ServiceAsset } from "../src/features/assets/asset-service-client"
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

  it("reuses a cached Blob URL per asset version and revokes stale versions", () => {
    const createUrl = vi.spyOn(URL, "createObjectURL")
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL")
    createUrl.mockReturnValueOnce("blob:version-1").mockReturnValueOnce("blob:version-2")
    const cache = new Map<string, string>()
    const asset: ServiceAsset = {
      id: "00000000-0000-4000-8000-000000000001",
      code: "QS-000001",
      name: "缓存素材",
      category: "花艺",
      status: "ready",
      mime_type: "image/png",
      width: 1,
      height: 1,
      version: 1,
      needs_review: false,
      favorite: false,
      dominant_color: null,
      tags: [],
      usage_count: 0,
      created_at: "2026-07-13T00:00:00+00:00",
      updated_at: "2026-07-13T00:00:00+00:00",
    } as const
    const blob = new Blob(["cached"], { type: "image/png" })

    expect(createServiceLibraryAsset(asset, blob, cache).src).toBe("blob:version-1")
    expect(createServiceLibraryAsset(asset, blob, cache).src).toBe("blob:version-1")
    const nextAsset = createServiceLibraryAsset({ ...asset, version: 2 }, blob, cache)
    expect(nextAsset.src).toBe("blob:version-2")

    revokeUnusedServiceAssetObjectUrls(cache, new Set([`${asset.id}@2`]))
    expect(revokeUrl).toHaveBeenCalledWith("blob:version-1")
    expect(cache).toEqual(new Map([[`${asset.id}@2`, "blob:version-2"]]))
  })
})
