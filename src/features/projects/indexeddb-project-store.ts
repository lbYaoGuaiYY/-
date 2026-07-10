import Dexie, { type Table, type Transaction } from "dexie"

import { DEMO_ASSETS } from "../assets/demo-assets"
import { type AssetId, createAssetId } from "../editor/editor-model"
import {
  ACTIVE_PROJECT_KEY,
  createStoredProject,
  migrateStoredLocalAsset,
  migrateStoredProject,
  type ProjectSnapshot,
  parseStoredLocalAsset,
  parseStoredProject,
  validateProjectSnapshot,
} from "./project-format"
import type {
  LoadProjectResult,
  ProjectStore,
  SaveProjectResult,
  StorageDurability,
} from "./project-store"

const DATABASE_NAME = "qingshe-projects-v1"
const PROJECTS_STORE = "projects"
const ASSETS_STORE = "assets"

const BUILT_IN_ASSET_IDS: ReadonlySet<AssetId> = new Set(
  DEMO_ASSETS.map((asset) => createAssetId(`built-in:${asset.id}`)),
)

class ProjectDatabase extends Dexie {
  readonly projects!: Table<unknown, string>
  readonly assets!: Table<unknown, string>
  blocked = false
  versionChanged = false

  constructor() {
    super(DATABASE_NAME)
    this.version(0.1).stores({ projects: "", assets: "" })
    this.version(0.2).stores({ projects: "", assets: "" }).upgrade(migrateDatabase)
    this.on("blocked", () => {
      this.blocked = true
    })
    this.on("versionchange", () => {
      this.versionChanged = true
      this.close()
    })
  }
}

class CorruptStoredRecordError extends Error {
  readonly name = "CorruptStoredRecordError"
}

export class IndexedDbProjectStore implements ProjectStore {
  private durabilityPromise: Promise<StorageDurability> | null = null

  async load(): Promise<LoadProjectResult> {
    const database = new ProjectDatabase()
    try {
      await database.open()
      const [rawProject, rawAssets] = await Promise.all([
        database.projects.get(ACTIVE_PROJECT_KEY),
        database.assets.toArray(),
      ])
      if (rawProject === undefined) return { kind: "empty" }
      const project = parseStoredProject(rawProject)
      if (project.kind === "corrupt") return { kind: "corrupt" }

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
    } catch {
      return classifyLoadFailure(database)
    } finally {
      database.close()
    }
  }

  async save(snapshot: ProjectSnapshot): Promise<SaveProjectResult> {
    const project = createStoredProject(snapshot.document, Date.now())
    const validation = validateProjectSnapshot(project, snapshot.localAssets, BUILT_IN_ASSET_IDS)
    if (validation.kind === "corrupt") return { kind: "error" }

    const database = new ProjectDatabase()
    try {
      await database.open()
      await writeSnapshot(database, project, validation.value)
      return { kind: "saved", durability: await this.resolveDurability() }
    } catch (error) {
      if (database.versionChanged) return { kind: "reload_required" }
      if (database.blocked) return { kind: "blocked" }
      return isQuotaExceeded(error) ? { kind: "quota_exceeded" } : { kind: "error" }
    } finally {
      database.close()
    }
  }

  private resolveDurability(): Promise<StorageDurability> {
    this.durabilityPromise ??= requestStorageDurability()
    return this.durabilityPromise
  }
}

async function migrateDatabase(transaction: Transaction): Promise<void> {
  await transaction
    .table<unknown, string>(PROJECTS_STORE)
    .toCollection()
    .modify((value, context) => {
      const migrated = migrateStoredProject(value)
      if (migrated.kind === "corrupt") throw new CorruptStoredRecordError("项目记录无法迁移")
      context.value = migrated.value
    })
  await transaction
    .table<unknown, string>(ASSETS_STORE)
    .toCollection()
    .modify((value, context) => {
      const migrated = migrateStoredLocalAsset(value)
      if (migrated.kind === "corrupt") throw new CorruptStoredRecordError("素材记录无法迁移")
      context.value = migrated.value
    })
}

async function writeSnapshot(
  database: ProjectDatabase,
  project: ReturnType<typeof createStoredProject>,
  snapshot: ProjectSnapshot,
): Promise<void> {
  await database.transaction("rw", database.projects, database.assets, async () => {
    const existingKeys = await database.assets.toCollection().primaryKeys()
    const retainedIds = new Set(snapshot.localAssets.map((asset) => String(asset.id)))
    await database.projects.put(project, ACTIVE_PROJECT_KEY)
    for (const asset of snapshot.localAssets) await database.assets.put(asset, String(asset.id))
    await database.assets.bulkDelete(
      existingKeys.filter((key) => typeof key !== "string" || !retainedIds.has(key)),
    )
  })
}

function isQuotaExceeded(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === "QuotaExceededError") return true
  if ("inner" in error && isQuotaExceeded(error.inner)) return true
  return "cause" in error && isQuotaExceeded(error.cause)
}

function classifyLoadFailure(database: ProjectDatabase): LoadProjectResult {
  if (database.versionChanged) return { kind: "reload_required" }
  if (database.blocked) return { kind: "blocked" }
  return { kind: "error" }
}

async function requestStorageDurability(): Promise<StorageDurability> {
  if (typeof navigator === "undefined" || !("storage" in navigator)) return "unsupported"
  const storage = navigator.storage
  if (typeof storage.persisted !== "function" || typeof storage.persist !== "function") {
    return "unsupported"
  }
  try {
    if (await storage.persisted()) return "persistent"
    return (await storage.persist()) ? "persistent" : "best_effort"
  } catch {
    return "best_effort"
  }
}
