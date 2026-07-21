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
import {
  isCurrentProcessedVersion,
  planCatalogVersionPrune,
  planProcessedVersionWrite,
} from "./cloud-asset-cache-versioning"

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

type RecoveredJson<T> = {
  readonly value: T
  readonly backupContents: string | null
}

let nativeMutationQueue: Promise<void> = Promise.resolve()

export const nativeCloudAssetCache = {
  async saveCatalog(assets: readonly ServiceAsset[]): Promise<void> {
    if (assets.length === 0) return
    return enqueueNativeMutation(async () => {
      const existing = await readCatalog()
      const records = new Map(existing.assets.map((record) => [record.asset.id, record]))
      const advancedVersions = new Map<string, number>()
      const cachedAt = Date.now()
      for (const asset of assets) {
        const previous = records.get(asset.id)
        if (previous !== undefined && asset.version < previous.asset.version) continue
        if (previous === undefined || asset.version > previous.asset.version) {
          advancedVersions.set(asset.id, asset.version)
        }
        records.set(asset.id, { asset, cachedAt })
      }
      const nextCatalog = {
        schemaVersion: NATIVE_CACHE_VERSION,
        assets: [...records.values()],
      } satisfies NativeCatalogFile
      const processedIndex = await readProcessedIndex()
      const staleCacheKeys = planCatalogVersionPrune(processedIndex.assets, advancedVersions)
      const staleCacheKeySet = new Set(staleCacheKeys)
      const staleRecords = processedIndex.assets.filter((record) =>
        staleCacheKeySet.has(record.cacheKey),
      )
      await writeJson(CATALOG_PATH, nextCatalog)
      if (staleRecords.length === 0) return
      await writeProcessedIndex({
        ...processedIndex,
        assets: processedIndex.assets.filter((record) => !staleCacheKeySet.has(record.cacheKey)),
      })
      for (const record of staleRecords) await removeProcessedVersions(record)
    })
  },

  async listCatalog(query: CachedCatalogQuery): Promise<CachedCatalogPage> {
    return enqueueNativeMutation(async () => {
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
    })
  },

  async saveProcessed(asset: Pick<ServiceAsset, "id" | "version">, blob: Blob): Promise<void> {
    return enqueueNativeMutation(async () => {
      const index = await readProcessedIndex()
      const cacheKey = createProcessedCacheKey(asset)
      const existing = index.assets.filter((record) => record.id === asset.id)
      const versionPlan = planProcessedVersionWrite(existing, {
        cacheKey,
        id: asset.id,
        version: asset.version,
        bytes: blob.size,
        pinned: false,
      })
      if (!versionPlan.shouldWrite) return
      const nextRecord = versionPlan.record
      const staleCacheKeys = versionPlan.staleCacheKeys
      const staleCacheKeySet = new Set(staleCacheKeys)
      await writeBinary(processedPath(asset), new Uint8Array(await blob.arrayBuffer()))
      await writeProcessedIndex({
        schemaVersion: NATIVE_CACHE_VERSION,
        assets: [
          ...index.assets.filter(
            (record) => record.cacheKey !== cacheKey && !staleCacheKeySet.has(record.cacheKey),
          ),
          nextRecord,
        ],
      })
      for (const record of existing) {
        if (staleCacheKeySet.has(record.cacheKey)) {
          await removeProcessedVersions(record)
        }
      }
    })
  },

  async readProcessed(
    assets: readonly Pick<ServiceAsset, "id" | "version">[],
  ): Promise<ReadonlyMap<string, Blob>> {
    if (assets.length === 0) return new Map()
    return enqueueNativeMutation(async () => {
      const index = await readProcessedIndex()
      const processed = new Map<string, Blob>()
      for (const asset of assets) {
        const record = index.assets.find(
          (candidate) => candidate.cacheKey === createProcessedCacheKey(asset),
        )
        if (record === undefined) continue
        const bytes = await readBinaryWithBackup(processedPath(asset))
        if (bytes === null) continue
        processed.set(asset.id, new Blob([toArrayBuffer(bytes)], { type: "image/png" }))
      }
      return processed
    })
  },

  async getOfflineCacheSummary(): Promise<OfflineCacheSummary> {
    return enqueueNativeMutation(async () => {
      const [index, catalog] = await Promise.all([readProcessedIndex(), readCatalog()])
      const names = new Map(catalog.assets.map((record) => [record.asset.id, record.asset]))
      const available = await Promise.all(
        index.assets.map(async (record) => ({
          record,
          available: await processedFileAvailable(record),
        })),
      )
      const assets = available
        .filter(({ record, available: isAvailable }) => {
          const asset = names.get(record.id)
          return (
            asset !== undefined && isAvailable && isCurrentProcessedVersion(record, asset.version)
          )
        })
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
    })
  },

  async setPinned(assetIds: readonly string[], pinned: boolean): Promise<number> {
    return enqueueNativeMutation(async () => {
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
    })
  },

  async clearUnpinned(): Promise<OfflineCacheClearResult> {
    return enqueueNativeMutation(async () => {
      const index = await readProcessedIndex()
      const removable = index.assets.filter((record) => !record.pinned)
      for (const record of removable) await removeProcessedVersions(record)
      await writeProcessedIndex({
        ...index,
        assets: index.assets.filter((record) => record.pinned),
      })
      return {
        count: removable.length,
        bytes: removable.reduce((total, record) => total + record.bytes, 0),
      }
    })
  },

  async clearAssets(assetIds: readonly string[]): Promise<OfflineCacheClearResult> {
    return enqueueNativeMutation(async () => {
      const targets = new Set(assetIds)
      const index = await readProcessedIndex()
      const removable = index.assets.filter((record) => targets.has(record.id))
      for (const record of removable) await removeProcessedVersions(record)
      await writeProcessedIndex({
        ...index,
        assets: index.assets.filter((record) => !targets.has(record.id)),
      })
      return {
        count: removable.length,
        bytes: removable.reduce((total, record) => total + record.bytes, 0),
      }
    })
  },
}

