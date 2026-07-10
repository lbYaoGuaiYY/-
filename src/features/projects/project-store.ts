import type { ProjectSnapshot } from "./project-format"

export type LoadProjectResult =
  | { readonly kind: "empty" }
  | { readonly kind: "loaded"; readonly snapshot: ProjectSnapshot }
  | { readonly kind: "corrupt" }
  | { readonly kind: "error" }

export type SaveProjectResult =
  | { readonly kind: "saved" }
  | { readonly kind: "quota_exceeded" }
  | { readonly kind: "error" }

export interface ProjectStore {
  load(): Promise<LoadProjectResult>
  save(snapshot: ProjectSnapshot): Promise<SaveProjectResult>
}
