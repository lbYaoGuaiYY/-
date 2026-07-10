import { DEMO_ASSETS } from "../assets/demo-assets"
import { type AssetId, createAssetId } from "../editor/editor-model"
import {
  ACTIVE_PROJECT_KEY,
  createStoredProject,
  type ProjectSnapshot,
  parseStoredLocalAsset,
  parseStoredProject,
  validateProjectSnapshot,
} from "./project-format"
import type { LoadProjectResult, ProjectStore, SaveProjectResult } from "./project-store"

const DATABASE_NAME = "qingshe-projects-v1"
const DATABASE_VERSION = 1
const PROJECTS_STORE = "projects"
const ASSETS_STORE = "assets"

const BUILT_IN_ASSET_IDS: ReadonlySet<AssetId> = new Set(
  DEMO_ASSETS.map((asset) => createAssetId(`built-in:${asset.id}`)),
)

class IndexedDbOperationError extends Error {
  readonly name = "IndexedDbOperationError"
}

export class IndexedDbProjectStore implements ProjectStore {
  private persistenceRequested = false

  async load(): Promise<LoadProjectResult> {
    let database: IDBDatabase | null = null
    try {
      database = await openDatabase()
      const transaction = database.transaction([PROJECTS_STORE, ASSETS_STORE], "readonly")
      const completion = transactionCompletion(transaction)
      const [rawProject, rawAssets] = await Promise.all([
        requestValue(transaction.objectStore(PROJECTS_STORE).get(ACTIVE_PROJECT_KEY)),
        requestValue(transaction.objectStore(ASSETS_STORE).getAll()),
        completion,
      ])
      if (rawProject === undefined) return { kind: "empty" }
      const project = parseStoredProject(rawProject)
      if (project.kind === "corrupt" || !Array.isArray(rawAssets)) return { kind: "corrupt" }

      const localAssets = []
      for (const rawAsset of rawAssets) {
        const asset = parseStoredLocalAsset(rawAsset)
        if (asset.kind === "corrupt") return { kind: "corrupt" }
        localAssets.push(asset.value)
      }
      const validation = validateProjectSnapshot(project.value, localAssets, BUILT_IN_ASSET_IDS)
      return validation.kind === "valid"
        ? { kind: "loaded", snapshot: validation.value }
        : { kind: "corrupt" }
    } catch (error) {
      if (error instanceof Error) return { kind: "error" }
      return { kind: "error" }
    } finally {
      database?.close()
    }
  }

  async save(snapshot: ProjectSnapshot): Promise<SaveProjectResult> {
    const project = createStoredProject(snapshot.document, Date.now())
    const validation = validateProjectSnapshot(project, snapshot.localAssets, BUILT_IN_ASSET_IDS)
    if (validation.kind === "corrupt") return { kind: "error" }

    let database: IDBDatabase | null = null
    try {
      database = await openDatabase()
      await writeSnapshot(database, project, validation.value)
      this.requestPersistenceOnce()
      return { kind: "saved" }
    } catch (error) {
      if (isQuotaExceeded(error)) return { kind: "quota_exceeded" }
      if (error instanceof Error) return { kind: "error" }
      return { kind: "error" }
    } finally {
      database?.close()
    }
  }

  private requestPersistenceOnce(): void {
    if (this.persistenceRequested || !("storage" in navigator)) return
    this.persistenceRequested = true
    void navigator.storage.persist().then(
      () => undefined,
      () => undefined,
    )
  }
}

async function writeSnapshot(
  database: IDBDatabase,
  project: ReturnType<typeof createStoredProject>,
  snapshot: ProjectSnapshot,
): Promise<void> {
  const transaction = database.transaction([PROJECTS_STORE, ASSETS_STORE], "readwrite", {
    durability: "strict",
  })
  const completion = transactionCompletion(transaction)
  const projectStore = transaction.objectStore(PROJECTS_STORE)
  const assetStore = transaction.objectStore(ASSETS_STORE)
  const existingKeys = await requestValue(assetStore.getAllKeys())
  const retainedIds = new Set(snapshot.localAssets.map((asset) => String(asset.id)))

  projectStore.put(project, ACTIVE_PROJECT_KEY)
  for (const asset of snapshot.localAssets) assetStore.put(asset, asset.id)
  for (const key of existingKeys) {
    if (typeof key !== "string" || !retainedIds.has(key)) assetStore.delete(key)
  }
  await completion
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(PROJECTS_STORE))
        database.createObjectStore(PROJECTS_STORE)
      if (!database.objectStoreNames.contains(ASSETS_STORE))
        database.createObjectStore(ASSETS_STORE)
    }
    request.onerror = () => reject(operationError("无法打开项目数据库", request.error))
    request.onblocked = () => reject(new IndexedDbOperationError("项目数据库升级被阻止"))
    request.onsuccess = () => resolve(request.result)
  })
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(operationError("项目数据库请求失败", request.error))
    request.onsuccess = () => resolve(request.result)
  })
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(operationError("项目事务失败", transaction.error))
    transaction.onabort = () => reject(operationError("项目事务已回滚", transaction.error))
  })
}

function operationError(message: string, cause: DOMException | null): IndexedDbOperationError {
  return new IndexedDbOperationError(message, cause === null ? undefined : { cause })
}

function isQuotaExceeded(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === "QuotaExceededError"
  if (!(error instanceof Error)) return false
  return error.cause instanceof DOMException && error.cause.name === "QuotaExceededError"
}
