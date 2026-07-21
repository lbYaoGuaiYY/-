import { beforeEach, describe, expect, it, vi } from "vitest"

const fileState = vi.hoisted(() => ({
  files: new Map<string, Uint8Array | string>(),
}))

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: "app-data" },
  exists: vi.fn(async (path: string) => fileState.files.has(path)),
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async (path: string) => {
    const value = fileState.files.get(path)
    if (!(value instanceof Uint8Array)) throw new Error(`missing binary file: ${path}`)
    return new Uint8Array(value)
  }),
  readTextFile: vi.fn(async (path: string) => {
    const value = fileState.files.get(path)
    if (typeof value !== "string") throw new Error(`missing text file: ${path}`)
    return value
  }),
  remove: vi.fn(async (path: string) => {
    fileState.files.delete(path)
  }),
  rename: vi.fn(async (source: string, destination: string) => {
    const value = fileState.files.get(source)
    if (value === undefined) throw new Error(`missing source file: ${source}`)
    fileState.files.delete(source)
    fileState.files.set(destination, value)
  }),
  writeFile: vi.fn(async (path: string, bytes: Uint8Array) => {
    fileState.files.set(path, new Uint8Array(bytes))
  }),
  writeTextFile: vi.fn(async (path: string, contents: string) => {
    fileState.files.set(path, contents)
  }),
}))

import {
  nativeProjectPackagePath,
  readNativeProjectPackageBackup,
  readNativeProjectPackagePrimary,
  restoreNativeCatalogFromBackup,
  restoreNativeProjectPackageFromBackup,
  writeNativeProjectPackage,
} from "../src/features/projects/desktop-project-files"
import { createProjectId } from "../src/features/projects/project-format"

beforeEach(() => {
  fileState.files.clear()
})

describe("desktop project backup files", () => {
  it("rebuilds a corrupt primary package without replacing the valid backup", async () => {
    const projectId = createProjectId("project-1")
    const primaryPath = nativeProjectPackagePath(projectId)
    const backupPath = `${primaryPath}.backup`
    const goodBytes = new Uint8Array([9, 8, 7])
    fileState.files.set(primaryPath, new Uint8Array([0]))
    fileState.files.set(backupPath, goodBytes)

    const backup = await readNativeProjectPackageBackup(projectId)
    await restoreNativeProjectPackageFromBackup(projectId, backup ?? new Uint8Array())

    expect(await readNativeProjectPackagePrimary(projectId)).toEqual(goodBytes)
    expect(fileState.files.get(backupPath)).toEqual(goodBytes)
  })

  it("rebuilds a corrupt primary catalog without replacing the valid backup", async () => {
    fileState.files.set("projects/catalog.json", "not-json")
    fileState.files.set("projects/catalog.json.backup", '{"schemaVersion":1,"projects":[]}')

    await restoreNativeCatalogFromBackup('{"schemaVersion":1,"projects":[]}')

    expect(fileState.files.get("projects/catalog.json")).toBe('{"schemaVersion":1,"projects":[]}')
    expect(fileState.files.get("projects/catalog.json.backup")).toBe(
      '{"schemaVersion":1,"projects":[]}',
    )
  })

  it("preserves a known-good backup on the first save after a failed repair", async () => {
    const projectId = createProjectId("project-1")
    const primaryPath = nativeProjectPackagePath(projectId)
    const backupPath = `${primaryPath}.backup`
    const goodBackup = new Uint8Array([9, 8, 7])
    const nextPrimary = new Uint8Array([6, 5, 4])
    fileState.files.set(primaryPath, new Uint8Array([0]))
    fileState.files.set(backupPath, goodBackup)

    await writeNativeProjectPackage(projectId, nextPrimary, {
      preserveExistingBackup: true,
    })

    expect(fileState.files.get(primaryPath)).toEqual(nextPrimary)
    expect(fileState.files.get(backupPath)).toEqual(goodBackup)
  })
})
