import { z } from "zod"

import { createAssetClientHeaders, getAssetClientIdentity } from "./asset-client-identity"
import { ASSET_SERVICE_CONFIG } from "./asset-service-config"
import type { AssetCategory } from "./demo-assets"

export const SUBMISSION_MAX_BYTES = 25 * 1024 * 1024
export const SUBMISSION_ACCEPTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const
export const SUBMISSION_UPLOAD_CAPABILITY_TIMEOUT_MS = 8_000
export const SUBMISSION_UPLOAD_TIMEOUT_MS = 30_000
export const SUBMISSION_STATUS_TIMEOUT_MS = 8_000

/** Backend protocol values: cutout runs smart processing; review preserves the original. */
export type SubmissionMode = "cutout" | "review"
export type SubmissionStatus = "queued" | "processing" | "pending_review" | "approved" | "failed"

export type SubmissionMetadata = {
  readonly name: string
  readonly category?: AssetCategory
  readonly mode: SubmissionMode
  readonly idempotency_key: string
}

export type SubmissionProgress = {
  readonly loaded: number
  readonly total: number
  readonly percent: number
}

export type SubmissionReceipt = {
  readonly submission_id: string
  readonly status: SubmissionStatus
  readonly status_token?: string | undefined
  readonly error?: string | null | undefined
  readonly asset_id?: string | null | undefined
}

export type SubmissionStatusResponse = {
  readonly submission_id: string
  readonly status: SubmissionStatus
  readonly status_token?: string | undefined
  readonly error?: string | null | undefined
  readonly asset_id?: string | null | undefined
}

const SubmissionReceiptSchema = z.object({
  submission_id: z.string().min(1),
  status: z.enum(["queued", "processing", "pending_review", "approved", "failed"]),
  status_token: z.string().min(1).optional(),
  error: z.string().nullable().optional(),
  asset_id: z.string().nullable().optional(),
})

const SubmissionStatusSchema = z.object({
  submission_id: z.string().min(1).optional(),
  status: z.enum(["queued", "processing", "pending_review", "approved", "failed"]),
  status_token: z.string().min(1).optional(),
  error: z.string().nullable().optional(),
  asset_id: z.string().nullable().optional(),
})

const SubmissionSessionSchema = z.object({
  upload_token: z.string().min(1),
  expires_at: z.number().int().positive(),
})

type UploadCapability = z.infer<typeof SubmissionSessionSchema>

export type SubmissionRequestOptions = {
  readonly signal?: AbortSignal
}

let cachedUploadCapability: UploadCapability | null = null
let uploadCapabilityRequest: Promise<UploadCapability> | null = null
let uploadCapabilityController: AbortController | null = null
let uploadCapabilityWaiters = 0
const SUBMISSION_UPLOAD_CAPABILITY_REFRESH_MS = 30_000

function submissionSessionUrl(): string {
  return `${ASSET_SERVICE_CONFIG.baseUrl}/submission-sessions`
}

