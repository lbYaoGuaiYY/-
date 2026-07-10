import { z } from "zod"

import {
  type AssetId,
  AssetIdSchema,
  type EditorDocument,
  EditorDocumentSchema,
} from "../editor/editor-model"

export const PROJECT_SCHEMA_VERSION = 1 as const
export const ACTIVE_PROJECT_KEY = "active" as const

const ImageMimeTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"])
const StoredProjectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  updatedAt: z.number().finite().nonnegative(),
  document: EditorDocumentSchema,
})
const StoredLocalAssetSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: AssetIdSchema,
  name: z.string().trim().min(1),
  mimeType: ImageMimeTypeSchema,
  blob: z.instanceof(Blob),
})

export type StoredProjectRecord = {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION
  readonly updatedAt: number
  readonly document: EditorDocument
}

export type StoredLocalAssetRecord = {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION
  readonly id: AssetId
  readonly name: string
  readonly mimeType: z.infer<typeof ImageMimeTypeSchema>
  readonly blob: Blob
}

export type ProjectSnapshot = {
  readonly document: EditorDocument
  readonly localAssets: readonly StoredLocalAssetRecord[]
}

export type ParseResult<T> =
  | { readonly kind: "valid"; readonly value: T }
  | { readonly kind: "corrupt" }

export type ProjectValidationResult =
  | { readonly kind: "valid"; readonly value: ProjectSnapshot }
  | { readonly kind: "corrupt" }

export function parseStoredProject(value: unknown): ParseResult<StoredProjectRecord> {
  const result = StoredProjectSchema.safeParse(value)
  return result.success ? { kind: "valid", value: result.data } : { kind: "corrupt" }
}

export function parseStoredLocalAsset(value: unknown): ParseResult<StoredLocalAssetRecord> {
  const result = StoredLocalAssetSchema.safeParse(value)
  if (!result.success || result.data.blob.type !== result.data.mimeType) {
    return { kind: "corrupt" }
  }
  return { kind: "valid", value: result.data }
}

export function createStoredProject(
  document: EditorDocument,
  updatedAt: number,
): StoredProjectRecord {
  return StoredProjectSchema.parse({ schemaVersion: PROJECT_SCHEMA_VERSION, updatedAt, document })
}

export function validateProjectSnapshot(
  project: StoredProjectRecord,
  localAssets: readonly StoredLocalAssetRecord[],
  builtInAssetIds: ReadonlySet<AssetId>,
): ProjectValidationResult {
  const localById = new Map(localAssets.map((asset) => [asset.id, asset]))
  if (localById.size !== localAssets.length) return { kind: "corrupt" }

  const referencedIds = collectReferencedAssetIds(project.document)
  const referencedLocalAssets: StoredLocalAssetRecord[] = []
  for (const id of referencedIds) {
    if (id.startsWith("built-in:")) {
      if (!builtInAssetIds.has(id)) return { kind: "corrupt" }
      continue
    }
    if (!id.startsWith("local:")) return { kind: "corrupt" }
    const localAsset = localById.get(id)
    if (localAsset === undefined) return { kind: "corrupt" }
    referencedLocalAssets.push(localAsset)
  }

  return {
    kind: "valid",
    value: { document: project.document, localAssets: referencedLocalAssets },
  }
}

export function collectReferencedAssetIds(document: EditorDocument): ReadonlySet<AssetId> {
  const ids = new Set<AssetId>()
  if (document.backgroundAssetId !== null) ids.add(document.backgroundAssetId)
  for (const layer of document.layers) ids.add(layer.assetId)
  return ids
}
