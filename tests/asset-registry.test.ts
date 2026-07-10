import { afterEach, describe, expect, it, vi } from "vitest"

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
})