async function getUploadCapability(
  options: SubmissionRequestOptions = {},
): Promise<UploadCapability> {
  if (options.signal?.aborted) throw new Error("素材投稿已取消")
  const now = Date.now()
  if (
    cachedUploadCapability !== null &&
    cachedUploadCapability.expires_at * 1000 - now > SUBMISSION_UPLOAD_CAPABILITY_REFRESH_MS
  ) {
    return cachedUploadCapability
  }
  if (uploadCapabilityRequest !== null && uploadCapabilityController?.signal.aborted) {
    uploadCapabilityRequest = null
    uploadCapabilityController = null
  }
  if (uploadCapabilityRequest !== null) {
    return await waitForUploadCapability(uploadCapabilityRequest, options.signal)
  }

  const identity = getAssetClientIdentity()
  const controller = new AbortController()
  let timedOut = false
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error("素材投稿凭证请求超时"))
    }, SUBMISSION_UPLOAD_CAPABILITY_TIMEOUT_MS)
  })

  const request = (async (): Promise<UploadCapability> => {
    let response: Response
    try {
      const fetchRequest = fetch(submissionSessionUrl(), {
        method: "POST",
        headers: {
          ...createAssetClientHeaders(identity),
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: controller.signal,
      })
      response = await Promise.race([fetchRequest, timeoutPromise])
    } catch {
      if (timedOut) throw new Error("素材投稿凭证请求超时")
      throw new Error("素材投稿网络连接失败")
    }

    let body: string
    try {
      body = await Promise.race([response.text(), timeoutPromise])
    } catch {
      if (timedOut) throw new Error("素材投稿凭证请求超时")
      throw new Error("素材投稿网络连接失败")
    }
    if (!response.ok) throw responseError(response.status, body)
    let payload: unknown
    try {
      payload = JSON.parse(body)
    } catch {
      throw new Error("素材投稿凭证响应格式无效")
    }
    const parsed = SubmissionSessionSchema.safeParse(payload)
    if (!parsed.success) throw new Error("素材投稿凭证响应格式无效")
    cachedUploadCapability = parsed.data
    return parsed.data
  })()

  let sharedRequest: Promise<UploadCapability>
  sharedRequest = request.finally(() => {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
    if (uploadCapabilityRequest === sharedRequest) uploadCapabilityRequest = null
    if (uploadCapabilityController === controller) uploadCapabilityController = null
  })
  uploadCapabilityRequest = sharedRequest
  uploadCapabilityController = controller
  return await waitForUploadCapability(sharedRequest, options.signal)
}

function submissionUrl(submissionId?: string): string {
  return submissionId === undefined
    ? `${ASSET_SERVICE_CONFIG.baseUrl}/submissions`
    : `${ASSET_SERVICE_CONFIG.baseUrl}/submissions/${encodeURIComponent(submissionId)}`
}

function responseError(status: number, body: string): Error {
  let detail = ""
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; message?: unknown }
    const value = parsed.detail ?? parsed.message
    if (typeof value === "string") detail = `: ${value}`
  } catch {
    // The server may return a plain-text error. Keep the stable HTTP message.
  }
  return new Error(`素材投稿请求失败（HTTP ${status}）${detail}`)
}

async function waitForUploadCapability(
  request: Promise<UploadCapability>,
  signal: AbortSignal | undefined,
): Promise<UploadCapability> {
  uploadCapabilityWaiters += 1
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    uploadCapabilityWaiters -= 1
    if (uploadCapabilityWaiters === 0 && uploadCapabilityRequest === request) {
      uploadCapabilityController?.abort()
    }
  }
  if (signal?.aborted) {
    release()
    throw new Error("素材投稿已取消")
  }

  return await new Promise<UploadCapability>((resolve, reject) => {
    const abortHandler = (): void => {
      release()
      reject(new Error("素材投稿已取消"))
    }
    signal?.addEventListener("abort", abortHandler, { once: true })
    request.then(
      (capability) => {
        signal?.removeEventListener("abort", abortHandler)
        release()
        resolve(capability)
      },
      (error: unknown) => {
        signal?.removeEventListener("abort", abortHandler)
        release()
        reject(error)
      },
    )
  })
}

