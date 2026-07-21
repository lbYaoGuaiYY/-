import { removeNativeProjectPackage } from "./desktop-project-files"
import {
  createNativeProjectEntry,
  createNativeProjectId,
  findNativeProject,
  loadNativeProjectIndex,
  saveNativeProjectIndex,
} from "./desktop-project-index"
import type {
  ProjectCatalog,
  ProjectListResult,
  ProjectMutationResult,
  ProjectSummary,
} from "./project-catalog"
import type { ProjectId } from "./project-format"
import { TauriProjectStore } from "./tauri-project-store"

export class TauriProjectCatalog implements ProjectCatalog {
  async listProjects(): Promise<ProjectListResult> {
    try {
      const result = await loadNativeProjectIndex()
      if (result.kind === "corrupt") return { kind: "error" }
      const projects = result.index.projects.map(toProjectSummary)
      return { kind: "loaded", projects: projects.sort((a, b) => b.updatedAt - a.updatedAt) }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return { kind: "error" }
    }
  }

  async createProject(name: string): Promise<ProjectMutationResult> {
    try {
      const result = await loadNativeProjectIndex()
      if (result.kind === "corrupt") return { kind: "error" }
      const entry = createNativeProjectEntry(createNativeProjectId(), name, Date.now())
      await saveNativeProjectIndex(
        { ...result.index, projects: [...result.index.projects, entry] },
        result.preserveBackupOnSave ? { preserveExistingBackup: true } : {},
      )
      return { kind: "saved", projectId: entry.id }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return { kind: "error" }
    }
  }

  async renameProject(id: ProjectId, name: string): Promise<ProjectMutationResult> {
    try {
      const result = await loadNativeProjectIndex()
      if (result.kind === "corrupt" || findNativeProject(result.index, id) === undefined) {
        return { kind: "error" }
      }
      const updatedAt = Date.now()
      await saveNativeProjectIndex(
        {
          ...result.index,
          projects: result.index.projects.map((project) =>
            project.id === id ? { ...project, name, updatedAt } : project,
          ),
        },
        result.preserveBackupOnSave ? { preserveExistingBackup: true } : {},
      )
      return { kind: "saved", projectId: id }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return { kind: "error" }
    }
  }

  async duplicateProject(id: ProjectId): Promise<ProjectMutationResult> {
    const source = await new TauriProjectStore(id).load()
    if (source.kind !== "loaded") return { kind: "error" }
    const original = await this.listProjects()
    if (original.kind !== "loaded") return { kind: "error" }
    const sourceProject = original.projects.find((project) => project.id === id)
    if (sourceProject === undefined) return { kind: "error" }

    const created = await this.createProject(`${sourceProject.name} 副本`.slice(0, 80))
    if (created.kind !== "saved") return created
    const saved = await new TauriProjectStore(created.projectId).save(source.snapshot)
    if (saved.kind === "saved") return created
    await this.deleteProject(created.projectId)
    return { kind: "error" }
  }

  async deleteProject(id: ProjectId): Promise<ProjectMutationResult> {
    try {
      const result = await loadNativeProjectIndex()
      if (result.kind === "corrupt" || findNativeProject(result.index, id) === undefined) {
        return { kind: "error" }
      }
      await saveNativeProjectIndex(
        {
          ...result.index,
          projects: result.index.projects.filter((project) => project.id !== id),
        },
        result.preserveBackupOnSave ? { preserveExistingBackup: true } : {},
      )
      await removeNativeProjectPackage(id)
      return { kind: "saved", projectId: id }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return { kind: "error" }
    }
  }
}

function toProjectSummary(project: {
  readonly id: ProjectId
  readonly name: string
  readonly createdAt: number
  readonly updatedAt: number
}): ProjectSummary {
  return { ...project, coverBlob: null }
}
