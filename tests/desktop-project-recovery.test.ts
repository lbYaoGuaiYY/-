import { beforeEach, describe, expect, it, vi } from "vitest"

import { INITIAL_EDITOR_DOCUMENT } from "../src/features/editor/editor-model"
import { encodeProjectPackage } from "../src/features/projects/project-package"

const files = vi.hoisted(() => ({
  readPackagePrimary: vi.fn<() => Promise<Uint8Array | null>>(),
  readPackageBackup: vi.fn<() => Promise<Uint8Array | null>>(),
  restorePackage: vi.fn<() => Promise<void>>(),
  readCatalogPrimary: vi.fn<() => Promise<string | null>>(),
  readCatalogBackup: vi.fn<() => Promise<string | null>>(),
  restoreCatalog: vi.fn<() => Promise<void>>(),
}))

vi.mock("../src/features/projects/desktop-project-files", () => ({
  readNativeProjectPackagePrimary: files.readPackagePrimary,
  readNativeProjectPackageBackup: files.readPackageBackup,
  restoreNativeProjectPackageFromBackup: files.restorePackage,
  readNativeCatalogPrimary: files.readCatalogPrimary,
  readNativeCatalogBackup: files.readCatalogBackup,
  restoreNativeCatalogFromBackup: files.restoreCatalog,
}))

import { loadNativeProjectIndex } from "../src/features/projects/desktop-project-index"
import { createProjectId } from "../src/features/projects/project-format"
import { TauriProjectStore } from "../src/features/projects/tauri-project-store"

beforeEach(() => {
  vi.clearAllMocks()
  files.readPackagePrimary.mockResolvedValue(null)
  files.readPackageBackup.mockResolvedValue(null)
  files.restorePackage.mockResolvedValue(undefined)
  files.readCatalogPrimary.mockResolvedValue(null)
  files.readCatalogBackup.mockResolvedValue(null)
  files.restoreCatalog.mockResolvedValue(undefined)
})

describe("desktop project recovery", () => {
  it("loads a valid package backup when the primary package is corrupt and rebuilds the primary", async () => {
    const packageBlob = await encodeProjectPackage(
      { document: INITIAL_EDITOR_DOCUMENT, localAssets: [] },
      "recovered",
    )
    const backup = new Uint8Array(await packageBlob.arrayBuffer())
    files.readPackagePrimary.mockResolvedValue(new Uint8Array([0, 1, 2]))
    files.readPackageBackup.mockResolvedValue(backup)

    const result = await new TauriProjectStore(createProjectId("project-1")).load()

    expect(result.kind).toBe("loaded")
    expect(files.restorePackage).toHaveBeenCalledWith(createProjectId("project-1"), backup)
  })

  it("reports a corrupt package when both the primary and backup are invalid", async () => {
    files.readPackagePrimary.mockResolvedValue(new Uint8Array([0, 1, 2]))
    files.readPackageBackup.mockResolvedValue(new Uint8Array([3, 4, 5]))

    const result = await new TauriProjectStore(createProjectId("project-1")).load()

    expect(result).toEqual({ kind: "corrupt" })
    expect(files.restorePackage).not.toHaveBeenCalled()
  })

  it("loads a valid package backup even when rebuilding the primary fails", async () => {
    const packageBlob = await encodeProjectPackage(
      { document: INITIAL_EDITOR_DOCUMENT, localAssets: [] },
      "recovered",
    )
    files.readPackagePrimary.mockResolvedValue(new Uint8Array([0, 1, 2]))
    files.readPackageBackup.mockResolvedValue(new Uint8Array(await packageBlob.arrayBuffer()))
    files.restorePackage.mockRejectedValue(new Error("disk is read-only"))

    const result = await new TauriProjectStore(createProjectId("project-1")).load()

    expect(result.kind).toBe("loaded")
  })

  it("loads a valid catalog backup when the primary catalog schema is corrupt and rebuilds the primary", async () => {
    const backup = JSON.stringify({ schemaVersion: 1, projects: [] })
    files.readCatalogPrimary.mockResolvedValue("{}")
    files.readCatalogBackup.mockResolvedValue(backup)

    const result = await loadNativeProjectIndex()

    expect(result).toEqual({ kind: "loaded", index: { schemaVersion: 1, projects: [] } })
    expect(files.restoreCatalog).toHaveBeenCalledWith(backup)
  })

  it("reports a corrupt catalog when both the primary and backup are invalid", async () => {
    files.readCatalogPrimary.mockResolvedValue("{}")
    files.readCatalogBackup.mockResolvedValue("not-json")

    const result = await loadNativeProjectIndex()

    expect(result).toEqual({ kind: "corrupt" })
    expect(files.restoreCatalog).not.toHaveBeenCalled()
  })

  it("loads a valid catalog backup even when rebuilding the primary fails", async () => {
    files.readCatalogPrimary.mockResolvedValue("{}")
    files.readCatalogBackup.mockResolvedValue(JSON.stringify({ schemaVersion: 1, projects: [] }))
    files.restoreCatalog.mockRejectedValue(new Error("disk is read-only"))

    await expect(loadNativeProjectIndex()).resolves.toEqual({
      kind: "loaded",
      index: { schemaVersion: 1, projects: [] },
      preserveBackupOnSave: true,
    })
  })
})
