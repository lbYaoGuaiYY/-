import type { ProjectId } from "./project-format"

export type ProjectSummary = {
  readonly id: ProjectId
  readonly name: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly coverBlob: Blob | null
}

export type ProjectListResult =
  | { readonly kind: "loaded"; readonly projects: readonly ProjectSummary[] }
  | { readonly kind: "blocked" | "reload_required" | "error" }

export type ProjectMutationResult =
  | { readonly kind: "saved"; readonly projectId: ProjectId }
  | { readonly kind: "blocked" | "reload_required" | "quota_exceeded" | "error" }

export interface ProjectCatalog {
  listProjects(): Promise<ProjectListResult>
  createProject(name: string): Promise<ProjectMutationResult>
  renameProject(id: ProjectId, name: string): Promise<ProjectMutationResult>
  duplicateProject(id: ProjectId): Promise<ProjectMutationResult>
  deleteProject(id: ProjectId): Promise<ProjectMutationResult>
}
