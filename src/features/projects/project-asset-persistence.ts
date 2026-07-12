import {
  collectReferencedAssetIds,
  type StoredLocalAssetRecord,
  type StoredProjectRecord,
} from "./project-format"

export function selectUnstoredLocalAssets(
  localAssets: readonly StoredLocalAssetRecord[],
  storedAssetIds: ReadonlySet<string>,
): readonly StoredLocalAssetRecord[] {
  return localAssets.filter((asset) => !storedAssetIds.has(asset.id))
}

export function findOrphanLocalAssetIds(
  projects: readonly StoredProjectRecord[],
  storedAssetIds: readonly string[],
): string[] {
  const referenced = new Set<string>()
  for (const project of projects) {
    for (const assetId of collectReferencedAssetIds(project.document)) {
      if (assetId.startsWith("local:")) referenced.add(assetId)
    }
  }
  return storedAssetIds.filter((assetId) => !referenced.has(assetId))
}
