import { IndexedDbProjectCatalog } from "./indexeddb-project-catalog"
import { IndexedDbProjectStore } from "./indexeddb-project-store"
import type { ProjectCatalog } from "./project-catalog"
import type { ProjectId } from "./project-format"
import type { ProjectStore } from "./project-store"
import { TauriProjectCatalog } from "./tauri-project-catalog"
import { TauriProjectStore } from "./tauri-project-store"
import { isDesktopRuntime } from "./tauri-runtime"

export { getPlatformRuntime, isDesktopRuntime, isMobileRuntime } from "./tauri-runtime"

export function createProjectStore(projectId: ProjectId): ProjectStore {
  return isDesktopRuntime()
    ? new TauriProjectStore(projectId)
    : new IndexedDbProjectStore(projectId)
}

export function createProjectCatalog(): ProjectCatalog {
  return isDesktopRuntime() ? new TauriProjectCatalog() : new IndexedDbProjectCatalog()
}
