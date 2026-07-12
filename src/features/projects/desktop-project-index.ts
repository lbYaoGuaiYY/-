import { z } from "zod"

import { readNativeCatalog, writeNativeCatalog } from "./desktop-project-files"
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
  | { readonly kind: "loaded"; readonly index: NativeProjectIndex }
  | { readonly kind: "corrupt" }

export async function loadNativeProjectIndex(): Promise<NativeProjectIndexResult> {
  const contents = await readNativeCatalog()
  if (contents === null) return { kind: "loaded", index: emptyNativeProjectIndex() }
  try {
    const parsed = NativeProjectIndexSchema.safeParse(JSON.parse(contents))
    return parsed.success ? { kind: "loaded", index: parsed.data } : { kind: "corrupt" }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { kind: "corrupt" }
  }
}

export async function saveNativeProjectIndex(index: NativeProjectIndex): Promise<void> {
  await writeNativeCatalog(JSON.stringify(NativeProjectIndexSchema.parse(index)))
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
