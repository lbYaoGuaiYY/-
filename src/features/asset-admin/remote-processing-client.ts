import ky, { HTTPError } from "ky"
import { z } from "zod"

const NodeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  platform: z.enum(["macos", "windows", "linux"]),
  status: z.enum(["online", "offline"]),
  client_id: z.string().uuid().nullable().default(null),
  last_seen: z.string().datetime({ offset: true }),
  created_at: z.string().datetime({ offset: true }),
})
const TaskSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  category: z.string(),
  needs_review: z.union([z.boolean(), z.number()]).transform(Boolean),
  status: z.enum(["pending", "processing", "ready"]),
  node_id: z.string().uuid().nullable(),
  asset_id: z.string().uuid().nullable(),
  error: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
})
const PendingReviewAssetSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  category: z.string(),
  status: z.string(),
  mime_type: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  version: z.number().int(),
  needs_review: z.union([z.boolean(), z.number()]).transform(Boolean),
  favorite: z.union([z.boolean(), z.number()]).transform(Boolean),
  dominant_color: z.string().nullable(),
  tags: z.array(z.string()),
  usage_count: z.number().int().nonnegative(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
})
const ExtensionDeviceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  platform: z.string(),
  status: z.enum(["online", "offline"]),
  last_seen: z.string().datetime({ offset: true }),
  created_at: z.string().datetime({ offset: true }),
})
const AutomationItemSchema = z.object({
  id: z.string().uuid(),
  ordinal: z.number().int().positive(),
  status: z.enum([
    "queued",
    "generating",
    "uploading",
    "processing",
    "ready",
    "failed",
    "cancelled",
  ]),
  attempts: z.number().int().nonnegative(),
  error: z.string().nullable(),
  task_id: z.string().uuid().nullable(),
  asset_id: z.string().uuid().nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
})
const AutomationRunSchema = z.object({
  id: z.string().uuid(),
  device_id: z.string().uuid(),
  provider: z.enum(["chatgpt", "gemini"]),
  prompt: z.string(),
  count: z.number().int().positive(),
  category: z.string().nullable(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  error: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  total: z.number().int().nonnegative(),
  ready: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  items: z.array(AutomationItemSchema),
})
const DashboardSchema = z.object({
  nodes: z.array(NodeSchema),
  tasks: z.array(TaskSchema),
  pending_review_assets: z.array(PendingReviewAssetSchema).default([]),
  extension_devices: z.array(ExtensionDeviceSchema).default([]),
  automation_runs: z.array(AutomationRunSchema).default([]),
})
const CLOUD_READ_RETRY = {
  limit: 2,
  methods: ["get"],
  statusCodes: [408, 425, 429, 500, 502, 503, 504],
}

export type RemoteProcessingDashboard = z.infer<typeof DashboardSchema>
export type RemoteProcessingTask = RemoteProcessingDashboard["tasks"][number]
export type RemotePendingReviewAsset = RemoteProcessingDashboard["pending_review_assets"][number]
export type RemoteProcessingNode = RemoteProcessingDashboard["nodes"][number]

const PROCESSOR_CLIENT_STORAGE_KEY = "qingshe.processor.panel-client.v1"

export function ensureProcessorPanelClientId(storage: Storage = window.localStorage): string {
  const saved = storage.getItem(PROCESSOR_CLIENT_STORAGE_KEY)
  if (saved !== null && z.string().uuid().safeParse(saved).success) return saved
  const clientId = crypto.randomUUID()
  storage.setItem(PROCESSOR_CLIENT_STORAGE_KEY, clientId)
  return clientId
}

export function buildProcessorLaunchUrl(clientId: string): string {
  const validated = z.string().uuid().parse(clientId)
  return `qingshe-processor://open?client_id=${encodeURIComponent(validated)}`
}

export function selectLocalProcessingNode(
  nodes: RemoteProcessingDashboard["nodes"],
  clientId: string,
): RemoteProcessingNode | undefined {
  return nodes.find((node) => node.client_id === clientId)
}

export function processingNodePlatformLabel(platform: RemoteProcessingNode["platform"]): string {
  if (platform === "macos") return "macOS"
  if (platform === "windows") return "Windows"
  return "Linux"
}

export function selectPreferredProcessingNode(
  nodes: RemoteProcessingDashboard["nodes"],
): RemoteProcessingDashboard["nodes"][number] | undefined {
  return nodes.reduce<RemoteProcessingDashboard["nodes"][number] | undefined>((preferred, node) => {
    if (preferred === undefined) return node
    if (node.status !== preferred.status) return node.status === "online" ? node : preferred
    return Date.parse(node.last_seen) > Date.parse(preferred.last_seen) ? node : preferred
  }, undefined)
}

const PublishResponseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  duplicate: z.boolean(),
})

export type PublishedProcessedAsset = z.infer<typeof PublishResponseSchema>

export function parseRemoteProcessingDashboard(value: unknown): RemoteProcessingDashboard {
  return DashboardSchema.parse(value)
}

