import { describe, expect, it, vi } from "vitest"
import type { LibraryAsset } from "../src/features/assets/asset-library"
import { importBackgroundThenAddAsset } from "../src/features/editor/background-import-flow"

const asset = {
  id: "asset:test",
  name: "测试素材",
} as LibraryAsset

function createController(importSucceeded: boolean) {
  return {
    addLibraryAsset: vi.fn(async () => undefined),
    importBackground: vi.fn(async () => importSucceeded),
  }
}

describe("background import flow", () => {
  it("adds the asset that initiated the background picker after a successful import", async () => {
    const controller = createController(true)
    const file = new File(["image"], "background.png", { type: "image/png" })

    await expect(importBackgroundThenAddAsset(controller, file, asset)).resolves.toBe(true)
    expect(controller.importBackground).toHaveBeenCalledWith(file)
    expect(controller.addLibraryAsset).toHaveBeenCalledWith(asset)
  })

  it("does not add the pending asset when background import fails", async () => {
    const controller = createController(false)

    await expect(
      importBackgroundThenAddAsset(
        controller,
        new File(["bad"], "background.png", { type: "image/png" }),
        asset,
      ),
    ).resolves.toBe(false)
    expect(controller.addLibraryAsset).not.toHaveBeenCalled()
  })

  it("supports a normal background import without a pending asset", async () => {
    const controller = createController(true)

    await expect(
      importBackgroundThenAddAsset(
        controller,
        new File(["image"], "background.png", { type: "image/png" }),
        null,
      ),
    ).resolves.toBe(false)
    expect(controller.addLibraryAsset).not.toHaveBeenCalled()
  })
})
