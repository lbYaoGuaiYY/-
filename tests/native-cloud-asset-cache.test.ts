import { beforeEach, describe, expect, it, vi } from "vitest"

const fileState = vi.hoisted(() => ({
  files: new Map<string, Uint8Array | string>(),
  failNextIndexWrite: false,
  failNextPrimaryRepair: false,
  failNextReadSync: false,
  failNextBinaryRead: false,
}))

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: "app-data" },
  exists: vi.fn(async (path: string) => fileState.files.has(path)),
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async (path: string) => {
    if (fileState.failNextBinaryRead && path.endsWith("@2.png")) {
      fileState.failNextBinaryRead = false
      throw new Error("binary read failed")
    }
    const value = fileState.files.get(path)
    if (!(value instanceof Uint8Array)) throw new Error(`missing binary file: ${path}`)
    return new Uint8Array(value)
  }),
  readTextFile: vi.fn((path: string) => {
    if (fileState.failNextReadSync) {
      fileState.failNextReadSync = false
      throw new Error("sync read failed")
    }
    const value = fileState.files.get(path)
    if (typeof value !== "string") throw new Error(`missing text file: ${path}`)
    return Promise.resolve(value)
  }),
  remove: vi.fn(async (path: string) => {
    fileState.files.delete(path)
  }),
  rename: vi.fn(async (source: string, destination: string) => {
    if (fileState.failNextPrimaryRepair && destination === "cloud-assets/catalog.json") {
      fileState.failNextPrimaryRepair = false
      throw new Error("repair rename failed")
    }
    const value = fileState.files.get(source)
    if (value === undefined) throw new Error(`missing source file: ${source}`)
    fileState.files.delete(source)
    fileState.files.set(destination, value)
  }),
  writeFile: vi.fn(async (path: string, bytes: Uint8Array) => {
    fileState.files.set(path, new Uint8Array(bytes))
  }),
  writeTextFile: vi.fn(async (path: string, contents: string) => {
    if (fileState.failNextIndexWrite && path === "cloud-assets/processed-index.json.next") {
      fileState.failNextIndexWrite = false
      throw new Error("index write failed")
    }
    fileState.files.set(path, contents)
  }),
}))

import { ASSET_CATEGORIES } from "../src/features/assets/demo-assets"
import { nativeCloudAssetCache } from "../src/features/assets/native-cloud-asset-cache"

const ASSET_ONE = "00000000-0000-4000-8000-000000000001"
const ASSET_TWO = "00000000-0000-4000-8000-000000000002"

function catalogAsset(id: string, name: string, version = 1) {
  return {
    id,
    code: name,
    name,
    category: ASSET_CATEGORIES[ASSET_CATEGORIES.length - 1] as (typeof ASSET_CATEGORIES)[number],
    status: "ready",
    mime_type: "image/png",
    width: 1,
    height: 1,
    version,
    needs_review: false,
    favorite: false,
    dominant_color: null,
    tags: [],
    usage_count: 0,
    created_at: "2026-07-22T00:00:00Z",
    updated_at: "2026-07-22T00:00:00Z",
  }
}

beforeEach(() => {
  fileState.files.clear()
  fileState.failNextIndexWrite = false
  fileState.failNextPrimaryRepair = false
  fileState.failNextReadSync = false
  fileState.failNextBinaryRead = false
})