function cloudBaseUrl(): string {
  return import.meta.env.VITE_ASSET_CLOUD_URL?.trim().replace(/\/+$/, "") ?? ""
}

function client() {
  const baseUrl = cloudBaseUrl()
  if (baseUrl === "") throw new Error("云端素材地址尚未配置")
  return ky.create({
    prefix: `${baseUrl}/`,
    credentials: "include",
    timeout: 60_000,
    retry: CLOUD_READ_RETRY,
  })
}

export async function loginRemoteAssetAdmin(username: string, password: string): Promise<void> {
  const baseUrl = cloudBaseUrl()
  if (baseUrl === "") throw new Error("云端素材地址尚未配置")
  await ky.post(`${baseUrl}/auth/login`, {
    json: { username, password },
    credentials: "include",
    retry: 0,
  })
}

export async function logoutRemoteAssetAdmin(): Promise<void> {
  const baseUrl = cloudBaseUrl()
  if (baseUrl === "") throw new Error("云端素材地址尚未配置")
  await ky.post(`${baseUrl}/auth/logout`, {
    credentials: "include",
    retry: 0,
  })
}

export function isRemoteAdminAuthError(error: unknown): boolean {
  return (
    error instanceof HTTPError && (error.response.status === 401 || error.response.status === 403)
  )
}

export async function readRemoteProcessingDashboard(): Promise<RemoteProcessingDashboard> {
  return parseRemoteProcessingDashboard(await client().get("admin/processing-dashboard").json())
}

export async function approveRemoteAsset(assetId: string, category: string): Promise<void> {
  await client().patch(`admin/assets/${encodeURIComponent(assetId)}`, {
    json: { category, needs_review: false },
  })
}

export async function pairRemoteExtensionDevice(
  name: string,
  platform: "chrome" | "firefox",
): Promise<{ readonly id: string; readonly token: string }> {
  return z
    .object({ id: z.string().uuid(), token: z.string().min(16) })
    .parse(await client().post("admin/extension-devices/pair", { json: { name, platform } }).json())
}

export function extensionPairingRequested(search: string): boolean {
  return new URLSearchParams(search).get("extension_pair") === "1"
}

export function buildExtensionPairingMessage(connection: {
  readonly id: string
  readonly token: string
}): {
  readonly source: "qingshe-panel"
  readonly type: "qingshe-extension-pair"
  readonly connection: {
    readonly baseUrl: string
    readonly token: string
    readonly deviceId: string
  }
} {
  return {
    source: "qingshe-panel",
    type: "qingshe-extension-pair",
    connection: { baseUrl: cloudBaseUrl(), token: connection.token, deviceId: connection.id },
  }
}

export async function createRemoteProcessingTask(
  file: File,
  category: string | null,
): Promise<{ readonly id: string }> {
  const body = new FormData()
  body.set("metadata", JSON.stringify(buildProcessingTaskMetadata(file.name, category)))
  body.set("original", file)
  return z
    .object({ id: z.string().uuid() })
    .parse(await client().post("admin/processing-tasks", { body }).json())
}

export async function createProcessedAsset(
  file: File,
  category: string | null,
): Promise<PublishedProcessedAsset> {
  if (file.type !== "image/png") {
    throw new Error("已抠图成品请使用透明 PNG 格式")
  }
  const preview = await createPreview(file)
  const body = new FormData()
  body.set(
    "metadata",
    JSON.stringify({
      ...buildProcessingTaskMetadata(file.name, category),
      width: preview.width,
      height: preview.height,
    }),
  )
  body.set("processed", file)
  body.set("thumbnail", new File([preview.thumbnail], "thumbnail.webp", { type: "image/webp" }))
  return PublishResponseSchema.parse(
    await client().post("admin/assets/publish-processed", { body }).json(),
  )
}

export function buildProcessingTaskMetadata(
  filename: string,
  category: string | null,
): { readonly name: string; readonly category?: string; readonly needs_review: false } {
  const name = filename.replace(/\.[^.]+$/, "") || filename
  return category === null || category === ""
    ? { name, needs_review: false }
    : { name, category, needs_review: false }
}

export function processingAgentDownloadUrl(
  configuredBaseUrl = import.meta.env.VITE_ASSET_CLOUD_URL,
): string {
  const baseUrl = configuredBaseUrl?.trim().replace(/\/+$/, "") ?? ""
  if (baseUrl === "") return "#"
  return new URL("../../downloads/qingshe-processor", `${baseUrl}/`).toString()
}

async function createPreview(
  file: File,
): Promise<{ width: number; height: number; thumbnail: Blob }> {
  const image = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 480 / image.width, 360 / image.height)
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext("2d")
    if (context === null) throw new Error("浏览器无法创建缩略图")
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const thumbnail = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result === null) reject(new Error("浏览器无法生成 WebP 缩略图"))
          else resolve(result)
        },
        "image/webp",
        0.82,
      )
    })
    return { width: image.width, height: image.height, thumbnail }
  } finally {
    image.close()
  }
}
