import { INITIAL_EDITOR_DOCUMENT } from "../editor/editor-model"
import { findOrphanLocalAssetIds } from "./project-asset-persistence"
import type {
  ProjectCatalog,
  ProjectListResult,
  ProjectMutationResult,
  ProjectSummary,
} from "./project-catalog"
import { ProjectDatabase } from "./project-database"
import {
  createProjectId,
  createStoredProject,
  createStoredProjectMetadata,
  type ProjectId,
  parseStoredLocalAsset,
  parseStoredProject,
  parseStoredProjectMetadata,
} from "./project-format"

class CorruptProjectCatalogError extends Error {
  readonly name = "CorruptProjectCatalogError"
}

export class IndexedDbProjectCatalog implements ProjectCatalog {
  async listProjects(): Promise<ProjectListResult> {
    const database = new ProjectDatabase()
    try {
      await database.open()
      const [rawMetadata, rawAssets] = await Promise.all([
        database.projectMetadata.toArray(),
        database.assets.toArray(),
      ])
      const assets = new Map<string, Blob>()
      for (const rawAsset of rawAssets) {
        const parsed = parseStoredLocalAsset(rawAsset)
        if (parsed.kind === "corrupt") return { kind: "error" }
        assets.set(parsed.value.id, parsed.value.blob)
      }
      const projects: ProjectSummary[] = []
      for (const rawProjectMetadata of rawMetadata) {
        const parsed = parseStoredProjectMetadata(rawProjectMetadata)
        if (parsed.kind === "corrupt") return { kind: "error" }
        const metadata = parsed.value
        projects.push({
          id: metadata.id,
          name: metadata.name,
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt,
          coverBlob:
            metadata.coverAssetId === null ? null : (assets.get(metadata.coverAssetId) ?? null),
        })
      }
      return { kind: "loaded", projects: projects.sort((a, b) => b.updatedAt - a.updatedAt) }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return classifyCatalogFailure(database)
    } finally {
      database.close()
    }
  }

  async createProject(name: string): Promise<ProjectMutationResult> {
    const id = createProjectId(crypto.randomUUID())
    const now = Date.now()
    const metadata = createStoredProjectMetadata({
      id,
      name,
      createdAt: now,
      updatedAt: now,
      coverAssetId: null,
    })
    const database = new ProjectDatabase()
    try {
      await database.open()
      await database.transaction("rw", database.projects, database.projectMetadata, async () => {
        await database.projects.put(createStoredProject(INITIAL_EDITOR_DOCUMENT, now), id)
        await database.projectMetadata.put(metadata, id)
      })
      return { kind: "saved", projectId: id }
    } catch (error) {
      return classifyMutationFailure(database, error)
    } finally {
      database.close()
    }
  }

  async renameProject(id: ProjectId, name: string): Promise<ProjectMutationResult> {
    const database = new ProjectDatabase()
    try {
      await database.open()
      const rawMetadata = await database.projectMetadata.get(id)
      const parsed = parseStoredProjectMetadata(rawMetadata)
      if (parsed.kind === "corrupt") return { kind: "error" }
      const metadata = createStoredProjectMetadata({
        ...parsed.value,
        name,
        updatedAt: Date.now(),
      })
      await database.projectMetadata.put(metadata, id)
      return { kind: "saved", projectId: id }
    } catch (error) {
      return classifyMutationFailure(database, error)
    } finally {
      database.close()
    }
  }

  async duplicateProject(id: ProjectId): Promise<ProjectMutationResult> {
    const database = new ProjectDatabase()
    try {
      await database.open()
      const [rawProject, rawMetadata] = await Promise.all([
        database.projects.get(id),
        database.projectMetadata.get(id),
      ])
      const project = parseStoredProject(rawProject)
      const metadata = parseStoredProjectMetadata(rawMetadata)
      if (project.kind === "corrupt" || metadata.kind === "corrupt") return { kind: "error" }
      const duplicateId = createProjectId(crypto.randomUUID())
      const now = Date.now()
      const duplicateMetadata = createStoredProjectMetadata({
        id: duplicateId,
        name: `${metadata.value.name} 副本`.slice(0, 80),
        createdAt: now,
        updatedAt: now,
        coverAssetId: metadata.value.coverAssetId,
      })
      await database.transaction("rw", database.projects, database.projectMetadata, async () => {
        await database.projects.put(createStoredProject(project.value.document, now), duplicateId)
        await database.projectMetadata.put(duplicateMetadata, duplicateId)
      })
      return { kind: "saved", projectId: duplicateId }
    } catch (error) {
      return classifyMutationFailure(database, error)
    } finally {
      database.close()
    }
  }

  async deleteProject(id: ProjectId): Promise<ProjectMutationResult> {
    const database = new ProjectDatabase()
    try {
      await database.open()
      await database.transaction(
        "rw",
        database.projects,
        database.projectMetadata,
        database.assets,
        async () => {
          await database.projects.delete(id)
          await database.projectMetadata.delete(id)
          const projects = []
          for (const rawProject of await database.projects.toArray()) {
            const project = parseStoredProject(rawProject)
            if (project.kind === "corrupt") {
              throw new CorruptProjectCatalogError("项目目录包含损坏记录")
            }
            projects.push(project.value)
          }
          const storedAssetIds = await database.assets.toCollection().primaryKeys()
          await database.assets.bulkDelete(findOrphanLocalAssetIds(projects, storedAssetIds))
        },
      )
      return { kind: "saved", projectId: id }
    } catch (error) {
      return classifyMutationFailure(database, error)
    } finally {
      database.close()
    }
  }
}

function classifyCatalogFailure(database: ProjectDatabase): ProjectListResult {
  if (database.versionChanged) return { kind: "reload_required" }
  if (database.blocked) return { kind: "blocked" }
  return { kind: "error" }
}

function classifyMutationFailure(database: ProjectDatabase, error: unknown): ProjectMutationResult {
  if (database.versionChanged) return { kind: "reload_required" }
  if (database.blocked) return { kind: "blocked" }
  if (isQuotaExceeded(error)) return { kind: "quota_exceeded" }
  return { kind: "error" }
}

function isQuotaExceeded(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === "QuotaExceededError") return true
  if ("inner" in error && isQuotaExceeded(error.inner)) return true
  return "cause" in error && isQuotaExceeded(error.cause)
}
