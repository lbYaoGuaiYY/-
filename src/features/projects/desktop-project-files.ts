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

export async function writeNativeProjectPackage(
  projectId: ProjectId,
  bytes: Uint8Array,
): Promise<void> {
  await writeBinaryWithBackup(nativeProjectPackagePath(projectId), bytes)
}

export async function removeNativeProjectPackage(projectId: ProjectId): Promise<void> {
  await removeAllVersions(nativeProjectPackagePath(projectId))
}

export async function readNativeCatalog(): Promise<string | null> {
  return readTextWithBackup(CATALOG_PATH)
}

export async function writeNativeCatalog(contents: string): Promise<void> {
  await writeTextWithBackup(CATALOG_PATH, contents)
}

async function readBinaryWithBackup(path: string): Promise<Uint8Array | null> {
  if (await exists(path, { baseDir: BaseDirectory.AppData })) {
    return readFile(path, { baseDir: BaseDirectory.AppData })
  }
  const backupPath = backupFor(path)
  return (await exists(backupPath, { baseDir: BaseDirectory.AppData }))
    ? readFile(backupPath, { baseDir: BaseDirectory.AppData })
    : null
}

async function readTextWithBackup(path: string): Promise<string | null> {
  if (await exists(path, { baseDir: BaseDirectory.AppData })) {
    return readTextFile(path, { baseDir: BaseDirectory.AppData })
  }
  const backupPath = backupFor(path)
  return (await exists(backupPath, { baseDir: BaseDirectory.AppData }))
    ? readTextFile(backupPath, { baseDir: BaseDirectory.AppData })
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
