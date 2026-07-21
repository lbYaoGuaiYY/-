import {
  readNativeProjectPackageBackup,
  readNativeProjectPackagePrimary,
  restoreNativeProjectPackageFromBackup,
  writeNativeProjectPackage,
} from "./desktop-project-files"
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
  private preservePackageBackupOnNextSave = false

  constructor(projectId: ProjectId) {
    this.projectId = projectId
  }

  async load(): Promise<LoadProjectResult> {
    try {
      this.preservePackageBackupOnNextSave = false
      const primaryBytes = await readNativeProjectPackagePrimary(this.projectId)
      const bytes = primaryBytes ?? (await readNativeProjectPackageBackup(this.projectId))
      if (bytes === null) return { kind: "empty" }
      const decoded = await decodeProjectPackage(
        new Blob([Uint8Array.from(bytes)], { type: "application/zip" }),
      )
      if (decoded.kind === "valid") {
        if (primaryBytes === null) {
          this.preservePackageBackupOnNextSave = !(await restoreProjectPackageBestEffort(
            this.projectId,
            bytes,
          ))
        }
        return { kind: "loaded", snapshot: decoded.snapshot }
      }

      if (primaryBytes !== null) {
        const backupBytes = await readNativeProjectPackageBackup(this.projectId)
        if (backupBytes !== null) {
          const backupDecoded = await decodeProjectPackage(
            new Blob([Uint8Array.from(backupBytes)], { type: "application/zip" }),
          )
          if (backupDecoded.kind === "valid") {
            this.preservePackageBackupOnNextSave = !(await restoreProjectPackageBestEffort(
              this.projectId,
              backupBytes,
            ))
            return { kind: "loaded", snapshot: backupDecoded.snapshot }
          }
        }
      }
      return { kind: "corrupt" }
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
        this.preservePackageBackupOnNextSave ? { preserveExistingBackup: true } : {},
      )
      this.preservePackageBackupOnNextSave = false
      await saveNativeProjectIndex(
        {
          ...indexResult.index,
          projects:
            existingProject === undefined
              ? [...indexResult.index.projects, project]
              : indexResult.index.projects.map((entry) =>
                  entry.id === this.projectId ? { ...entry, updatedAt: timestamp } : entry,
                ),
        },
        indexResult.preserveBackupOnSave ? { preserveExistingBackup: true } : {},
      )
      return { kind: "saved", durability: "persistent" }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return { kind: "error" }
    }
  }
}

async function restoreProjectPackageBestEffort(
  projectId: ProjectId,
  bytes: Uint8Array,
): Promise<boolean> {
  try {
    await restoreNativeProjectPackageFromBackup(projectId, bytes)
    return true
  } catch {
    // The decoded backup remains usable even if the primary cannot be rebuilt yet.
    return false
  }
}
