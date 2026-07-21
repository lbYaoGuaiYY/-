import type { LocalAssetSource } from "../editor/asset-registry"
import { type AssetId, createAssetId } from "../editor/editor-model"
import type { ServiceAsset } from "./asset-service-client"
import { serviceAssetMediaUrl } from "./asset-service-client"
import { type AssetCategory, DEMO_ASSETS, type DemoAsset } from "./demo-assets"
import type { ManagedAssetRecord } from "./managed-asset-store"

type BuiltInAssetSource = {
  readonly kind: "built-in"
  readonly asset: DemoAsset
}

type ManagedAssetSource = {
  readonly kind: "managed"
  readonly localAsset: LocalAssetSource | null
  readonly processedUrl: string
  readonly serviceAsset?: Pick<ServiceAsset, "id" | "version"> | null
}

export type LibraryAsset = {
  readonly id: string
  readonly assetId: AssetId
  readonly name: string
  readonly category: AssetCategory
  readonly src: string
  readonly thumbnailSrc?: string
  readonly width: number
  readonly height: number
  readonly source: BuiltInAssetSource | ManagedAssetSource
}

export type ServiceAssetObjectUrlCache = Map<string, string>

export function serviceAssetVersionKey(asset: Pick<ServiceAsset, "id" | "version">): string {
  return `${asset.id}@${asset.version}`
}

/** Revoke cached Blob URLs that are no longer represented by the rendered catalog. */
export function revokeUnusedServiceAssetObjectUrls(
  cache: ServiceAssetObjectUrlCache,
  activeKeys: ReadonlySet<string>,
): void {
  for (const [key, url] of cache) {
    if (activeKeys.has(key)) continue
    URL.revokeObjectURL(url)
    cache.delete(key)
  }
}

export const BUILT_IN_LIBRARY_ASSETS: readonly LibraryAsset[] = DEMO_ASSETS.map((asset) => ({
  id: asset.id,
  assetId: createAssetId(`built-in:${asset.id}`),
  name: asset.name,
  category: asset.category,
  src: asset.src,
  width: asset.width,
  height: asset.height,
  source: { kind: "built-in", asset },
}))

export function createManagedLibraryAsset(record: ManagedAssetRecord, src: string): LibraryAsset {
  return {
    id: String(record.id).slice("local:catalog:".length),
    assetId: record.id,
    name: record.name,
    category: record.category,
    src,
    width: record.width,
    height: record.height,
    source: {
      kind: "managed",
      localAsset: {
        id: record.id,
        name: record.name,
        mimeType: record.mimeType,
        blob: record.blob,
      },
      processedUrl: src,
      serviceAsset: null,
    },
  }
}

export function createServiceLibraryAsset(
  asset: ServiceAsset,
  processedBlob?: Blob,
  objectUrlCache?: ServiceAssetObjectUrlCache,
): LibraryAsset {
  const processedUrl = serviceAssetMediaUrl(asset.id, "processed", asset.version)
  const cacheKey = serviceAssetVersionKey(asset)
  let sourceUrl = processedUrl
  if (processedBlob !== undefined) {
    sourceUrl = objectUrlCache?.get(cacheKey) ?? URL.createObjectURL(processedBlob)
    objectUrlCache?.set(cacheKey, sourceUrl)
  }
  return {
    id: asset.id,
    assetId: createAssetId(`local:catalog:${asset.id}`),
    name: asset.name,
    category: asset.category,
    src: sourceUrl,
    thumbnailSrc:
      processedBlob === undefined
        ? serviceAssetMediaUrl(asset.id, "thumbnail", asset.version)
        : sourceUrl,
    width: asset.width,
    height: asset.height,
    source: {
      kind: "managed",
      localAsset:
        processedBlob === undefined
          ? null
          : {
              id: createAssetId(`local:catalog:${asset.id}`),
              name: asset.name,
              mimeType: "image/png",
              blob: processedBlob,
            },
      processedUrl,
      serviceAsset: { id: asset.id, version: asset.version },
    },
  }
}

export function getServiceAssetId(assetId: AssetId): string | null {
  const catalogPrefix = "local:catalog:"
  const serialized = String(assetId)
  return serialized.startsWith(catalogPrefix) ? serialized.slice(catalogPrefix.length) : null
}
