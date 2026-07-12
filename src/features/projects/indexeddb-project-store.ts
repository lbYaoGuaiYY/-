import { DEMO_ASSETS } from "../assets/demo-assets"
import { type AssetId, createAssetId } from "../editor/editor-model"
import { selectUnstoredLocalAssets } from "./project-asset-persistence"
import { ProjectDatabase } from "./project-database"
import {
  ACTIVE_PROJECT_KEY,
  createProjectId,
  createStoredProject,
  createStoredProjectMetadata,
  type ProjectId,
  type ProjectSnapshot,
  parseStoredLocalAsset,
  parseStoredProject,
  parseStoredProjectMetadata,
  validateProjectSnapshot,
} from "./project-format"
import type {
  LoadProjectResult,
  ProjectStore,
  SaveProjectResult,
  StorageDurability,
} from "./project-store"

const BUILT_IN_ASSET_IDS: ReadonlySet<AssetId> = new Set(
  DEMO_ASSETS.map((asset) => createAssetId(`built-in:${asset.id}`)),
)

export class IndexedDbProjectStore implements ProjectStore {
  private durabilityPromise: Promise<StorageDurability> | null = null
  private readonly projectId: ProjectId

  constructor(projectId: ProjectId = createProjectId(ACTIVE_PROJECT_KEY)) {
    this.projectId = projectId
  }

  async load(): Promise<LoadProjectResult> {
    const database = new ProjectDatabase()
    try {
      await database.open()
      const [rawProject, rawAssets] = await Promise.all([
        database.projects.get(this.projectId),
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
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return classifyLoadFailure(database)
    } finally {
      database.close()
    }
  }

  async save(snapshot: ProjectSnapshot): Promise<SaveProjectResult> {
    const updatedAt = Date.now()
    const project = createStoredProject(snapshot.document, updatedAt)
    const validation = validateProjectSnapshot(project, snapshot.localAssets, BUILT_IN_ASSET_IDS)
    if (validation.kind === "corrupt") return { kind: "error" }

    const database = new ProjectDatabase()
    try {
      await database.open()
      await writeSnapshot({
        database,
        projectId: this.projectId,
        project,
        snapshot: validation.value,
        updatedAt,
      })
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

type SnapshotWrite = {
  readonly database: ProjectDatabase
  readonly projectId: ProjectId
  readonly project: ReturnType<typeof createStoredProject>
  readonly snapshot: ProjectSnapshot
  readonly updatedAt: number
}

async function writeSnapshot({
  database,
  projectId,
  project,
  snapshot,
  updatedAt,
}: SnapshotWrite): Promise<void> {
  await database.transaction(
    "rw",
    database.projects,
    database.assets,
    database.projectMetadata,
    async () => {
      const rawMetadata = await database.projectMetadata.get(projectId)
      const parsedMetadata = parseStoredProjectMetadata(rawMetadata)
      const metadata = createStoredProjectMetadata({
        id: projectId,
        name: parsedMetadata.kind === "valid" ? parsedMetadata.value.name : "未命名设计",
        createdAt: parsedMetadata.kind === "valid" ? parsedMetadata.value.createdAt : updatedAt,
        updatedAt,
        coverAssetId: project.document.backgroundAssetId,
      })
      await database.projects.put(project, projectId)
      await database.projectMetadata.put(metadata, projectId)
      const storedAssetIds = new Set(await database.assets.toCollection().primaryKeys())
      for (const asset of selectUnstoredLocalAssets(snapshot.localAssets, storedAssetIds)) {
        await database.assets.put(asset, asset.id)
      }
    },
  )
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
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return "best_effort"
  }
}
