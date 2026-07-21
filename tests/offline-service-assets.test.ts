import { describe, expect, it } from "vitest"

import type { ServiceAsset } from "../src/features/assets/asset-service-client"
import { createOfflineServiceLibraryAssets } from "../src/features/assets/use-managed-assets"

function serviceAsset(id: string, name: string): ServiceAsset {
  return {
    id,
    code: id.slice(0, 8),
    name,
    category: "其他",
    status: "ready",
    mime_type: "image/png",
    width: 100,
    height: 100,
    version: 1,
    needs_review: false,
    favorite: false,
    dominant_color: null,
    tags: [],
    usage_count: 0,
    created_at: "2026-07-21T00:00:00Z",
    updated_at: "2026-07-21T00:00:00Z",
  }
}

describe("offline service assets", () => {
  it("keeps only catalog entries with a locally cached processed image", () => {
    const cached = serviceAsset("00000000-0000-4000-8000-000000000001", "已缓存")
    const metadataOnly = serviceAsset("00000000-0000-4000-8000-000000000002", "仅元数据")
    const blob = new Blob(["image"], { type: "image/png" })
    const objectUrls = new Set<string>()

    const result = createOfflineServiceLibraryAssets(
      [cached, metadataOnly],
      new Map([[cached.id, blob]]),
      objectUrls,
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe("已缓存")
    expect(result[0]?.src).toMatch(/^blob:/)
    expect(result[0]?.thumbnailSrc).toBe(result[0]?.src)
    expect(result.some((asset) => asset.name === "仅元数据")).toBe(false)
    expect(objectUrls).toEqual(new Set([result[0]?.src]))
  })
})
