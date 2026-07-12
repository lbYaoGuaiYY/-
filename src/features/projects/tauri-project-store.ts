import { readNativeProjectPackage, writeNativeProjectPackage } from "./desktop-project-files"
import {
  createNativeProjectEntry,
  findNativeProject,
  loadNativeProjectIndex,
  saveNativeProjectIndex,
} from "./desktop-project-index"
import type { ProjectId, ProjectSnapshot } from "./project-format"
import { decodeProjectPackage, encodeProjectPackage } from "./project-package"
import type { LoadProjectResult, ProjectStore, SaveProjectResult } from "./project-store"

export class TauriProjectStore implements ProjectStore {
  private readonly projectId: ProjectId

  constructor(projectId: ProjectId) {
    this.projectId = projectId
  }

  async load(): Promise<LoadProjectResult> {
    try {
      const bytes = await readNativeProjectPackage(this.projectId)
      if (bytes === null) return { kind: "empty" }
      const decoded = await decodeProjectPackage(
        new Blob([Uint8Array.from(bytes)], { type: "application/zip" }),
      )
      return decoded.kind === "valid"
        ? { kind: "loaded", snapshot: decoded.snapshot }
        : { kind: "corrupt" }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return { kind: "error" }
    }
  }

  async save(snapshot: ProjectSnapshot): Promise<SaveProjectResult> {
    try {
      const indexResult = await loadNativeProjectIndex()
      if (indexResult.kind === "corrupt") return { kind: "error" }
      const existingProject = findNativeProject(indexResult.index, this.projectId)
      const timestamp = Date.now()
      const project =
        existingProject ?? createNativeProjectEntry(this.projectId, "未命名设计", timestamp)
      const packageBlob = await encodeProjectPackage(snapshot, project.name)
      await writeNativeProjectPackage(
        this.projectId,
        new Uint8Array(await packageBlob.arrayBuffer()),
      )
      await saveNativeProjectIndex({
        ...indexResult.index,
        projects:
          existingProject === undefined
            ? [...indexResult.index.projects, project]
            : indexResult.index.projects.map((entry) =>
                entry.id === this.projectId ? { ...entry, updatedAt: timestamp } : entry,
              ),
      })
      return { kind: "saved", durability: "persistent" }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return { kind: "error" }
    }
  }
}
