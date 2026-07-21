import { z } from "zod"

import {
  readNativeCatalogBackup,
  readNativeCatalogPrimary,
  restoreNativeCatalogFromBackup,
  writeNativeCatalog,
} from "./desktop-project-files"
import { type ProjectId, ProjectIdSchema } from "./project-format"

const NATIVE_PROJECT_INDEX_VERSION = 1 as const
const NativeProjectEntrySchema = z.object({
  id: ProjectIdSchema,
  name: z.string().trim().min(1).max(80),
  createdAt: z.number().finite().nonnegative(),
  updatedAt: z.number().finite().nonnegative(),
})
const NativeProjectIndexSchema = z.object({
  schemaVersion: z.literal(NATIVE_PROJECT_INDEX_VERSION),
  projects: z.array(NativeProjectEntrySchema),
})

export type NativeProjectEntry = z.infer<typeof NativeProjectEntrySchema>
export type NativeProjectIndex = z.infer<typeof NativeProjectIndexSchema>
export type NativeProjectIndexResult =
  | {
      readonly kind: "loaded"
      readonly index: NativeProjectIndex
      readonly preserveBackupOnSave?: true
    }
  | { readonly kind: "corrupt" }

export async function loadNativeProjectIndex(): Promise<NativeProjectIndexResult> {
  const primaryContents = await readNativeCatalogPrimary()
  const contents = primaryContents ?? (await readNativeCatalogBackup())
  if (contents === null) return { kind: "loaded", index: emptyNativeProjectIndex() }

  const parsed = parseNativeProjectIndex(contents)
  if (parsed !== null) {
    if (primaryContents === null && !(await restoreCatalogBestEffort(contents))) {
      return { kind: "loaded", index: parsed, preserveBackupOnSave: true }
    }
    return { kind: "loaded", index: parsed }
  }

  if (primaryContents !== null) {
    const backupContents = await readNativeCatalogBackup()
    const backup = backupContents === null ? null : parseNativeProjectIndex(backupContents)
    if (backup !== null && backupContents !== null) {
      return (await restoreCatalogBestEffort(backupContents))
        ? { kind: "loaded", index: backup }
        : { kind: "loaded", index: backup, preserveBackupOnSave: true }
    }
  }
  return { kind: "corrupt" }
}

export async function saveNativeProjectIndex(
  index: NativeProjectIndex,
  options: { readonly preserveExistingBackup?: boolean } = {},
): Promise<void> {
  await writeNativeCatalog(JSON.stringify(NativeProjectIndexSchema.parse(index)), options)
}

export function createNativeProjectEntry(
  projectId: ProjectId,
  name: string,
  timestamp: number,
): NativeProjectEntry {
  return NativeProjectEntrySchema.parse({
    id: projectId,
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}

export function createNativeProjectId(): ProjectId {
  return ProjectIdSchema.parse(crypto.randomUUID())
}

export function findNativeProject(
  index: NativeProjectIndex,
  projectId: ProjectId,
): NativeProjectEntry | undefined {
  return index.projects.find((project) => project.id === projectId)
}

function emptyNativeProjectIndex(): NativeProjectIndex {
  return { schemaVersion: NATIVE_PROJECT_INDEX_VERSION, projects: [] }
}

function parseNativeProjectIndex(contents: string): NativeProjectIndex | null {
  try {
    const parsed = NativeProjectIndexSchema.safeParse(JSON.parse(contents))
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return null
  }
}

async function restoreCatalogBestEffort(contents: string): Promise<boolean> {
  try {
    await restoreNativeCatalogFromBackup(contents)
    return true
  } catch {
    // Keep serving the validated backup when the primary cannot be rebuilt yet.
    return false
  }
}
