import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  readTextFile,
  remove,
  rename,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs"
import { z } from "zod"

import { type ServiceAsset, ServiceAssetSchema } from "./asset-service-client"
import type {
  CachedCatalogPage,
  CachedCatalogQuery,
  OfflineCacheClearResult,
  OfflineCacheSummary,
} from "./cloud-asset-cache"

const ROOT_DIRECTORY = "cloud-assets"
const PROCESSED_DIRECTORY = `${ROOT_DIRECTORY}/processed`
const CATALOG_PATH = `${ROOT_DIRECTORY}/catalog.json`
const PROCESSED_INDEX_PATH = `${ROOT_DIRECTORY}/processed-index.json`
const NATIVE_CACHE_VERSION = 1 as const

const NativeCatalogRecordSchema = z.object({
  asset: ServiceAssetSchema,
  cachedAt: z.number().int().nonnegative(),
})
const NativeCatalogFileSchema = z.object({
  schemaVersion: z.literal(NATIVE_CACHE_VERSION),
  assets: z.array(NativeCatalogRecordSchema),
})
const NativeProcessedRecordSchema = z.object({
  cacheKey: z.string().min(1),
  id: z.string().uuid(),
  version: z.number().int().positive(),
  bytes: z.number().int().nonnegative(),
  pinned: z.boolean(),
})
const NativeProcessedIndexSchema = z.object({
  schemaVersion: z.literal(NATIVE_CACHE_VERSION),
  assets: z.array(NativeProcessedRecordSchema),
})

type NativeCatalogFile = z.infer<typeof NativeCatalogFileSchema>
type NativeProcessedRecord = z.infer<typeof NativeProcessedRecordSchema>
type NativeProcessedIndex = z.infer<typeof NativeProcessedIndexSchema>

export const nativeCloudAssetCache = {
  async saveCatalog(assets: readonly ServiceAsset[]): Promise<void> {
    if (assets.length === 0) return
    const existing = await readCatalog()
    const records = new Map(existing.assets.map((record) => [record.asset.id, record]))
    const cachedAt = Date.now()
    for (const asset of assets) records.set(asset.id, { asset, cachedAt })
    await writeJson(CATALOG_PATH, {
      schemaVersion: NATIVE_CACHE_VERSION,
      assets: [...records.values()],
    } satisfies NativeCatalogFile)
  },

  async listCatalog(query: CachedCatalogQuery): Promise<CachedCatalogPage> {
    const records = (await readCatalog()).assets
      .filter((record) => query.category === "" || record.asset.category === query.category)
      .filter((record) => {
        const searchable = `${record.asset.code} ${record.asset.name} ${record.asset.category} ${record.asset.tags.join(" ")}`
        return searchable
          .toLocaleLowerCase("zh-CN")
          .includes(query.search.toLocaleLowerCase("zh-CN"))
      })
      .sort((left, right) => right.cachedAt - left.cachedAt)
    const assets = records
      .slice(query.offset, query.offset + query.limit)
      .map((record) => record.asset)
    return { assets, hasMore: query.offset + assets.length < records.length }
  },

  async saveProcessed(asset: Pick<ServiceAsset, "id" | "version">, blob: Blob): Promise<void> {
    const index = await readProcessedIndex()
    const cacheKey = createProcessedCacheKey(asset)
    const existing = index.assets.find((record) => record.cacheKey === cacheKey)
    await writeBinary(processedPath(asset), new Uint8Array(await blob.arrayBuffer()))
    const nextRecord: NativeProcessedRecord = {
      cacheKey,
      id: asset.id,
      version: asset.version,
      bytes: blob.size,
      pinned: existing?.pinned ?? false,
    }
    await writeProcessedIndex({
      schemaVersion: NATIVE_CACHE_VERSION,
      assets: [...index.assets.filter((record) => record.cacheKey !== cacheKey), nextRecord],
    })
  },

  async readProcessed(
    assets: readonly Pick<ServiceAsset, "id" | "version">[],
  ): Promise<ReadonlyMap<string, Blob>> {
    const index = await readProcessedIndex()
    const processed = new Map<string, Blob>()
    for (const asset of assets) {
      const record = index.assets.find(
        (candidate) => candidate.cacheKey === createProcessedCacheKey(asset),
      )
      if (
        record === undefined ||
        !(await exists(processedPath(asset), { baseDir: BaseDirectory.AppData }))
      )
        continue
      const bytes = await readFile(processedPath(asset), { baseDir: BaseDirectory.AppData })
      processed.set(asset.id, new Blob([bytes], { type: "image/png" }))
    }
    return processed
  },

  async getOfflineCacheSummary(): Promise<OfflineCacheSummary> {
    const [index, catalog] = await Promise.all([readProcessedIndex(), readCatalog()])
    const names = new Map(catalog.assets.map((record) => [record.asset.id, record.asset]))
    const available = await Promise.all(
      index.assets.map(async (record) => ({
        record,
        available: await exists(processedPath(record), { baseDir: BaseDirectory.AppData }),
      })),
    )
    const assets = available
      .filter(({ record, available: isAvailable }) => names.has(record.id) && isAvailable)
      .map(({ record }) => {
        const asset = names.get(record.id)
        return {
          id: record.id,
          version: record.version,
          name: asset?.name ?? `素材 ${record.id.slice(0, 8)}`,
          category: asset?.category ?? null,
          favorite: asset?.favorite ?? false,
          bytes: record.bytes,
          pinned: record.pinned,
        }
      })
    return {
      assets,
      bytes: assets.reduce((total, asset) => total + asset.bytes, 0),
      pinnedCount: assets.filter((asset) => asset.pinned).length,
    }
  },

  async setPinned(assetIds: readonly string[], pinned: boolean): Promise<number> {
    const targets = new Set(assetIds)
    const index = await readProcessedIndex()
    let changed = 0
    const assets = index.assets.map((record) => {
      if (!targets.has(record.id) || record.pinned === pinned) return record
      changed += 1
      return { ...record, pinned }
    })
    if (changed > 0) await writeProcessedIndex({ ...index, assets })
    return changed
  },

  async clearUnpinned(): Promise<OfflineCacheClearResult> {
    const index = await readProcessedIndex()
    const removable = index.assets.filter((record) => !record.pinned)
    for (const record of removable) await removeIfPresent(processedPath(record))
    await writeProcessedIndex({
      ...index,
      assets: index.assets.filter((record) => record.pinned),
    })
    return {
      count: removable.length,
      bytes: removable.reduce((total, record) => total + record.bytes, 0),
    }
  },

  async clearAssets(assetIds: readonly string[]): Promise<OfflineCacheClearResult> {
    const targets = new Set(assetIds)
    const index = await readProcessedIndex()
    const removable = index.assets.filter((record) => targets.has(record.id))
    for (const record of removable) await removeIfPresent(processedPath(record))
    await writeProcessedIndex({
      ...index,
      assets: index.assets.filter((record) => !targets.has(record.id)),
    })
    return {
      count: removable.length,
      bytes: removable.reduce((total, record) => total + record.bytes, 0),
    }
  },
}