async function readCatalog(): Promise<NativeCatalogFile> {
  const recovered = await readJsonWithBackup(CATALOG_PATH, NativeCatalogFileSchema)
  if (recovered === null) return { schemaVersion: NATIVE_CACHE_VERSION, assets: [] }
  await restorePrimaryBestEffort(CATALOG_PATH, recovered.backupContents)
  return recovered.value
}

async function readProcessedIndex(): Promise<NativeProcessedIndex> {
  const recovered = await readJsonWithBackup(PROCESSED_INDEX_PATH, NativeProcessedIndexSchema)
  if (recovered === null) return { schemaVersion: NATIVE_CACHE_VERSION, assets: [] }
  await restorePrimaryBestEffort(PROCESSED_INDEX_PATH, recovered.backupContents)
  return recovered.value
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

async function readJsonWithBackup<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<RecoveredJson<T> | null> {
  const primaryContents = await readTextIfPresent(path)
  if (primaryContents !== null) {
    try {
      return { value: parseNativeJson(primaryContents, schema), backupContents: null }
    } catch (error) {
      if (!(error instanceof NativeCloudAssetCacheCorruptError)) throw error
    }
  }
  const backupContents = await readTextIfPresent(`${path}.backup`)
  if (backupContents === null) {
    if (primaryContents === null) return null
    throw new NativeCloudAssetCacheCorruptError()
  }
  return {
    value: parseNativeJson(backupContents, schema),
    backupContents,
  }
}

async function readTextIfPresent(path: string): Promise<string | null> {
  return (await exists(path, { baseDir: BaseDirectory.AppData }))
    ? readTextFile(path, { baseDir: BaseDirectory.AppData })
    : null
}

async function readBinaryWithBackup(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path, { baseDir: BaseDirectory.AppData })
  } catch {
    let backup: Uint8Array
    try {
      backup = await readFile(`${path}.backup`, { baseDir: BaseDirectory.AppData })
    } catch {
      return null
    }
    await restoreBinaryBestEffort(path, backup)
    return backup
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function writeTextAtomically(path: string, contents: string): Promise<void> {
  const temporaryPath = `${path}.next`
  await writeTextFile(temporaryPath, contents, { baseDir: BaseDirectory.AppData })
  await replaceWithBackup(path, temporaryPath)
}

async function restorePrimaryBestEffort(
  path: string,
  backupContents: string | null,
): Promise<void> {
  if (backupContents === null) return
  try {
    await writeTextKeepingBackup(path, backupContents)
  } catch {
    // The validated backup remains usable even when primary repair fails.
  }
}

async function writeTextKeepingBackup(path: string, contents: string): Promise<void> {
  await ensureDirectories()
  const temporaryPath = `${path}.next`
  await writeTextFile(temporaryPath, contents, { baseDir: BaseDirectory.AppData })
  await replacePrimaryKeepingBackup(path, temporaryPath)
}

async function restoreBinaryBestEffort(path: string, bytes: Uint8Array): Promise<void> {
  const temporaryPath = `${path}.next`
  try {
    await ensureDirectories()
    await writeFile(temporaryPath, bytes, { baseDir: BaseDirectory.AppData })
    await removeIfPresent(path)
    await rename(temporaryPath, path, renameOptions())
  } catch {
    await removeIfPresent(temporaryPath).catch(() => undefined)
    // The validated backup remains usable when primary repair fails.
  }
}

async function replacePrimaryKeepingBackup(path: string, temporaryPath: string): Promise<void> {
  await removeIfPresent(path)
  await rename(temporaryPath, path, renameOptions())
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

async function removeProcessedVersions(record: NativeProcessedRecord): Promise<void> {
  const path = processedPath(record)
  await removeIfPresent(path)
  await removeIfPresent(`${path}.next`)
  await removeIfPresent(`${path}.backup`)
}

async function processedFileAvailable(record: NativeProcessedRecord): Promise<boolean> {
  const path = processedPath(record)
  return (
    (await exists(path, { baseDir: BaseDirectory.AppData })) ||
    (await exists(`${path}.backup`, { baseDir: BaseDirectory.AppData }))
  )
}

function enqueueNativeMutation<T>(operation: () => Promise<T> | T): Promise<T> {
  const result = nativeMutationQueue.then(operation, operation)
  nativeMutationQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
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
