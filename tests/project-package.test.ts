import { describe, expect, it, vi } from "vitest"

import { createAssetId } from "../src/features/editor/editor-model"
import {
  PROJECT_SCHEMA_VERSION,
  type ProjectSnapshot,
} from "../src/features/projects/project-format"
import {
  decodeProjectPackage,
  encodeProjectPackage,
  shareOrDownloadProjectPackage,
} from "../src/features/projects/project-package"

describe("editable project package", () => {
  it("round-trips the document and every referenced local asset", async () => {
    // Given a project whose background must travel with its editable document
    const backgroundId = createAssetId("local:background")
    const snapshot: ProjectSnapshot = {
      document: {
        canvasSize: { width: 1200, height: 800 },
        backgroundAssetId: backgroundId,
        layers: [],
      },
      localAssets: [
        {
          schemaVersion: PROJECT_SCHEMA_VERSION,
          id: backgroundId,
          name: "婚礼现场",
          mimeType: "image/png",
          blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
        },
      ],
    }

    // When the project is exported and imported as one package
    const packageBlob = await encodeProjectPackage(snapshot, "林先生婚礼方案")
    const decoded = await decodeProjectPackage(packageBlob)

    // Then the editable structure, name and binary asset are all restored
    expect(decoded.kind).toBe("valid")
    if (decoded.kind !== "valid") return
    expect(decoded.projectName).toBe("林先生婚礼方案")
    expect(decoded.snapshot.document).toEqual(snapshot.document)
    const restoredAsset = decoded.snapshot.localAssets[0]
    if (restoredAsset === undefined) throw new Error("Missing restored asset")
    expect(new Uint8Array(await restoredAsset.blob.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    )
  })

  it("rejects a package that omits a referenced local asset", async () => {
    // Given a valid package that is missing its required asset after tampering
    const backgroundId = createAssetId("local:missing")
    const snapshot: ProjectSnapshot = {
      document: {
        canvasSize: { width: 1200, height: 800 },
        backgroundAssetId: backgroundId,
        layers: [],
      },
      localAssets: [],
    }

    // When it is encoded at the project boundary
    const result = await encodeProjectPackage(snapshot, "损坏项目").catch(() => null)

    // Then invalid editable data is refused instead of producing a broken backup
    expect(result).toBeNull()
  })

  it("falls back to a browser download when mobile sharing is unavailable", async () => {
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined)
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined })
    Object.defineProperty(navigator, "canShare", { configurable: true, value: undefined })

    const result = await shareOrDownloadProjectPackage(
      new Blob(["zip"], { type: "application/zip" }),
      "项目.qingshe",
    )

    expect(result).toBe("downloaded")
    expect(anchorClick).toHaveBeenCalledOnce()
    anchorClick.mockRestore()
  })

  it("falls back to a browser download when mobile sharing is rejected", async () => {
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined)
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error("cancelled")),
    })
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: vi.fn().mockReturnValue(true),
    })

    const result = await shareOrDownloadProjectPackage(
      new Blob(["zip"], { type: "application/zip" }),
      "项目.qingshe",
    )

    expect(result).toBe("downloaded")
    expect(anchorClick).toHaveBeenCalledOnce()
    anchorClick.mockRestore()
  })
})
