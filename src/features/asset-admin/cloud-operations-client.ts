import ky from "ky"
import { z } from "zod"
import { assetAdminCloudBaseUrl } from "./asset-admin-config"

const CLOUD_READ_RETRY = {
  limit: 2,
  methods: ["get"],
  statusCodes: [408, 425, 429, 500, 502, 503, 504],
}

const UsageSchema = z.object({
  total_bytes: z.number().int().nonnegative(),
  used_bytes: z.number().int().nonnegative(),
  available_bytes: z.number().int().nonnegative(),
  used_percent: z.number().min(0).max(100),
})
const ControlsSchema = z.object({
  maintenance_mode: z.boolean(),
  downloads_enabled: z.boolean(),
  max_concurrent_downloads: z.number().int().min(1).max(64),
  active_downloads: z.number().int().nonnegative(),
})
const AlertSchema = z.object({
  severity: z.enum(["warning", "critical"]),
  code: z.string(),
  message: z.string(),
})
const SummarySchema = z.object({
  status: z.enum(["ready", "degraded"]),
  generated_at: z.string().datetime({ offset: true }),
  uptime_seconds: z.number().int().nonnegative(),
  host: z.object({
    cpu: z.object({
      count: z.number().int().positive(),
      load_1m: z.number().nonnegative(),
      load_5m: z.number().nonnegative(),
      load_15m: z.number().nonnegative(),
      estimated_usage_percent: z.number().min(0).max(100),
    }),
    memory: UsageSchema,
    disk: UsageSchema,
    uptime_seconds: z.number().int().nonnegative(),
  }),
  library: z.object({
    total: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    processing: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
  }),
  clients: z.object({
    active_5m: z.number().int().nonnegative(),
    seen_24h: z.number().int().nonnegative(),
  }),
  requests: z.object({
    last_24h: z.number().int().nonnegative(),
    failures_24h: z.number().int().nonnegative(),
    average_duration_ms: z.number().nonnegative(),
  }),
  transfers: z.object({
    active_downloads: z.number().int().nonnegative(),
    downloads_24h: z.number().int().nonnegative(),
    download_bytes_24h: z.number().int().nonnegative(),
  }),
  controls: ControlsSchema,
  alerts: z.array(AlertSchema),
})
const ClientSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{16}$/),
  platform: z.enum(["windows", "macos", "ios", "web", "unknown"]),
  version: z.string(),
  last_seen: z.string().datetime({ offset: true }),
  requests_24h: z.number().int().nonnegative(),
  download_bytes_24h: z.number().int().nonnegative(),
})
const ClientsSchema = z.object({ clients: z.array(ClientSchema) })
const TransferWindowSchema = z.object({
  started_at: z.string().datetime({ offset: true }),
  requests: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  downloads: z.number().int().nonnegative(),
  download_bytes: z.number().int().nonnegative(),
  duration_ms: z.number().nonnegative(),
})
const TransfersSchema = z.object({ windows: z.array(TransferWindowSchema) })

export type CloudOperationsSummary = z.infer<typeof SummarySchema>
export type CloudClient = z.infer<typeof ClientSchema>
export type CloudTransferWindow = z.infer<typeof TransferWindowSchema>
export type CloudControls = z.infer<typeof ControlsSchema>
export type CloudControlsPatch = Partial<
  Pick<CloudControls, "maintenance_mode" | "downloads_enabled" | "max_concurrent_downloads">
>

export function parseCloudOperationsSummary(value: unknown): CloudOperationsSummary {
  return SummarySchema.parse(value)
}

export function parseCloudClients(value: unknown): readonly CloudClient[] {
  return ClientsSchema.parse(value).clients
}

export function parseCloudTransfers(value: unknown): readonly CloudTransferWindow[] {
  return TransfersSchema.parse(value).windows
}

export async function readCloudOperationsSummary(): Promise<CloudOperationsSummary> {
  return parseCloudOperationsSummary(
    await createCloudAdminClient().get("admin/observability/summary").json(),
  )
}

export async function readCloudClients(): Promise<readonly CloudClient[]> {
  return parseCloudClients(await createCloudAdminClient().get("admin/observability/clients").json())
}

export async function readCloudTransfers(): Promise<readonly CloudTransferWindow[]> {
  return parseCloudTransfers(
    await createCloudAdminClient().get("admin/observability/transfers").json(),
  )
}

export async function patchCloudControls(patch: CloudControlsPatch): Promise<CloudControls> {
  return ControlsSchema.parse(
    await createCloudAdminClient().patch("admin/controls", { json: patch }).json(),
  )
}

export function formatCloudBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function createCloudAdminClient() {
  const baseUrl = assetAdminCloudBaseUrl()
  const adminToken = import.meta.env.VITE_ASSET_CLOUD_ADMIN_TOKEN?.trim() ?? ""
  if (baseUrl === "") throw new Error("云端素材地址尚未配置")
  return ky.create({
    prefix: `${baseUrl}/`,
    headers: adminToken === "" ? {} : { Authorization: `Bearer ${adminToken}` },
    credentials: "include",
    retry: CLOUD_READ_RETRY,
    timeout: 15_000,
  })
}
