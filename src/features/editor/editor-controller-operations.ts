import { registerProjectAssets } from "../projects/editor-project-assets"
import type { ProjectSnapshot } from "../projects/project-format"
import type { AssetRecord, AssetRegistry } from "./asset-registry"
import type { ClientPoint } from "./drag-placement"
import {
  type CanvasSize,
  createLayerId,
  type EditorDocument,
  INITIAL_EDITOR_DOCUMENT,
} from "./editor-model"
import type { FabricRuntime } from "./fabric-runtime"
import { type ImageFileResult, validateImageFile } from "./image-import"

export type BackgroundImportResult =
  | { readonly kind: "loaded"; readonly assetId: AssetRecord["id"]; readonly size: CanvasSize }
  | { readonly kind: "invalid"; readonly reason: ImageFileResult["kind"] }
  | { readonly kind: "failed" }

export async function importRuntimeBackground(
  runtime: FabricRuntime,
  assets: AssetRegistry,
  file: File,
): Promise<BackgroundImportResult> {
  const validation = await validateImageFile(file)
  if (validation.kind !== "valid") return { kind: "invalid", reason: validation.kind }
  const record = assets.registerFile(file)
  try {
    const size = await runtime.importBackground(record)
    if (size !== null) return { kind: "loaded", assetId: record.id, size }
  } catch {
    assets.discard(record.id)
    return { kind: "failed" }
  }
  assets.discard(record.id)
  return { kind: "failed" }
}

export async function restoreRuntimeProject(
  runtime: FabricRuntime,
  assets: AssetRegistry,
  snapshot: ProjectSnapshot,
): Promise<EditorDocument | null> {
  if (!registerProjectAssets(snapshot, assets)) return null
  try {
    await runtime.restore(snapshot.document, assets)
    return snapshot.document
  } catch {
    await runtime.restore(INITIAL_EDITOR_DOCUMENT, assets)
    return null
  }
}

export async function addRuntimeLayer(
  runtime: FabricRuntime,
  record: AssetRecord,
  canvasSize: CanvasSize,
  center: ClientPoint | null,
): Promise<boolean> {
  return runtime.addLayer(record, createLayerId(crypto.randomUUID()), { canvasSize, center })
}

export async function downloadRuntimePng(runtime: FabricRuntime): Promise<boolean> {
  const blob = await runtime.exportPng()
  if (blob === null) return false
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `轻设设计-${new Date().toISOString().slice(0, 10)}.png`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return true
}
