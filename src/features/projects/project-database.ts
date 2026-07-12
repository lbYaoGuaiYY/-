import Dexie, { type Table, type Transaction } from "dexie"

import {
  ACTIVE_PROJECT_KEY,
  createProjectId,
  createStoredProjectMetadata,
  migrateStoredLocalAsset,
  migrateStoredProject,
} from "./project-format"

export const DATABASE_NAME = "qingshe-projects-v1"
export const PROJECTS_STORE = "projects"
export const ASSETS_STORE = "assets"
export const PROJECT_METADATA_STORE = "projectMetadata"

export class ProjectDatabase extends Dexie {
  readonly projects!: Table<unknown, string>
  readonly assets!: Table<unknown, string>
  readonly projectMetadata!: Table<unknown, string>
  blocked = false
  versionChanged = false

  constructor() {
    super(DATABASE_NAME)
    this.version(0.1).stores({ projects: "", assets: "" })
    this.version(0.2).stores({ projects: "", assets: "" }).upgrade(migrateDatabaseRecords)
    this.version(0.3)
      .stores({ projects: "", assets: "", projectMetadata: "" })
      .upgrade(migrateProjectCatalog)
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

async function migrateDatabaseRecords(transaction: Transaction): Promise<void> {
  await transaction
    .table<unknown, string>(PROJECTS_STORE)
    .toCollection()
    .modify((value, context) => {
      const migrated = migrateStoredProject(value)
      if (migrated.kind === "corrupt") {
        throw new CorruptStoredRecordError("项目记录无法迁移")
      }
      context.value = migrated.value
    })
  await transaction
    .table<unknown, string>(ASSETS_STORE)
    .toCollection()
    .modify((value, context) => {
      const migrated = migrateStoredLocalAsset(value)
      if (migrated.kind === "corrupt") {
        throw new CorruptStoredRecordError("素材记录无法迁移")
      }
      context.value = migrated.value
    })
}

async function migrateProjectCatalog(transaction: Transaction): Promise<void> {
  const rawProject = await transaction
    .table<unknown, string>(PROJECTS_STORE)
    .get(ACTIVE_PROJECT_KEY)
  if (rawProject === undefined) return
  const project = migrateStoredProject(rawProject)
  if (project.kind === "corrupt") {
    throw new CorruptStoredRecordError("活动项目无法加入项目列表")
  }
  const id = createProjectId(ACTIVE_PROJECT_KEY)
  const metadata = createStoredProjectMetadata({
    id,
    name: "未命名设计",
    createdAt: project.value.updatedAt,
    updatedAt: project.value.updatedAt,
    coverAssetId: project.value.document.backgroundAssetId,
  })
  await transaction.table<unknown, string>(PROJECT_METADATA_STORE).put(metadata, id)
}
