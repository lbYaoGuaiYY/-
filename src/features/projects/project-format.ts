import { z } from "zod"

import {
  type AssetId,
  AssetIdSchema,
  type EditorDocument,
  EditorDocumentSchema,
  ImageLayerSchema,
} from "../editor/editor-model"

export const PROJECT_SCHEMA_VERSION = 2 as const
export const ACTIVE_PROJECT_KEY = "active" as const

const ImageMimeTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"])
const LegacyEditorDocumentSchema = EditorDocumentSchema.extend({
  layers: z.array(ImageLayerSchema.omit({ visible: true, locked: true })),
})
const StoredProjectV1Schema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.number().finite().nonnegative(),
  document: LegacyEditorDocumentSchema,
})
const StoredProjectV2Schema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  updatedAt: z.number().finite().nonnegative(),
  document: EditorDocumentSchema,
})
const StoredLocalAssetV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: AssetIdSchema,
  name: z.string().trim().min(1),
  mimeType: ImageMimeTypeSchema,
  blob: z.instanceof(Blob),
})
const StoredLocalAssetV2Schema = StoredLocalAssetV1Schema.extend({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
})

export type StoredProjectRecord = z.infer<typeof StoredProjectV2Schema>
export type StoredLocalAssetRecord = z.infer<typeof StoredLocalAssetV2Schema>

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
  return parseSchema(StoredProjectV2Schema, value)
}

export function migrateStoredProject(value: unknown): ParseResult<StoredProjectRecord> {
  const current = parseStoredProject(value)
  if (current.kind === "valid") return current
  const legacy = parseSchema(StoredProjectV1Schema, value)
  if (legacy.kind === "corrupt") return legacy
  return {
    kind: "valid",
    value: {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      updatedAt: legacy.value.updatedAt,
      document: {
        ...legacy.value.document,
        layers: legacy.value.document.layers.map((layer) => ({
          ...layer,
          visible: true,
          locked: false,
        })),
      },
    },
  }
}

export function parseStoredLocalAsset(value: unknown): ParseResult<StoredLocalAssetRecord> {
  return parseLocalAsset(StoredLocalAssetV2Schema, value)
}

export function migrateStoredLocalAsset(value: unknown): ParseResult<StoredLocalAssetRecord> {
  const current = parseStoredLocalAsset(value)
  if (current.kind === "valid") return current
  const legacy = parseLocalAsset(StoredLocalAssetV1Schema, value)
  if (legacy.kind === "corrupt") return legacy
  return {
    kind: "valid",
    value: { ...legacy.value, schemaVersion: PROJECT_SCHEMA_VERSION },
  }
}

export function createStoredProject(
  document: EditorDocument,
  updatedAt: number,
): StoredProjectRecord {
  return StoredProjectV2Schema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    updatedAt,
    document,
  })
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

function parseSchema<T>(schema: z.ZodType<T>, value: unknown): ParseResult<T> {
  const result = schema.safeParse(value)
  return result.success ? { kind: "valid", value: result.data } : { kind: "corrupt" }
}

function parseLocalAsset<T extends { readonly blob: Blob; readonly mimeType: string }>(
  schema: z.ZodType<T>,
  value: unknown,
): ParseResult<T> {
  const result = parseSchema(schema, value)
  if (result.kind === "corrupt" || result.value.blob.type !== result.value.mimeType) {
    return { kind: "corrupt" }
  }
  return result
}
