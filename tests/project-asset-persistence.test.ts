import { describe, expect, it } from "vitest"

import {
  createAssetId,
  createLayerId,
  DEFAULT_LAYER_TRANSFORM,
  type EditorDocument,
} from "../src/features/editor/editor-model"
import {
  findOrphanLocalAssetIds,
  selectUnstoredLocalAssets,
} from "../src/features/projects/project-asset-persistence"
import {
  createStoredProject,
  PROJECT_SCHEMA_VERSION,
  type StoredLocalAssetRecord,
} from "../src/features/projects/project-format"

function localAsset(id: string): StoredLocalAssetRecord {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: createAssetId(id),
    name: id,
    mimeType: "image/png",
    blob: new Blob([id], { type: "image/png" }),
  }
}

function documentWithAsset(id: string): EditorDocument {
  const assetId = createAssetId(id)
  return {
    canvasSize: { width: 1200, height: 800 },
    backgroundAssetId: null,
    layers: [
      {
        id: createLayerId(`layer:${id}`),
        assetId,
        name: id,
        visible: true,
        locked: false,
        transform: DEFAULT_LAYER_TRANSFORM,
      },
    ],
  }
}

describe("project asset persistence", () => {
  it("does not rewrite immutable blobs that are already stored", () => {
    // Given
    const existing = localAsset("local:existing")
    const added = localAsset("local:added")

    // When
    const result = selectUnstoredLocalAssets([existing, added], new Set([existing.id]))

    // Then
    expect(result.map((asset) => asset.id)).toEqual([added.id])
  })

  it("keeps shared blobs and returns only unreferenced blobs for cleanup", () => {
    // Given
    const shared = "local:shared"
    const removed = "local:removed"
    const projects = [createStoredProject(documentWithAsset(shared), 10)]

    // When
    const result = findOrphanLocalAssetIds(projects, [shared, removed])

    // Then
    expect(result).toEqual([removed])
  })
})
