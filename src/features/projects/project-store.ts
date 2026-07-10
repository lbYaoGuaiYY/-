import type { ProjectSnapshot } from "./project-format"

export type LoadProjectResult =
  | { readonly kind: "empty" }
  | { readonly kind: "loaded"; readonly snapshot: ProjectSnapshot }
  | { readonly kind: "corrupt" }
  | { readonly kind: "blocked" }
  | { readonly kind: "reload_required" }
  | { readonly kind: "error" }

export type StorageDurability = "persistent" | "best_effort" | "unsupported"

export type SaveProjectResult =
  | { readonly kind: "saved"; readonly durability: StorageDurability }
  | { readonly kind: "quota_exceeded" }
  | { readonly kind: "blocked" }
  | { readonly kind: "reload_required" }
  | { readonly kind: "error" }

export interface ProjectStore {
  load(): Promise<LoadProjectResult>
  save(snapshot: ProjectSnapshot): Promise<SaveProjectResult>
}
