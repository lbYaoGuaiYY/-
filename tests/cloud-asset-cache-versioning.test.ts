import { describe, expect, it } from "vitest"
import {
  isCurrentProcessedVersion,
  planCatalogVersionPrune,
  planProcessedVersionWrite,
} from "../src/features/assets/cloud-asset-cache-versioning"

describe("cloud asset cache versioning", () => {
  const oldVersion = { cacheKey: "asset-1@1", id: "asset-1", version: 1, pinned: false }

  it("replaces old versions after the current processed asset is available", () => {
    const plan = planProcessedVersionWrite([oldVersion], {
      cacheKey: "asset-1@2",
      id: "asset-1",
      version: 2,
      pinned: false,
    })

    expect(plan.record.pinned).toBe(false)
    expect(plan.staleCacheKeys).toEqual(["asset-1@1"])
  })

  it("transfers an explicit pin to the replacement version", () => {
    const plan = planProcessedVersionWrite([{ ...oldVersion, pinned: true }], {
      cacheKey: "asset-1@2",
      id: "asset-1",
      version: 2,
      pinned: false,
    })

    expect(plan.record.pinned).toBe(true)
  })

  it("rejects a lower processed version without pruning the current version", () => {
    const plan = planProcessedVersionWrite(
      [{ ...oldVersion, cacheKey: "asset-1@2", version: 2 }],
      oldVersion,
    )

    expect(plan.shouldWrite).toBe(false)
    expect(plan.record.version).toBe(2)
    expect(plan.staleCacheKeys).toEqual([])
  })

  it("prunes stale unpinned blobs as soon as newer catalog metadata arrives", () => {
    expect(
      planCatalogVersionPrune(
        [oldVersion, { ...oldVersion, cacheKey: "asset-2@1", id: "asset-2", pinned: true }],
        new Map([
          ["asset-1", 2],
          ["asset-2", 2],
        ]),
      ),
    ).toEqual(["asset-1@1"])
  })

  it("does not report an old blob as the current offline version", () => {
    expect(isCurrentProcessedVersion(oldVersion, 2)).toBe(false)
    expect(isCurrentProcessedVersion(oldVersion, 1)).toBe(true)
    expect(isCurrentProcessedVersion(oldVersion, undefined)).toBe(true)
  })
})
