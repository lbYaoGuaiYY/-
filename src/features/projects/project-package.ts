import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import { z } from "zod"

import { DEMO_ASSETS } from "../assets/demo-assets"
import {
  type AssetId,
  AssetIdSchema,
  createAssetId,
  EditorDocumentSchema,
} from "../editor/editor-model"
import {
  createStoredProject,
  PROJECT_SCHEMA_VERSION,
  type ProjectSnapshot,
  parseStoredLocalAsset,
  type StoredLocalAssetRecord,
  validateProjectSnapshot,
} from "./project-format"

const PACKAGE_FORMAT = "qingshe-project"
const PACKAGE_VERSION = 1
const MAX_PROJECT_PACKAGE_BYTES = 500 * 1024 * 1024
const ImageMimeTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"])
const PackageAssetSchema = z.object({
  id: AssetIdSchema,
  name: z.string().trim().min(1),
  mimeType: ImageMimeTypeSchema,
  path: z.string().regex(/^assets\/\d+\.(?:jpg|png|webp)$/),
})
const ProjectPackageManifestSchema = z.object({
  format: z.literal(PACKAGE_FORMAT),
  formatVersion: z.literal(PACKAGE_VERSION),
  projectName: z.string().trim().min(1).max(80),
  document: EditorDocumentSchema,
  assets: z.array(PackageAssetSchema),
})
const BUILT_IN_ASSET_IDS: ReadonlySet<AssetId> = new Set(
  DEMO_ASSETS.map((asset) => createAssetId(`built-in:${asset.id}`)),
)

export type DecodeProjectPackageResult =
  | {
      readonly kind: "valid"
      readonly projectName: string
      readonly snapshot: ProjectSnapshot
    }
  | { readonly kind: "invalid" | "too_large" }

export async function encodeProjectPackage(
  snapshot: ProjectSnapshot,
  projectName: string,
): Promise<Blob> {
  const localAssets = parseLocalAssets(snapshot.localAssets)
  const validation = validateProjectSnapshot(
    createStoredProject(snapshot.document, Date.now()),
    localAssets,
    BUILT_IN_ASSET_IDS,
  )
  if (validation.kind === "corrupt") throw new InvalidProjectPackageError()

  const entries: Record<string, Uint8Array> = {}
  const assets = []
  for (const [index, asset] of validation.value.localAssets.entries()) {
    const path = `assets/${index}.${extensionForMimeType(asset.mimeType)}`
    entries[path] = new Uint8Array(await asset.blob.arrayBuffer())
    assets.push({ id: asset.id, name: asset.name, mimeType: asset.mimeType, path })
  }
  entries["manifest.json"] = strToU8(
    JSON.stringify({
      format: PACKAGE_FORMAT,
      formatVersion: PACKAGE_VERSION,
      projectName,
      document: validation.value.document,
      assets,
    }),
  )
  const manifest = ProjectPackageManifestSchema.safeParse(
    JSON.parse(strFromU8(entries["manifest.json"])),
  )
  if (!manifest.success) throw new InvalidProjectPackageError()
  return new Blob([zipSync(entries, { level: 0 })], { type: "application/zip" })
}

export async function decodeProjectPackage(blob: Blob): Promise<DecodeProjectPackageResult> {
  if (blob.size > MAX_PROJECT_PACKAGE_BYTES) return { kind: "too_large" }
  try {
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const manifestBytes = entries["manifest.json"]
    if (manifestBytes === undefined) return { kind: "invalid" }
    const parsedManifest = ProjectPackageManifestSchema.safeParse(
      JSON.parse(strFromU8(manifestBytes)),
    )
    if (!parsedManifest.success) return { kind: "invalid" }

    const localAssets: StoredLocalAssetRecord[] = []
    for (const asset of parsedManifest.data.assets) {
      const bytes = entries[asset.path]
      if (bytes === undefined) return { kind: "invalid" }
      localAssets.push({
        schemaVersion: PROJECT_SCHEMA_VERSION,
        id: asset.id,
        name: asset.name,
        mimeType: asset.mimeType,
        blob: new Blob([bytes], { type: asset.mimeType }),
      })
    }
    const parsedAssets = parseLocalAssets(localAssets)
    const validation = validateProjectSnapshot(
      createStoredProject(parsedManifest.data.document, Date.now()),
      parsedAssets,
      BUILT_IN_ASSET_IDS,
    )
    if (validation.kind === "corrupt") return { kind: "invalid" }
    return {
      kind: "valid",
      projectName: parsedManifest.data.projectName,
      snapshot: validation.value,
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { kind: "invalid" }
  }
}

export async function downloadProjectPackage(
  snapshot: ProjectSnapshot,
  projectName: string,
): Promise<void> {
  const blob = await encodeProjectPackage(snapshot, projectName)
  downloadBlob(blob, projectPackageFilename(projectName))
}

export function projectPackageFilename(projectName: string): string {
  return `${safeFilename(projectName)}.qingshe`
}

function parseLocalAssets(
  assets: readonly StoredLocalAssetRecord[],
): readonly StoredLocalAssetRecord[] {
  const parsedAssets: StoredLocalAssetRecord[] = []
  for (const asset of assets) {
    const parsed = parseStoredLocalAsset(asset)
    if (parsed.kind === "corrupt") throw new InvalidProjectPackageError()
    parsedAssets.push(parsed.value)
  }
  return parsedAssets
}

function extensionForMimeType(mimeType: StoredLocalAssetRecord["mimeType"]): string {
  if (mimeType === "image/jpeg") return "jpg"
  if (mimeType === "image/webp") return "webp"
  return "png"
}

function safeFilename(name: string): string {
  const printableName = Array.from(name)
    .filter((character) => character.charCodeAt(0) > 31)
    .join("")
  return printableName.replace(/[<>:"/\\|?*]/g, "-").trim() || "轻设项目"
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

class InvalidProjectPackageError extends Error {
  readonly name = "InvalidProjectPackageError"
}
