import Dexie, { type Table } from "dexie"
import { z } from "zod"
import { isDesktopRuntime } from "../../platform/runtime"
import type { ServiceAsset } from "./asset-service-client"
import {
  isCurrentProcessedVersion,
  planCatalogVersionPrune,
  planProcessedVersionWrite,
} from "./cloud-asset-cache-versioning"
import { ASSET_CATEGORIES, type AssetCategory } from "./demo-assets"
import { nativeCloudAssetCache } from "./native-cloud-asset-cache"

const DATABASE_NAME = "qingshe-cloud-asset-cache-v1"
const CATALOG_RECORD_VERSION = 1 as const

const CachedServiceAssetSchema = z.object({
  schemaVersion: z.literal(CATALOG_RECORD_VERSION),
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  category: z.enum(ASSET_CATEGORIES),
  status: z.string(),
  mime_type: z.string(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  needs_review: z.boolean(),
  favorite: z.boolean(),
  dominant_color: z.string().nullable(),
  tags: z.array(z.string()),
  usage_count: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
  cachedAt: z.number().int().nonnegative(),
})
const CachedProcessedAssetSchema = z.object({
  cacheKey: z.string().min(1),
  id: z.string().uuid(),
  version: z.number().int().positive(),
  blob: z.instanceof(Blob),
  pinned: z.boolean().default(false),
})

type CachedServiceAsset = z.infer<typeof CachedServiceAssetSchema>
type CachedProcessedAsset = z.infer<typeof CachedProcessedAssetSchema>

export type CachedCatalogQuery = {
  readonly category: AssetCategory | ""
  readonly limit: number
  readonly offset: number
  readonly search: string
}

export type CachedCatalogPage = {
  readonly assets: readonly ServiceAsset[]
  readonly hasMore: boolean
}

export type OfflineCachedAsset = {
  readonly id: string
  readonly version: number
  readonly name: string
  readonly category: AssetCategory | null
  readonly favorite: boolean
  readonly bytes: number
  readonly pinned: boolean
}

export type OfflineCacheSummary = {
  readonly assets: readonly OfflineCachedAsset[]
  readonly bytes: number
  readonly pinnedCount: number
}

export type OfflineCacheClearResult = {
  readonly bytes: number
  readonly count: number
}

class CloudAssetCacheDatabase extends Dexie {
  readonly catalog!: Table<CachedServiceAsset, string>
  readonly processed!: Table<CachedProcessedAsset, string>

  constructor() {
    super(DATABASE_NAME)
    this.version(1).stores({ catalog: "id, category, cachedAt", processed: "cacheKey, id" })
    this.version(2).stores({ catalog: "id, category, cachedAt", processed: "cacheKey, id, pinned" })
  }
}

export class CloudAssetCache {
  async saveCatalog(assets: readonly ServiceAsset[]): Promise<void> {
    if (assets.length === 0) return
    if (isDesktopRuntime()) {
      await nativeCloudAssetCache.saveCatalog(assets)
      return
    }
    const cachedAt = Date.now()
    const records = assets.map((asset) =>
      CachedServiceAssetSchema.parse({ ...asset, cachedAt, schemaVersion: CATALOG_RECORD_VERSION }),
    )
    const incomingById = new Map<string, CachedServiceAsset>()
    for (const record of records) {
      const previous = incomingById.get(record.id)
      if (previous === undefined || record.version >= previous.version) {
        incomingById.set(record.id, record)
      }
    }
    await this.withDatabase(async (database) => {
      await database.transaction("rw", database.catalog, database.processed, async () => {
        const incoming = [...incomingById.values()]
        const existing = await database.catalog.bulkGet(incoming.map((record) => record.id))
        const accepted: CachedServiceAsset[] = []
        const advancedVersions = new Map<string, number>()
        for (const [index, record] of incoming.entries()) {
          const previous = existing[index]
          if (previous !== undefined) {
            const parsedPrevious = CachedServiceAssetSchema.parse(previous)
            if (record.version < parsedPrevious.version) continue
            if (record.version > parsedPrevious.version) {
              advancedVersions.set(record.id, record.version)
            }
          } else {
            advancedVersions.set(record.id, record.version)
          }
          accepted.push(record)
        }
        if (accepted.length > 0) await database.catalog.bulkPut(accepted)
        if (advancedVersions.size === 0) return
        const processed = (
          await database.processed
            .where("id")
            .anyOf([...advancedVersions.keys()])
            .toArray()
        ).map((candidate) => CachedProcessedAssetSchema.parse(candidate))
        const staleCacheKeys = planCatalogVersionPrune(processed, advancedVersions)
        if (staleCacheKeys.length > 0) await database.processed.bulkDelete([...staleCacheKeys])
      })
    })
  }

  async listCatalog(query: CachedCatalogQuery): Promise<CachedCatalogPage> {
    if (isDesktopRuntime()) return nativeCloudAssetCache.listCatalog(query)
    return this.withDatabase(async (database) => {
      const normalizedSearch = query.search.toLocaleLowerCase("zh-CN")
      const records = (await database.catalog.toArray())
        .map((record) => CachedServiceAssetSchema.parse(record))
        .filter((record) => {
          if (query.category !== "" && record.category !== query.category) return false
          return `${record.code} ${record.name} ${record.category} ${record.tags.join(" ")}`
            .toLocaleLowerCase("zh-CN")
            .includes(normalizedSearch)
        })
        .sort((left, right) => right.cachedAt - left.cachedAt)
      const assets = records.slice(query.offset, query.offset + query.limit).map(toServiceAsset)
      return { assets, hasMore: query.offset + assets.length < records.length }
    })
  }

  async saveProcessed(asset: Pick<ServiceAsset, "id" | "version">, blob: Blob): Promise<void> {
    if (isDesktopRuntime()) {
      await nativeCloudAssetCache.saveProcessed(asset, blob)
      return
    }
    const record = CachedProcessedAssetSchema.parse({
      cacheKey: createProcessedCacheKey(asset),
      id: asset.id,
      version: asset.version,
      blob,
      pinned: false,
    })
    await this.withDatabase(async (database) => {
      await database.transaction("rw", database.processed, async () => {
        const existing = (await database.processed.where("id").equals(record.id).toArray()).map(
          (candidate) => CachedProcessedAssetSchema.parse(candidate),
        )
        const plan = planProcessedVersionWrite(existing, record)
        if (!plan.shouldWrite) return
        await database.processed.put(plan.record)
        if (plan.staleCacheKeys.length > 0) {
          await database.processed.bulkDelete([...plan.staleCacheKeys])
        }
      })
    })
  }

  async readProcessed(
    assets: readonly Pick<ServiceAsset, "id" | "version">[],
  ): Promise<ReadonlyMap<string, Blob>> {
    if (assets.length === 0) return new Map()
    if (isDesktopRuntime()) return nativeCloudAssetCache.readProcessed(assets)
    return this.withDatabase(async (database) => {
      const records = await database.processed.bulkGet(assets.map(createProcessedCacheKey))
      const processed = new Map<string, Blob>()
      for (const record of records) {
        if (record === undefined) continue
        const parsed = CachedProcessedAssetSchema.parse(record)
        processed.set(parsed.id, parsed.blob)
      }
      return processed
    })
  }

  async getOfflineCacheSummary(): Promise<OfflineCacheSummary> {
    if (isDesktopRuntime()) return nativeCloudAssetCache.getOfflineCacheSummary()
    return this.withDatabase(async (database) => {
      const catalog = new Map(
        (await database.catalog.toArray())
          .map((record) => CachedServiceAssetSchema.parse(record))
          .map((record) => [record.id, record] as const),
      )
      const assets = (await database.processed.toArray())
        .map((record) => CachedProcessedAssetSchema.parse(record))
        .filter((record) => isCurrentProcessedVersion(record, catalog.get(record.id)?.version))
        .map((record) => toOfflineCachedAsset(record, catalog.get(record.id)))
        .sort(
          (left, right) => right.bytes - left.bytes || left.name.localeCompare(right.name, "zh-CN"),
        )
      return {
        assets,
        bytes: assets.reduce((total, asset) => total + asset.bytes, 0),
        pinnedCount: assets.filter((asset) => asset.pinned).length,
      }
    })
  }

  async setPinned(assetIds: readonly string[], pinned: boolean): Promise<number> {
    if (assetIds.length === 0) return 0
    if (isDesktopRuntime()) return nativeCloudAssetCache.setPinned(assetIds, pinned)
    const targets = new Set(assetIds)
    return this.withDatabase(async (database) => {
      return database.transaction("rw", database.processed, async () => {
        const updates = (await database.processed.toArray())
          .map((record) => CachedProcessedAssetSchema.parse(record))
          .filter((record) => targets.has(record.id) && record.pinned !== pinned)
          .map((record) => ({ ...record, pinned }))
        if (updates.length > 0) await database.processed.bulkPut(updates)
        return updates.length
      })
    })
  }

  async clearUnpinned(): Promise<OfflineCacheClearResult> {
    if (isDesktopRuntime()) return nativeCloudAssetCache.clearUnpinned()
    return this.withDatabase(async (database) => {
      return database.transaction("rw", database.processed, async () => {
        const removable = (await database.processed.toArray())
          .map((record) => CachedProcessedAssetSchema.parse(record))
          .filter((record) => !record.pinned)
        if (removable.length > 0)
          await database.processed.bulkDelete(removable.map((record) => record.cacheKey))
        return {
          bytes: removable.reduce((total, record) => total + record.blob.size, 0),
          count: removable.length,
        }
      })
    })
  }

  async clearAssets(assetIds: readonly string[]): Promise<OfflineCacheClearResult> {
    if (assetIds.length === 0) return { bytes: 0, count: 0 }
    if (isDesktopRuntime()) return nativeCloudAssetCache.clearAssets(assetIds)
    const targets = new Set(assetIds)
    return this.withDatabase(async (database) => {
      return database.transaction("rw", database.processed, async () => {
        const removable = (await database.processed.toArray())
          .map((record) => CachedProcessedAssetSchema.parse(record))
          .filter((record) => targets.has(record.id))
        if (removable.length > 0) {
          await database.processed.bulkDelete(removable.map((record) => record.cacheKey))
        }
        return {
          bytes: removable.reduce((total, record) => total + record.blob.size, 0),
          count: removable.length,
        }
      })
    })
  }

  private async withDatabase<T>(
    operation: (database: CloudAssetCacheDatabase) => Promise<T>,
  ): Promise<T> {
    const database = new CloudAssetCacheDatabase()
    try {
      await database.open()
      return await operation(database)
    } finally {
      database.close()
    }
  }
}

function createProcessedCacheKey(asset: Pick<ServiceAsset, "id" | "version">): string {
  return `${asset.id}@${asset.version}`
}

function toServiceAsset(record: CachedServiceAsset): ServiceAsset {
  const { cachedAt: _cachedAt, schemaVersion: _schemaVersion, ...asset } = record
  return asset
}

function toOfflineCachedAsset(
  record: CachedProcessedAsset,
  catalog: CachedServiceAsset | undefined,
): OfflineCachedAsset {
  return {
    id: record.id,
    version: record.version,
    name: catalog?.name ?? `素材 ${record.id.slice(0, 8)}`,
    category: catalog?.category ?? null,
    favorite: catalog?.favorite ?? false,
    bytes: record.blob.size,
    pinned: record.pinned,
  }
}
