import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  readTextFile,
  remove,
  rename,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs"

import type { ProjectId } from "./project-format"

const PROJECTS_DIRECTORY = "projects"
const CATALOG_PATH = `${PROJECTS_DIRECTORY}/catalog.json`

export function nativeProjectPackagePath(projectId: ProjectId): string {
  return `${PROJECTS_DIRECTORY}/${encodeURIComponent(projectId)}.qingshe`
}

export async function readNativeProjectPackage(projectId: ProjectId): Promise<Uint8Array | null> {
  return readBinaryWithBackup(nativeProjectPackagePath(projectId))
}

/** Read only the current project package, without falling back to a backup. */
export async function readNativeProjectPackagePrimary(
  projectId: ProjectId,
): Promise<Uint8Array | null> {
  return readBinaryIfPresent(nativeProjectPackagePath(projectId))
}

/** Read only the last-known-good project package backup. */
export async function readNativeProjectPackageBackup(
  projectId: ProjectId,
): Promise<Uint8Array | null> {
  return readBinaryIfPresent(backupFor(nativeProjectPackagePath(projectId)))
}

export async function writeNativeProjectPackage(
  projectId: ProjectId,
  bytes: Uint8Array,
  options: { readonly preserveExistingBackup?: boolean } = {},
): Promise<void> {
  const path = nativeProjectPackagePath(projectId)
  if (options.preserveExistingBackup) await writeBinaryKeepingBackup(path, bytes)
  else await writeBinaryWithBackup(path, bytes)
}

/** Rebuild the primary package while preserving the valid backup in place. */
export async function restoreNativeProjectPackageFromBackup(
  projectId: ProjectId,
  bytes: Uint8Array,
): Promise<void> {
  await writeBinaryKeepingBackup(nativeProjectPackagePath(projectId), bytes)
}

export async function removeNativeProjectPackage(projectId: ProjectId): Promise<void> {
  await removeAllVersions(nativeProjectPackagePath(projectId))
}

export async function readNativeCatalog(): Promise<string | null> {
  return readTextWithBackup(CATALOG_PATH)
}

/** Read only the current catalog, without falling back to a backup. */
export async function readNativeCatalogPrimary(): Promise<string | null> {
  return readTextIfPresent(CATALOG_PATH)
}

/** Read only the last-known-good catalog backup. */
export async function readNativeCatalogBackup(): Promise<string | null> {
  return readTextIfPresent(backupFor(CATALOG_PATH))
}

export async function writeNativeCatalog(
  contents: string,
  options: { readonly preserveExistingBackup?: boolean } = {},
): Promise<void> {
  if (options.preserveExistingBackup) await writeTextKeepingBackup(CATALOG_PATH, contents)
  else await writeTextWithBackup(CATALOG_PATH, contents)
}

/** Rebuild the primary catalog while preserving the valid backup in place. */
export async function restoreNativeCatalogFromBackup(contents: string): Promise<void> {
  await writeTextKeepingBackup(CATALOG_PATH, contents)
}

async function readBinaryWithBackup(path: string): Promise<Uint8Array | null> {
  const primary = await readBinaryIfPresent(path)
  if (primary !== null) return primary
  return readBinaryIfPresent(backupFor(path))
}

async function readTextWithBackup(path: string): Promise<string | null> {
  const primary = await readTextIfPresent(path)
  if (primary !== null) return primary
  return readTextIfPresent(backupFor(path))
}

async function readBinaryIfPresent(path: string): Promise<Uint8Array | null> {
  return (await exists(path, { baseDir: BaseDirectory.AppData }))
    ? readFile(path, { baseDir: BaseDirectory.AppData })
    : null
}

async function readTextIfPresent(path: string): Promise<string | null> {
  return (await exists(path, { baseDir: BaseDirectory.AppData }))
    ? readTextFile(path, { baseDir: BaseDirectory.AppData })
    : null
}

async function writeBinaryWithBackup(path: string, bytes: Uint8Array): Promise<void> {
  await ensureProjectsDirectory()
  const temporaryPath = temporaryFor(path)
  await writeFile(temporaryPath, bytes, { baseDir: BaseDirectory.AppData })
  await replaceWithBackup(path, temporaryPath)
}

async function writeTextWithBackup(path: string, contents: string): Promise<void> {
  await ensureProjectsDirectory()
  const temporaryPath = temporaryFor(path)
  await writeTextFile(temporaryPath, contents, { baseDir: BaseDirectory.AppData })
  await replaceWithBackup(path, temporaryPath)
}

async function writeBinaryKeepingBackup(path: string, bytes: Uint8Array): Promise<void> {
  await ensureProjectsDirectory()
  const temporaryPath = temporaryFor(path)
  await writeFile(temporaryPath, bytes, { baseDir: BaseDirectory.AppData })
  await replacePrimaryKeepingBackup(path, temporaryPath)
}

async function writeTextKeepingBackup(path: string, contents: string): Promise<void> {
  await ensureProjectsDirectory()
  const temporaryPath = temporaryFor(path)
  await writeTextFile(temporaryPath, contents, { baseDir: BaseDirectory.AppData })
  await replacePrimaryKeepingBackup(path, temporaryPath)
}

async function ensureProjectsDirectory(): Promise<void> {
  await mkdir(PROJECTS_DIRECTORY, { baseDir: BaseDirectory.AppData, recursive: true })
}

async function replaceWithBackup(path: string, temporaryPath: string): Promise<void> {
  const backupPath = backupFor(path)
  await removeIfPresent(backupPath)
  if (await exists(path, { baseDir: BaseDirectory.AppData })) {
    await rename(path, backupPath, renameOptions())
  }
  await rename(temporaryPath, path, renameOptions())
}

async function replacePrimaryKeepingBackup(path: string, temporaryPath: string): Promise<void> {
  await removeIfPresent(path)
  await rename(temporaryPath, path, renameOptions())
}

async function removeAllVersions(path: string): Promise<void> {
  await removeIfPresent(path)
  await removeIfPresent(temporaryFor(path))
  await removeIfPresent(backupFor(path))
}

async function removeIfPresent(path: string): Promise<void> {
  if (await exists(path, { baseDir: BaseDirectory.AppData })) {
    await remove(path, { baseDir: BaseDirectory.AppData })
  }
}

function renameOptions() {
  return {
    oldPathBaseDir: BaseDirectory.AppData,
    newPathBaseDir: BaseDirectory.AppData,
  }
}

function temporaryFor(path: string): string {
  return `${path}.next`
}

function backupFor(path: string): string {
  return `${path}.backup`
}
