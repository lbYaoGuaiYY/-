import ky from "ky"
import { z } from "zod"
import { createAssetClientHeaders, getAssetClientIdentity } from "./asset-client-identity"
import {
  ASSET_SERVICE_CONFIG,
  type AssetMediaKind,
  createAssetServiceHeaders,
  createAssetServiceMediaUrl,
} from "./asset-service-config"
import { ASSET_CATEGORIES } from "./demo-assets"

const CategorySchema = z.enum(ASSET_CATEGORIES)
export const ServiceAssetSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  category: CategorySchema,
  status: z.string(),
  mime_type: z.string(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  needs_review: z.union([z.boolean(), z.number()]).transform(Boolean),
  favorite: z.union([z.boolean(), z.number()]).transform(Boolean),
  dominant_color: z.string().nullable(),
  tags: z.array(z.string()),
  usage_count: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
})
const ServiceJobSchema = z.object({
  id: z.string().uuid(),
  asset_id: z.string().uuid(),
  status: z.enum(["pending", "processing", "ready", "failed"]),
  attempts: z.number().int().nonnegative(),
  error: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
const AssetsResponseSchema = z.object({ assets: z.array(ServiceAssetSchema) })
const JobsResponseSchema = z.object({ jobs: z.array(ServiceJobSchema) })
const CatalogRevisionResponseSchema = z.object({ revision: z.number().int().nonnegative() })
const AssetEventPayloadSchema = z.object({ assetId: z.string().uuid() })
const ASSET_READ_RETRY = {
  // One short retry absorbs transient edge/upstream failures while the
  // application-managed cache remains the bounded fallback.
  limit: 1,
  methods: ["get"],
  statusCodes: [408, 425, 429, 500, 502, 503, 504],
}

export type ServiceAsset = z.infer<typeof ServiceAssetSchema>
export type ServiceJob = z.infer<typeof ServiceJobSchema>
export type ServiceAssetEvent = {
  readonly assetId: string
  readonly type: "asset.ready" | "asset.updated" | "asset.deleted"
}

function parseAssetEventPayload(data: string): z.infer<typeof AssetEventPayloadSchema> | null {
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
  const parsed = AssetEventPayloadSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export type AssetImportProgress = {
  readonly completed: number
  readonly failed: number
  readonly succeeded: number
  readonly total: number
}

export type AssetImportSummary = AssetImportProgress & {
  readonly failedFiles: readonly string[]
}

export const ASSET_PAGE_SIZE = 120 as const

export type ServiceAssetPageQuery = {
  readonly search: string
  readonly category: string
  readonly status: string
  readonly needsReview: boolean | null
  readonly limit: number
  readonly offset: number
}

export type ServiceAssetRequestOptions = {
  readonly signal?: AbortSignal
}

export function throwIfAssetRequestAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return
  const reason = signal.reason
  if (reason !== undefined) throw reason
  throw new DOMException("The operation was aborted", "AbortError")
}

export type ServiceAssetPage = {
  readonly assets: readonly ServiceAsset[]
  readonly hasMore: boolean
  readonly revision: string | null
}

const client = ky.create({
  prefix: `${ASSET_SERVICE_CONFIG.baseUrl}/`,
  headers: {
    ...createAssetServiceHeaders(ASSET_SERVICE_CONFIG),
    ...createAssetClientHeaders(getAssetClientIdentity()),
  },
  timeout: 8_000,
  retry: ASSET_READ_RETRY,
})
const pendingAssetPages = new Map<string, Promise<ServiceAssetPage>>()
const cachedAssetPages = new Map<
  string,
  { readonly etag: string; readonly page: ServiceAssetPage }
>()

export function listServiceAssetPage(
  query: ServiceAssetPageQuery,
  options: ServiceAssetRequestOptions = {},
): Promise<ServiceAssetPage> {
  const { search, category, status, needsReview, limit, offset } = query
  const { signal } = options
  const requestKey = JSON.stringify([search, category, status, needsReview, limit, offset])
  // Requests with a caller-owned signal must remain independently abortable.
  // The no-signal path retains the existing request coalescing behavior.
  if (signal === undefined) {
    const pendingRequest = pendingAssetPages.get(requestKey)
    if (pendingRequest !== undefined) return pendingRequest
  }

  const request = (async () => {
    throwIfAssetRequestAborted(signal)
    const searchParams = new URLSearchParams({
      query: search,
      category,
      status,
      limit: String(limit),
      offset: String(offset),
    })
    if (needsReview !== null) searchParams.set("needs_review", needsReview ? "1" : "0")
    const cached = cachedAssetPages.get(requestKey)
    const response = await client.get("assets", {
      ...(cached === undefined ? {} : { headers: { "If-None-Match": cached.etag } }),
      searchParams,
      // Preserve conditional 304 responses while allowing Ky to throw and
      // retry configured transient 5xx/429 responses before cache fallback.
      throwHttpErrors: (statusCode) => statusCode !== 304,
      ...(signal === undefined ? {} : { signal }),
    })
    throwIfAssetRequestAborted(signal)
    if (response.status === 304 && cached !== undefined) return cached.page
    if (!response.ok) throw new Error(`素材服务请求失败（HTTP ${response.status}）`)
    const payload = await response.json()
    const assets = AssetsResponseSchema.parse(payload).assets
    const page = {
      assets,
      hasMore: assets.length === limit,
      revision: response.headers.get("X-Catalog-Revision"),
    }
    const etag = response.headers.get("ETag")
    throwIfAssetRequestAborted(signal)
    if (etag !== null) cachedAssetPages.set(requestKey, { etag, page })
    return page
  })()

  if (signal === undefined) {
    pendingAssetPages.set(requestKey, request)
    void request.then(
      () => {
        if (pendingAssetPages.get(requestKey) === request) pendingAssetPages.delete(requestKey)
      },
      () => {
        if (pendingAssetPages.get(requestKey) === request) pendingAssetPages.delete(requestKey)
      },
    )
  }
  return request
}

export async function getServiceCatalogRevision(signal?: AbortSignal): Promise<number> {
  const payload = await client
    .get("catalog/revision", signal === undefined ? {} : { signal })
    .json()
  return CatalogRevisionResponseSchema.parse(payload).revision
}

export async function listServiceAssets(
  search = "",
  category = "",
  status = "ready",
  loadAll = true,
  needsReview: boolean | null = null,
): Promise<readonly ServiceAsset[]> {
  const assets: ServiceAsset[] = []
  do {
    const page = await listServiceAssetPage({
      search,
      category,
      status,
      needsReview,
      limit: 500,
      offset: assets.length,
    })
    assets.push(...page.assets)
    if (!loadAll || !page.hasMore) break
  } while (assets.length < 10_000)
  return assets
}

export async function listServiceJobs(): Promise<readonly ServiceJob[]> {
  return JobsResponseSchema.parse(await client.get("jobs").json()).jobs
}

export async function getServiceAsset(assetId: string): Promise<ServiceAsset> {
  return ServiceAssetSchema.parse(await client.get(`assets/${assetId}`).json())
}

export function serviceAssetMediaUrl(
  assetId: string,
  kind: AssetMediaKind,
  version: number,
): string {
  return createAssetServiceMediaUrl(ASSET_SERVICE_CONFIG, assetId, kind, version)
}

export async function readServiceAssetFile(assetId: string, kind: AssetMediaKind): Promise<Blob> {
  return client.get(`assets/${assetId}/${kind}`).blob()
}

export async function importServiceAsset(file: Blob, name: string): Promise<void> {
  await client.post("assets/import", {
    body: file,
    headers: { "Content-Type": file.type },
    searchParams: { name },
    timeout: 60_000,
  })
  pendingAssetPages.clear()
  cachedAssetPages.clear()
}

export async function importServiceAssets(
  files: readonly File[],
  onProgress?: (progress: AssetImportProgress) => void,
): Promise<AssetImportSummary> {
  let nextIndex = 0
  let succeeded = 0
  const failedFiles: string[] = []
  const workerCount = Math.min(3, files.length)

  async function uploadNext(): Promise<void> {
    while (nextIndex < files.length) {
      const file = files[nextIndex]
      nextIndex += 1
      if (file === undefined) continue
      try {
        await importServiceAsset(file, file.name.replace(/\.[^.]+$/, "") || file.name)
        succeeded += 1
      } catch {
        failedFiles.push(file.name)
      }
      onProgress?.({
        completed: succeeded + failedFiles.length,
        failed: failedFiles.length,
        succeeded,
        total: files.length,
      })
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => uploadNext()))
  return {
    completed: files.length,
    failed: failedFiles.length,
    failedFiles,
    succeeded,
    total: files.length,
  }
}

export async function patchServiceAsset(
  assetId: string,
  changes: Record<string, unknown>,
): Promise<void> {
  await client.patch(`assets/${assetId}`, { json: changes })
  pendingAssetPages.clear()
  cachedAssetPages.clear()
}

export async function deleteServiceAsset(assetId: string): Promise<void> {
  await client.delete(`assets/${assetId}`)
  pendingAssetPages.clear()
  cachedAssetPages.clear()
}

export async function restoreServiceAsset(assetId: string): Promise<void> {
  await client.post(`assets/${assetId}/restore`)
  pendingAssetPages.clear()
  cachedAssetPages.clear()
}

export async function backupServiceCatalog(): Promise<string> {
  const payload = z
    .object({ path: z.string() })
    .parse(await client.post("maintenance/backup").json())
  return payload.path
}

export async function repairServiceCatalog(): Promise<void> {
  await client.post("maintenance/repair")
}

export async function retryServiceJob(jobId: string): Promise<void> {
  await client.post(`jobs/${jobId}/retry`)
}

export function subscribeToAssetEvents(onEvent: (event: ServiceAssetEvent) => void): () => void {
  if (!ASSET_SERVICE_CONFIG.eventsEnabled) return () => undefined
  const eventUrl = new URL(`${ASSET_SERVICE_CONFIG.baseUrl}/events`)
  if (ASSET_SERVICE_CONFIG.editorToken !== null) {
    eventUrl.searchParams.set("access_token", ASSET_SERVICE_CONFIG.editorToken)
  }
  const source = new EventSource(eventUrl)
  const subscribe = (type: ServiceAssetEvent["type"]): void => {
    source.addEventListener(type, (message) => {
      if (!(message instanceof MessageEvent) || typeof message.data !== "string") return
      const payload = parseAssetEventPayload(message.data)
      if (payload === null) return
      pendingAssetPages.clear()
      onEvent({ assetId: payload.assetId, type })
    })
  }
  subscribe("asset.ready")
  subscribe("asset.updated")
  subscribe("asset.deleted")
  return () => source.close()
}