async function readCatalog(): Promise<NativeCatalogFile> {
  const contents = await readText(CATALOG_PATH)
  if (contents === null) return { schemaVersion: NATIVE_CACHE_VERSION, assets: [] }
  return parseNativeJson(contents, NativeCatalogFileSchema)
}

async function readProcessedIndex(): Promise<NativeProcessedIndex> {
  const contents = await readText(PROCESSED_INDEX_PATH)
  if (contents === null) return { schemaVersion: NATIVE_CACHE_VERSION, assets: [] }
  return parseNativeJson(contents, NativeProcessedIndexSchema)
}

async function writeProcessedIndex(index: NativeProcessedIndex): Promise<void> {
  await writeJson(PROCESSED_INDEX_PATH, index)
}

async function writeJson(
  path: string,
  value: NativeCatalogFile | NativeProcessedIndex,
): Promise<void> {
  await ensureDirectories()
  await writeTextAtomically(path, JSON.stringify(value))
}

async function writeBinary(path: string, bytes: Uint8Array): Promise<void> {
  await ensureDirectories()
  const temporaryPath = `${path}.next`
  await writeFile(temporaryPath, bytes, { baseDir: BaseDirectory.AppData })
  await replaceWithBackup(path, temporaryPath)
}

async function readText(path: string): Promise<string | null> {
  if (await exists(path, { baseDir: BaseDirectory.AppData })) {
    return readTextFile(path, { baseDir: BaseDirectory.AppData })
  }
  const backupPath = `${path}.backup`
  return (await exists(backupPath, { baseDir: BaseDirectory.AppData }))
    ? readTextFile(backupPath, { baseDir: BaseDirectory.AppData })
    : null
}

async function writeTextAtomically(path: string, contents: string): Promise<void> {
  const temporaryPath = `${path}.next`
  await writeTextFile(temporaryPath, contents, { baseDir: BaseDirectory.AppData })
  await replaceWithBackup(path, temporaryPath)
}

async function replaceWithBackup(path: string, temporaryPath: string): Promise<void> {
  const backupPath = `${path}.backup`
  await removeIfPresent(backupPath)
  if (await exists(path, { baseDir: BaseDirectory.AppData })) {
    await rename(path, backupPath, renameOptions())
  }
  await rename(temporaryPath, path, renameOptions())
}

async function ensureDirectories(): Promise<void> {
  await mkdir(ROOT_DIRECTORY, { baseDir: BaseDirectory.AppData, recursive: true })
  await mkdir(PROCESSED_DIRECTORY, { baseDir: BaseDirectory.AppData, recursive: true })
}

async function removeIfPresent(path: string): Promise<void> {
  if (await exists(path, { baseDir: BaseDirectory.AppData })) {
    await remove(path, { baseDir: BaseDirectory.AppData })
  }
}

function parseNativeJson<T>(contents: string, schema: z.ZodType<T>): T {
  try {
    const parsed = schema.safeParse(JSON.parse(contents))
    if (parsed.success) return parsed.data
  } catch (error) {
    if (!(error instanceof Error)) throw error
  }
  throw new NativeCloudAssetCacheCorruptError()
}

function processedPath(
  asset: Pick<ServiceAsset, "id" | "version"> | NativeProcessedRecord,
): string {
  return `${PROCESSED_DIRECTORY}/${asset.id}@${asset.version}.png`
}

function createProcessedCacheKey(asset: Pick<ServiceAsset, "id" | "version">): string {
  return `${asset.id}@${asset.version}`
}

function renameOptions() {
  return {
    oldPathBaseDir: BaseDirectory.AppData,
    newPathBaseDir: BaseDirectory.AppData,
  }
}

class NativeCloudAssetCacheCorruptError extends Error {
  readonly name = "NativeCloudAssetCacheCorruptError"
}
