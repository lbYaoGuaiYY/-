import type { LibraryAsset } from "../assets/asset-library"

type BackgroundImportController = {
  readonly addLibraryAsset: (asset: LibraryAsset) => Promise<void>
  readonly importBackground: (file: File) => Promise<boolean>
}

export async function importBackgroundThenAddAsset(
  controller: BackgroundImportController,
  file: File,
  pendingAsset: LibraryAsset | null,
): Promise<boolean> {
  const loaded = await controller.importBackground(file)
  if (pendingAsset === null || !loaded) return false
  await controller.addLibraryAsset(pendingAsset)
  return true
}
