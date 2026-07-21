import { afterEach, describe, expect, it, vi } from "vitest"
import type { LibraryAsset } from "../src/features/assets/asset-library"
import { CloudAssetCache } from "../src/features/assets/cloud-asset-cache"
import { AssetRegistry } from "../src/features/editor/asset-registry"
import { createAssetId } from "../src/features/editor/editor-model"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("AssetRegistry persistence sources", () => {
  it("retains the original Blob for a local file", () => {
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:local-file"),
      revokeObjectURL,
    })
    const registry = new AssetRegistry()
    const file = new File(["image"], "flower.png", { type: "image/png" })

    const record = registry.registerFile(file)
    const local = registry.getLocalAsset(record.id)

    expect(local?.blob).toBe(file)
    expect(local?.mimeType).toBe("image/png")
    registry.dispose()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-file")
  })

  it("restores a local Blob under its stable persisted ID", () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:restored"),
      revokeObjectURL: vi.fn(),
    })
    const registry = new AssetRegistry()
    const id = createAssetId("local:persisted")
    const blob = new Blob(["image"], { type: "image/webp" })

    const record = registry.registerLocalAsset({ id, name: "绿植", mimeType: "image/webp", blob })

    expect(record.id).toBe(id)
    expect(record.src).toBe("blob:restored")
    expect(registry.getLocalAsset(id)?.blob).toBe(blob)
  })

  it("still registers a cloud asset when the optional cache write fails", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cloud-asset")
    vi.spyOn(CloudAssetCache.prototype, "saveProcessed").mockRejectedValueOnce(
      new Error("quota exceeded"),
    )
    const blob = new Blob(["image"], { type: "image/png" })
    const asset = {
      id: "cloud-asset",
      assetId: createAssetId("local:catalog:cloud-asset"),
      name: "云素材",
      category: "其他",
      src: "https://assets.example.test/processed.png",
      width: 1,
      height: 1,
      source: {
        kind: "managed",
        localAsset: {
          id: createAssetId("local:catalog:cloud-asset"),
          name: "云素材",
          mimeType: "image/png",
          blob,
        },
        processedUrl: "https://assets.example.test/processed.png",
        serviceAsset: { id: "00000000-0000-4000-8000-000000000001", version: 1 },
      },
    } satisfies LibraryAsset

    const record = await new AssetRegistry().registerLibraryAsset(asset)

    expect(record.localAsset?.blob).toBe(blob)
    expect(record.src).toBe("blob:cloud-asset")
  })
})
