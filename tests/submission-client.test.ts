import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createSubmission,
  getSubmissionStatus,
  SUBMISSION_STATUS_TIMEOUT_MS,
  SUBMISSION_UPLOAD_CAPABILITY_TIMEOUT_MS,
} from "../src/features/assets/submission-client"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("submission status client", () => {
  it("aborts a status read at the bounded timeout", async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    )

    const request = getSubmissionStatus("submission-1", "status-token")
    const assertion = expect(request).rejects.toThrow("素材投稿状态请求超时")
    await vi.advanceTimersByTimeAsync(SUBMISSION_STATUS_TIMEOUT_MS)
    await assertion
  })
})

describe("submission upload capability", () => {
  const metadata = { name: "测试素材", mode: "cutout" as const, idempotency_key: "test-key" }
  const file = new File(["image"], "material.png", { type: "image/png" })

  class MockXmlHttpRequest {
    readonly upload = { addEventListener: vi.fn() }
    readonly response = {
      submission_id: "submission-2",
      status: "queued",
      status_token: "status-token-2",
    }
    readonly responseText = ""
    readonly status = 201
    responseType = ""
    timeout = 0
    private readonly listeners = new Map<string, () => void>()

    open = vi.fn()
    setRequestHeader = vi.fn()

    addEventListener(type: string, listener: () => void): void {
      this.listeners.set(type, listener)
    }

    send = vi.fn(() => queueMicrotask(() => this.listeners.get("load")?.()))

    abort = vi.fn(() => this.listeners.get("abort")?.())
  }

  it("fails a capability request at the bounded timeout", async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    )

    const request = createSubmission(file, metadata)
    const assertion = expect(request).rejects.toThrow("素材投稿凭证请求超时")
    await vi.advanceTimersByTimeAsync(SUBMISSION_UPLOAD_CAPABILITY_TIMEOUT_MS)
    await assertion
  })

  it("maps capability network failures to a retryable message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    )

    await expect(createSubmission(file, metadata)).rejects.toThrow("素材投稿网络连接失败")
  })

  it("does not start a capability request when submission is already cancelled", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const controller = new AbortController()
    controller.abort()

    await expect(
      createSubmission(file, metadata, undefined, { signal: controller.signal }),
    ).rejects.toThrow("素材投稿已取消")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("aborts an unshared capability request when its only caller cancels", async () => {
    let receivedSignal: AbortSignal | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        receivedSignal = init?.signal ?? undefined
        return new Promise<Response>((_resolve, reject) => {
          receivedSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          )
        })
      }),
    )
    const controller = new AbortController()
    const request = createSubmission(file, metadata, undefined, { signal: controller.signal })

    controller.abort()

    await expect(request).rejects.toThrow("素材投稿已取消")
    expect(receivedSignal?.aborted).toBe(true)
  })

  it("starts a fresh capability request for a caller arriving immediately after cancellation", async () => {
    let requestCount = 0
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      requestCount += 1
      if (requestCount === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          )
        })
      }
      return Promise.resolve(
        new Response(JSON.stringify({ upload_token: "fresh-token", expires_at: 1 }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("XMLHttpRequest", MockXmlHttpRequest)
    const controller = new AbortController()
    const cancelled = createSubmission(file, metadata, undefined, { signal: controller.signal })

    controller.abort()
    const replacement = createSubmission(file, { ...metadata, idempotency_key: "replacement" })

    await expect(cancelled).rejects.toThrow("素材投稿已取消")
    await expect(replacement).resolves.toMatchObject({ submission_id: "submission-2" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("does not abort a shared capability request when one caller cancels", async () => {
    let resolveCapability!: (response: Response) => void
    const capabilityRequest = new Promise<Response>((resolve) => {
      resolveCapability = resolve
    })
    let receivedSignal: AbortSignal | undefined
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      receivedSignal = init?.signal ?? undefined
      return capabilityRequest
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("XMLHttpRequest", MockXmlHttpRequest)

    const firstController = new AbortController()
    const firstRequest = createSubmission(
      file,
      { ...metadata, idempotency_key: "first-key" },
      undefined,
      { signal: firstController.signal },
    )
    const secondRequest = createSubmission(file, { ...metadata, idempotency_key: "second-key" })
    const firstAssertion = expect(firstRequest).rejects.toThrow("素材投稿已取消")
    firstController.abort()
    await firstAssertion

    resolveCapability(
      new Response(
        JSON.stringify({
          upload_token: "upload-token",
          expires_at: Math.ceil((Date.now() + 60_000) / 1000),
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    )

    await expect(secondRequest).resolves.toMatchObject({
      status: "queued",
      submission_id: "submission-2",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(receivedSignal?.aborted).toBe(false)
  })
})
