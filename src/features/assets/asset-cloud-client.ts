import ky from "ky"
import { z } from "zod"

import { readServiceAssetFile, type ServiceAsset } from "./asset-service-client"

const PublishResponseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  duplicate: z.boolean(),
})
const MutationResponseSchema = z.object({ updated: z.boolean() })

export type CloudSyncProgress = {
  readonly completed: number
  readonly failed: number
  readonly succeeded: number
  readonly total: number
}

export type CloudSyncSummary = CloudSyncProgress & {
  readonly failedAssets: readonly string[]
  readonly firstError: string | null
}

export type CloudAutoSyncCandidate = Pick<ServiceAsset, "status" | "needs_review">

export class CloudSyncConfigurationError extends Error {
  constructor() {
    super("云端素材地址或管理密钥尚未配置")
    this.name = "CloudSyncConfigurationError"
  }
}

const cloudBaseUrl = import.meta.env.VITE_ASSET_CLOUD_URL?.trim().replace(/\/+$/, "") ?? ""
const cloudAdminToken = import.meta.env.VITE_ASSET_CLOUD_ADMIN_TOKEN?.trim() ?? ""

export function isCloudAssetSyncConfigured(): boolean {
  return cloudBaseUrl !== "" && cloudAdminToken !== ""
}

export function isCloudAutoSyncCandidate(asset: CloudAutoSyncCandidate): boolean {
  return asset.status === "ready" && !asset.needs_review
}

async function originalContentHash(asset: ServiceAsset): Promise<string> {
  const original = await readServiceAssetFile(asset.id, "original")
  const digest = await crypto.subtle.digest("SHA-256", await original.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function deleteServiceAssetsFromCloud(assets: readonly ServiceAsset[]): Promise<void> {
  if (!isCloudAssetSyncConfigured()) return
  for (const asset of assets) {
    const contentHash = await originalContentHash(asset)
    MutationResponseSchema.parse(
      await ky
        .delete(`${cloudBaseUrl}/admin/assets/by-content-hash/${contentHash}`, {
          headers: { Authorization: `Bearer ${cloudAdminToken}` },
          retry: 0,
          timeout: 30_000,
        })
        .json(),
    )
  }
}

async function publishAssetToCloud(asset: ServiceAsset): Promise<void> {
  if (!isCloudAssetSyncConfigured()) throw new CloudSyncConfigurationError()
  const [original, processed, thumbnail] = await Promise.all([
    readServiceAssetFile(asset.id, "original"),
    readServiceAssetFile(asset.id, "processed"),
    readServiceAssetFile(asset.id, "thumbnail"),
  ])
  const body = new FormData()
  body.set(
    "metadata",
    JSON.stringify({
      name: asset.name,
      category: asset.category,
      width: asset.width,
      height: asset.height,
      needs_review: asset.needs_review,
    }),
  )
  body.set("original", new File([original], `${asset.id}-original`, { type: asset.mime_type }))
  body.set("processed", new File([processed], `${asset.id}.png`, { type: "image/png" }))
  body.set("thumbnail", new File([thumbnail], `${asset.id}.webp`, { type: "image/webp" }))
  PublishResponseSchema.parse(
    await ky
      .post(`${cloudBaseUrl}/admin/assets/publish`, {
        body,
        headers: { Authorization: `Bearer ${cloudAdminToken}` },
        retry: 0,
        timeout: 120_000,
      })
      .json(),
  )
}

export async function syncServiceAssetsToCloud(
  assets: readonly ServiceAsset[],
  onProgress?: (progress: CloudSyncProgress) => void,
): Promise<CloudSyncSummary> {
  let nextIndex = 0
  let succeeded = 0
  const failedAssets: string[] = []
  let firstError: string | null = null
  const workerCount = Math.min(1, assets.length)

  async function syncNext(): Promise<void> {
    while (nextIndex < assets.length) {
      const asset = assets[nextIndex]
      nextIndex += 1
      if (asset === undefined) continue
      try {
        await publishAssetToCloud(asset)
        succeeded += 1
      } catch (error) {
        if (!(error instanceof Error)) throw error
        failedAssets.push(asset.name)
        firstError ??= error.message
      }
      onProgress?.({
        completed: succeeded + failedAssets.length,
        failed: failedAssets.length,
        succeeded,
        total: assets.length,
      })
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => syncNext()))
  return {
    completed: assets.length,
    failed: failedAssets.length,
    failedAssets,
    firstError,
    succeeded,
    total: assets.length,
  }
}