describe("native cloud asset cache", () => {
  it("serializes concurrent processed mutations without losing records", async () => {
    await Promise.all([
      nativeCloudAssetCache.saveProcessed({ id: ASSET_ONE, version: 1 }, new Blob(["one"])),
      nativeCloudAssetCache.saveProcessed({ id: ASSET_TWO, version: 1 }, new Blob(["two"])),
    ])

    const index = JSON.parse(String(fileState.files.get("cloud-assets/processed-index.json"))) as {
      assets: readonly { id: string }[]
    }
    expect(index.assets.map((record) => record.id).sort()).toEqual([ASSET_ONE, ASSET_TWO])
  })

  it("serializes concurrent catalog mutations without losing records", async () => {
    await Promise.all([
      nativeCloudAssetCache.saveCatalog([catalogAsset(ASSET_ONE, "one")]),
      nativeCloudAssetCache.saveCatalog([catalogAsset(ASSET_TWO, "two")]),
    ])

    const catalog = await nativeCloudAssetCache.listCatalog({
      category: "",
      limit: 10,
      offset: 0,
      search: "",
    })
    expect(catalog.assets.map((asset) => asset.id).sort()).toEqual([ASSET_ONE, ASSET_TWO])
  })

  it("prunes an unpinned old processed version when the catalog advances", async () => {
    await nativeCloudAssetCache.saveCatalog([catalogAsset(ASSET_ONE, "one", 1)])
    await nativeCloudAssetCache.saveProcessed({ id: ASSET_ONE, version: 1 }, new Blob(["old"]))
    fileState.files.set(
      "cloud-assets/processed/00000000-0000-4000-8000-000000000001@1.png.backup",
      new Uint8Array([0]),
    )

    await nativeCloudAssetCache.saveCatalog([catalogAsset(ASSET_ONE, "one", 2)])

    expect(
      fileState.files.has("cloud-assets/processed/00000000-0000-4000-8000-000000000001@1.png"),
    ).toBe(false)
    expect(
      fileState.files.has(
        "cloud-assets/processed/00000000-0000-4000-8000-000000000001@1.png.backup",
      ),
    ).toBe(false)
    const index = JSON.parse(String(fileState.files.get("cloud-assets/processed-index.json"))) as {
      assets: readonly { cacheKey: string }[]
    }
    expect(index.assets).toEqual([])
  })

  it("moves pin state to v2 and removes the pinned v1 after a safe write", async () => {
    await nativeCloudAssetCache.saveCatalog([catalogAsset(ASSET_ONE, "one", 1)])
    await nativeCloudAssetCache.saveProcessed({ id: ASSET_ONE, version: 1 }, new Blob(["old"]))
    await nativeCloudAssetCache.setPinned([ASSET_ONE], true)
    await nativeCloudAssetCache.saveCatalog([catalogAsset(ASSET_ONE, "one", 2)])
    await nativeCloudAssetCache.saveProcessed({ id: ASSET_ONE, version: 2 }, new Blob(["new"]))

    expect(
      fileState.files.has("cloud-assets/processed/00000000-0000-4000-8000-000000000001@1.png"),
    ).toBe(false)
    const index = JSON.parse(String(fileState.files.get("cloud-assets/processed-index.json"))) as {
      assets: readonly { cacheKey: string; pinned: boolean }[]
    }
    expect(index.assets).toEqual([
      { cacheKey: `${ASSET_ONE}@2`, id: ASSET_ONE, version: 2, bytes: 3, pinned: true },
    ])
  })

  it("does not report a retained pinned v1 when catalog metadata is v2", async () => {
    await nativeCloudAssetCache.saveCatalog([catalogAsset(ASSET_ONE, "one", 1)])
    await nativeCloudAssetCache.saveProcessed({ id: ASSET_ONE, version: 1 }, new Blob(["old"]))
    await nativeCloudAssetCache.setPinned([ASSET_ONE], true)
    await nativeCloudAssetCache.saveCatalog([catalogAsset(ASSET_ONE, "one", 2)])

    const summary = await nativeCloudAssetCache.getOfflineCacheSummary()
    expect(summary.assets).toEqual([])
    expect(summary.bytes).toBe(0)
    expect(summary.pinnedCount).toBe(0)
  })

  it("does not let an older catalog page roll back v2 or remove its processed blob", async () => {
    await nativeCloudAssetCache.saveCatalog([catalogAsset(ASSET_ONE, "one", 1)])
    await nativeCloudAssetCache.saveCatalog([catalogAsset(ASSET_ONE, "one-v2", 2)])
    await nativeCloudAssetCache.saveProcessed({ id: ASSET_ONE, version: 2 }, new Blob(["new"]))

    await nativeCloudAssetCache.saveCatalog([catalogAsset(ASSET_ONE, "stale-v1", 1)])

    const catalog = await nativeCloudAssetCache.listCatalog({
      category: "",
      limit: 10,
      offset: 0,
      search: "",
    })
    expect(catalog.assets[0]).toMatchObject({ id: ASSET_ONE, version: 2, name: "one-v2" })
    const processed = await nativeCloudAssetCache.readProcessed([{ id: ASSET_ONE, version: 2 }])
    expect(processed.has(ASSET_ONE)).toBe(true)
  })

  it("does not let a late lower processed response replace v2", async () => {
    await nativeCloudAssetCache.saveProcessed({ id: ASSET_ONE, version: 2 }, new Blob(["new"]))
    await nativeCloudAssetCache.saveProcessed({ id: ASSET_ONE, version: 1 }, new Blob(["old"]))

    const processed = await nativeCloudAssetCache.readProcessed([{ id: ASSET_ONE, version: 2 }])
    expect(await processed.get(ASSET_ONE)?.text()).toBe("new")
    const stale = await nativeCloudAssetCache.readProcessed([{ id: ASSET_ONE, version: 1 }])
    expect(stale.has(ASSET_ONE)).toBe(false)
  })

  it("continues the mutation queue after an asynchronous write failure", async () => {
    fileState.failNextIndexWrite = true
    await expect(
      nativeCloudAssetCache.saveProcessed({ id: ASSET_ONE, version: 1 }, new Blob(["one"])),
    ).rejects.toThrow("index write failed")

    await nativeCloudAssetCache.saveProcessed({ id: ASSET_TWO, version: 1 }, new Blob(["two"]))

    const processed = await nativeCloudAssetCache.readProcessed([{ id: ASSET_TWO, version: 1 }])
    expect(processed.has(ASSET_TWO)).toBe(true)
  })

  it("continues the mutation queue after a synchronous file error", async () => {
    fileState.files.set("cloud-assets/processed-index.json", '{"schemaVersion":1,"assets":[]}')
    fileState.failNextReadSync = true
    await expect(
      nativeCloudAssetCache.saveProcessed({ id: ASSET_ONE, version: 1 }, new Blob(["one"])),
    ).rejects.toThrow("sync read failed")

    await nativeCloudAssetCache.saveProcessed({ id: ASSET_TWO, version: 1 }, new Blob(["two"]))

    const processed = await nativeCloudAssetCache.readProcessed([{ id: ASSET_TWO, version: 1 }])
    expect(processed.has(ASSET_TWO)).toBe(true)
  })

  it("falls back to a valid catalog backup and repairs primary without replacing backup", async () => {
    const backup = JSON.stringify({ schemaVersion: 1, assets: [] })
    fileState.files.set("cloud-assets/catalog.json", "not-json")
    fileState.files.set("cloud-assets/catalog.json.backup", backup)

    await expect(
      nativeCloudAssetCache.listCatalog({ category: "", limit: 10, offset: 0, search: "" }),
    ).resolves.toEqual({ assets: [], hasMore: false })
    expect(fileState.files.get("cloud-assets/catalog.json")).toBe(backup)
    expect(fileState.files.get("cloud-assets/catalog.json.backup")).toBe(backup)
  })

  it("falls back to a valid processed-index backup and repairs primary", async () => {
    const backup = JSON.stringify({
      schemaVersion: 1,
      assets: [
        {
          cacheKey: `${ASSET_ONE}@1`,
          id: ASSET_ONE,
          version: 1,
          bytes: 3,
          pinned: false,
        },
      ],
    })
    fileState.files.set("cloud-assets/processed-index.json", "not-json")
    fileState.files.set("cloud-assets/processed-index.json.backup", backup)
    fileState.files.set(
      "cloud-assets/processed/00000000-0000-4000-8000-000000000001@1.png",
      new Uint8Array([1, 2, 3]),
    )

    const processed = await nativeCloudAssetCache.readProcessed([{ id: ASSET_ONE, version: 1 }])
    expect(processed.has(ASSET_ONE)).toBe(true)
    expect(fileState.files.get("cloud-assets/processed-index.json")).toBe(backup)
    expect(fileState.files.get("cloud-assets/processed-index.json.backup")).toBe(backup)
  })

  it("falls back to a valid binary backup when the primary is missing and repairs primary", async () => {
    const index = JSON.stringify({
      schemaVersion: 1,
      assets: [{ cacheKey: `${ASSET_ONE}@2`, id: ASSET_ONE, version: 2, bytes: 3, pinned: false }],
    })
    const bytes = new Uint8Array([1, 2, 3])
    fileState.files.set("cloud-assets/processed-index.json", index)
    fileState.files.set(
      "cloud-assets/processed/00000000-0000-4000-8000-000000000001@2.png.backup",
      bytes,
    )

    const processed = await nativeCloudAssetCache.readProcessed([{ id: ASSET_ONE, version: 2 }])
    expect(await processed.get(ASSET_ONE)?.arrayBuffer()).toEqual(bytes.buffer)
    expect(
      fileState.files.get("cloud-assets/processed/00000000-0000-4000-8000-000000000001@2.png"),
    ).toEqual(bytes)
    expect(
      fileState.files.get(
        "cloud-assets/processed/00000000-0000-4000-8000-000000000001@2.png.backup",
      ),
    ).toEqual(bytes)
  })

  it("falls back to a valid binary backup when reading primary fails and keeps backup", async () => {
    const index = JSON.stringify({
      schemaVersion: 1,
      assets: [{ cacheKey: `${ASSET_ONE}@2`, id: ASSET_ONE, version: 2, bytes: 3, pinned: false }],
    })
    const bytes = new Uint8Array([4, 5, 6])
    fileState.files.set("cloud-assets/processed-index.json", index)
    fileState.files.set("cloud-assets/processed/00000000-0000-4000-8000-000000000001@2.png", bytes)
    fileState.files.set(
      "cloud-assets/processed/00000000-0000-4000-8000-000000000001@2.png.backup",
      bytes,
    )
    fileState.failNextBinaryRead = true

    const processed = await nativeCloudAssetCache.readProcessed([{ id: ASSET_ONE, version: 2 }])
    expect(await processed.get(ASSET_ONE)?.arrayBuffer()).toEqual(bytes.buffer)
    expect(
      fileState.files.get(
        "cloud-assets/processed/00000000-0000-4000-8000-000000000001@2.png.backup",
      ),
    ).toEqual(bytes)
  })

  it("serves a validated backup when primary repair fails and preserves the backup", async () => {
    const backup = JSON.stringify({ schemaVersion: 1, assets: [] })
    fileState.files.set("cloud-assets/catalog.json", "not-json")
    fileState.files.set("cloud-assets/catalog.json.backup", backup)
    fileState.failNextPrimaryRepair = true

    await expect(
      nativeCloudAssetCache.listCatalog({ category: "", limit: 10, offset: 0, search: "" }),
    ).resolves.toEqual({ assets: [], hasMore: false })
    expect(fileState.files.get("cloud-assets/catalog.json.backup")).toBe(backup)
  })

  it("throws corruption only when neither primary nor backup validates", async () => {
    fileState.files.set("cloud-assets/catalog.json", "not-json")
    fileState.files.set("cloud-assets/catalog.json.backup", "also-not-json")

    await expect(
      nativeCloudAssetCache.listCatalog({ category: "", limit: 10, offset: 0, search: "" }),
    ).rejects.toMatchObject({ name: "NativeCloudAssetCacheCorruptError" })
  })
})
