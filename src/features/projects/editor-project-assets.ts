import { DEMO_ASSETS } from "../assets/demo-assets"
import type { AssetRegistry } from "../editor/asset-registry"
import type { EditorDocument } from "../editor/editor-model"
import {
  collectReferencedAssetIds,
  PROJECT_SCHEMA_VERSION,
  type ProjectSnapshot,
} from "./project-format"

export function captureProjectSnapshot(
  document: EditorDocument,
  registry: AssetRegistry,
): ProjectSnapshot | null {
  const localAssets = []
  for (const id of collectReferencedAssetIds(document)) {
    const record = registry.get(id)
    if (record === undefined) return null
    if (!id.startsWith("local:")) continue
    const localAsset = registry.getLocalAsset(id)
    if (localAsset === undefined) return null
    localAssets.push({ schemaVersion: PROJECT_SCHEMA_VERSION, ...localAsset })
  }
  return { document, localAssets }
}

export function registerProjectAssets(snapshot: ProjectSnapshot, registry: AssetRegistry): boolean {
  for (const localAsset of snapshot.localAssets) registry.registerLocalAsset(localAsset)

  const builtInById = new Map(DEMO_ASSETS.map((asset) => [`built-in:${asset.id}`, asset]))
  for (const id of collectReferencedAssetIds(snapshot.document)) {
    if (!id.startsWith("built-in:")) continue
    const asset = builtInById.get(id)
    if (asset === undefined) return false
    registry.registerBuiltIn(asset)
  }
  return true
}