export async function createSubmission(
  original: File,
  metadata: Omit<SubmissionMetadata, "idempotency_key"> & { readonly idempotency_key?: string },
  onProgress?: (progress: SubmissionProgress) => void,
  options: SubmissionRequestOptions = {},
): Promise<SubmissionReceipt> {
  const capability = await getUploadCapability(options)
  const identity = getAssetClientIdentity()

  const idempotencyKey = metadata.idempotency_key ?? createIdempotencyKey()
  const form = new FormData()
  form.append("original", original, original.name)
  // Keep metadata a regular multipart field: the API validates this JSON string
  // with its form parser while `original` remains the only file part.
  form.append(
    "metadata",
    JSON.stringify({
      name: metadata.name,
      ...(metadata.category === undefined ? {} : { category: metadata.category }),
      mode: metadata.mode,
      idempotency_key: idempotencyKey,
    }),
  )

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open("POST", submissionUrl())
    request.timeout = SUBMISSION_UPLOAD_TIMEOUT_MS
    request.setRequestHeader("Authorization", `Bearer ${capability.upload_token}`)
    for (const [header, value] of Object.entries(createAssetClientHeaders(identity))) {
      request.setRequestHeader(header, value)
    }
    request.responseType = "json"
    let settled = false
    const abortFromCaller = (): void => {
      try {
        request.abort()
      } catch {
        // A browser may already have transitioned the request to DONE.
      }
      rejectOnce(new Error("素材投稿已取消"))
    }
    const cleanupCallerSignal = (): void => {
      options.signal?.removeEventListener("abort", abortFromCaller)
    }
    const resolveOnce = (receipt: SubmissionReceipt): void => {
      if (settled) return
      settled = true
      cleanupCallerSignal()
      resolve(receipt)
    }
    const rejectOnce = (error: Error): void => {
      if (settled) return
      settled = true
      cleanupCallerSignal()
      reject(error)
    }
    request.upload.addEventListener("progress", (event) => {
      const total = event.lengthComputable ? event.total : original.size
      const loaded = Math.min(event.loaded, total)
      onProgress?.({
        loaded,
        total,
        percent: total === 0 ? 0 : Math.round((loaded / total) * 100),
      })
    })
    request.addEventListener("error", () => rejectOnce(new Error("素材投稿网络连接失败")))
    request.addEventListener("abort", () => rejectOnce(new Error("素材投稿已取消")))
    request.addEventListener("timeout", () => {
      rejectOnce(new Error("素材投稿请求超时"))
      try {
        request.abort()
      } catch {
        // A browser may already have transitioned the request to DONE.
      }
    })
    request.addEventListener("load", () => {
      let payload: unknown = request.response
      if (payload === null || payload === undefined) {
        try {
          payload = JSON.parse(request.responseText)
        } catch {
          payload = request.responseText
        }
      }
      if (request.status < 200 || request.status >= 300) {
        rejectOnce(responseError(request.status, typeof payload === "string" ? payload : ""))
        return
      }
      const parsed = SubmissionReceiptSchema.safeParse(payload)
      if (!parsed.success) {
        rejectOnce(new Error("素材投稿响应格式无效，服务器未返回可追踪的投稿凭据"))
        return
      }
      resolveOnce(parsed.data)
    })
    if (options.signal !== undefined) {
      if (options.signal.aborted) {
        rejectOnce(new Error("素材投稿已取消"))
        return
      }
      options.signal.addEventListener("abort", abortFromCaller, { once: true })
    }
    request.send(form)
  })
}

export async function getSubmissionStatus(
  submissionId: string,
  statusToken: string,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<SubmissionStatusResponse> {
  const controller = new AbortController()
  let timedOut = false
  const timeoutMs = options.timeoutMs ?? SUBMISSION_STATUS_TIMEOUT_MS
  const abortFromCaller = (): void => controller.abort()
  if (options.signal !== undefined) {
    if (options.signal.aborted) controller.abort()
    else options.signal.addEventListener("abort", abortFromCaller, { once: true })
  }
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error("素材投稿状态请求超时"))
    }, timeoutMs)
  })
  try {
    const response = await Promise.race([
      fetch(submissionUrl(submissionId), {
        headers: { Authorization: `Bearer ${statusToken}` },
        signal: controller.signal,
      }),
      timeoutPromise,
    ])
    const payload = await Promise.race([response.text(), timeoutPromise])
    if (!response.ok) throw responseError(response.status, payload)
    let json: unknown
    try {
      json = JSON.parse(payload)
    } catch {
      throw new Error("素材投稿状态响应格式无效")
    }
    const parsed = SubmissionStatusSchema.parse(json)
    return { ...parsed, submission_id: parsed.submission_id ?? submissionId }
  } catch (error) {
    if (timedOut) throw new Error("素材投稿状态请求超时")
    throw error
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
    if (options.signal !== undefined) {
      options.signal.removeEventListener("abort", abortFromCaller)
    }
  }
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID()
  return `qingshe-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
