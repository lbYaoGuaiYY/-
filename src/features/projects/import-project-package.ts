import type { ProjectId, ProjectSnapshot } from "./project-format"
import { createProjectCatalog, createProjectStore } from "./project-storage"

export type ImportProjectPackageResult =
  | { readonly kind: "saved"; readonly projectId: ProjectId }
  | { readonly kind: "blocked" | "reload_required" | "quota_exceeded" | "error" }

export async function importProjectPackageAsNewProject(
  name: string,
  snapshot: ProjectSnapshot,
): Promise<ImportProjectPackageResult> {
  const catalog = createProjectCatalog()
  const created = await catalog.createProject(name)
  if (created.kind !== "saved") return created

  const saved = await createProjectStore(created.projectId).save(snapshot)
  if (saved.kind === "saved") return { kind: "saved", projectId: created.projectId }
  await catalog.deleteProject(created.projectId)
  return saved
}
