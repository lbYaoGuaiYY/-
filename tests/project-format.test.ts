import { describe, expect, it } from "vitest"

import { createAssetId, createLayerId } from "../src/features/editor/editor-model"
import {
  parseStoredLocalAsset,
  parseStoredProject,
  validateProjectSnapshot,
} from "../src/features/projects/project-format"

const localId = createAssetId("local:background")
const builtInId = createAssetId("built-in:floral-arch")

function validDocument() {
  return {
    canvasSize: { width: 1200, height: 800 },
    backgroundAssetId: localId,
    layers: [
      {
        id: createLayerId("layer-1"),
        assetId: builtInId,
        name: "花艺拱门",
        transform: {
          x: 600,
          y: 400,
          scaleX: 1,
          scaleY: 1,
          angle: 0,
          flipX: false,
          flipY: false,
          opacity: 1,
        },
      },
    ],
  }
}

describe("project format", () => {
  it("rejects non-finite transforms and out-of-range opacity", () => {
    const document = validDocument()
    const result = parseStoredProject({
      schemaVersion: 1,
      updatedAt: 10,
      document: {
        ...document,
        layers: [
          {
            ...document.layers[0],
            transform: { ...document.layers[0]?.transform, x: Number.NaN, opacity: 2 },
          },
        ],
      },
    })

    expect(result.kind).toBe("corrupt")
  })

  it("parses a local asset Blob without reducing it to a blob URL", () => {
    const blob = new Blob(["image"], { type: "image/png" })
    const result = parseStoredLocalAsset({
      schemaVersion: 1,
      id: localId,
      name: "底图",
      mimeType: "image/png",
      blob,
    })

    expect(result).toEqual({
      kind: "valid",
      value: { schemaVersion: 1, id: localId, name: "底图", mimeType: "image/png", blob },
    })
  })

  it("marks the whole project corrupt when one referenced local Blob is missing", () => {
    const projectResult = parseStoredProject({
      schemaVersion: 1,
      updatedAt: 10,
      document: validDocument(),
    })
    expect(projectResult.kind).toBe("valid")
    if (projectResult.kind !== "valid") return

    const result = validateProjectSnapshot(projectResult.value, [], new Set([builtInId]))

    expect(result.kind).toBe("corrupt")
  })

  it("marks the whole project corrupt when a built-in ID is unknown", () => {
    const document = validDocument()
    const projectResult = parseStoredProject({
      schemaVersion: 1,
      updatedAt: 10,
      document: {
        ...document,
        layers: [{ ...document.layers[0], assetId: createAssetId("built-in:removed") }],
      },
    })
    const localAssetResult = parseStoredLocalAsset({
      schemaVersion: 1,
      id: localId,
      name: "底图",
      mimeType: "image/png",
      blob: new Blob(["image"], { type: "image/png" }),
    })
    expect(projectResult.kind).toBe("valid")
    expect(localAssetResult.kind).toBe("valid")
    if (projectResult.kind !== "valid" || localAssetResult.kind !== "valid") return

    expect(
      validateProjectSnapshot(projectResult.value, [localAssetResult.value], new Set()),
    ).toEqual({
      kind: "corrupt",
    })
  })
})
