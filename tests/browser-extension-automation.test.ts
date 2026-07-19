import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"
import popupHtml from "../browser-extension/popup.html?raw"
import popupSource from "../browser-extension/popup.js?raw"
import previewHtml from "../browser-extension/preview.html?raw"
import previewRuntimeSource from "../browser-extension/preview-runtime.js?raw"
import automationStateSource from "../browser-extension/src/automation-state.js?raw"
import contentScriptSource from "../browser-extension/src/content-script.js?raw"
import providerAdaptersSource from "../browser-extension/src/provider-adapters.js?raw"
import serverClientSource from "../browser-extension/src/server-client.js?raw"
import serviceWorkerSource from "../browser-extension/src/service-worker.js?raw"

const popupCss = readFileSync(resolve("browser-extension/popup.css"), "utf8")

function loadClassicApi<T>(source: string, name: string): T {
  const target: Record<string, unknown> = {}
  new Function("globalThis", source)(target)
  return target[name] as T
}

describe("browser extension automation", () => {
  afterEach(() => {
    document.body.replaceChildren()
    delete (globalThis as Record<string, unknown>)["QingsheProviderAdapters"]
    delete (globalThis as Record<string, unknown>)["QingsheAutomationState"]
    delete (globalThis as Record<string, unknown>)["QingsheServerClient"]
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  it("advances to the next item after an image upload", () => {
    const { nextAutomationState } = loadClassicApi<{
      nextAutomationState: (
        state: Record<string, unknown>,
        event: Record<string, unknown>,
      ) => Record<string, unknown>
    }>(automationStateSource, "QingsheAutomationState")
    const state = {
      status: "running",
      currentOrdinal: 1,
      items: [
        { id: "item-1", ordinal: 1, status: "uploading" },
        { id: "item-2", ordinal: 2, status: "queued" },
      ],
    }

    const next = nextAutomationState(state, { type: "IMAGE_UPLOADED", itemId: "item-1" })

    expect(next).toMatchObject({ status: "running", currentOrdinal: 2 })
    expect(next["items"]).toMatchObject([
      { id: "item-1", ordinal: 1, status: "processing" },
      { id: "item-2", ordinal: 2, status: "queued" },
    ])
  })

  it("uses a scoped bearer token for extension run requests", async () => {
    const { createServerClient } = loadClassicApi<{
      createServerClient: (options: Record<string, unknown>) => {
        createRun: (value: Record<string, unknown>) => Promise<unknown>
      }
    }>(serverClientSource, "QingsheServerClient")
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "run-1", items: [] }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    )
    const client = createServerClient({
      baseUrl: "https://assets.xiduoduo.top/api/v1/",
      token: "extension-token",
      fetchImpl,
    })

    await client.createRun({ provider: "chatgpt", prompt: "婚庆素材", count: 10 })

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://assets.xiduoduo.top/api/v1/extension-runs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer extension-token" }),
      }),
    )
  })

  it("preserves the server status on scoped request errors", async () => {
    const { createServerClient } = loadClassicApi<{
      createServerClient: (options: Record<string, unknown>) => {
        heartbeat: () => Promise<unknown>
      }
    }>(serverClientSource, "QingsheServerClient")
    const client = createServerClient({
      baseUrl: "https://assets.xiduoduo.top/api/v1",
      token: "expired-extension-token",
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "插件凭据已失效" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    })

    await expect(client.heartbeat()).rejects.toMatchObject({
      message: "插件凭据已失效",
      status: 401,
    })
  })

  it("marks an expired pairing as disconnected instead of showing a false online state", async () => {
    new Function(automationStateSource)()
    new Function(serverClientSource)()
    const storageState: Record<string, unknown> = {
      qingsheExtensionConnection: {
        baseUrl: "https://assets.xiduoduo.top/api/v1",
        token: "expired-extension-token",
        deviceId: "device-expired",
      },
      qingsheAutomationState: null,
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "插件凭据已失效" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    )
    let onMessage:
      | ((
          message: Record<string, unknown>,
          sender: Record<string, unknown>,
          sendResponse: (value: Record<string, unknown>) => void,
        ) => boolean)
      | null = null
    const set = vi.fn().mockImplementation(async (value: Record<string, unknown>) => {
      Object.assign(storageState, value)
    })
    const chromeApi = {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: {
          addListener(value: typeof onMessage) {
            onMessage = value
          },
        },
      },
      storage: {
        local: {
          get: vi.fn().mockImplementation(async (key: string) => ({ [key]: storageState[key] })),
          set,
        },
      },
      tabs: { onRemoved: { addListener: vi.fn() } },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
      action: { setBadgeText: vi.fn() },
      downloads: { download: vi.fn() },
    }
    new Function("chrome", serviceWorkerSource)(chromeApi)

    const result = await new Promise<Record<string, unknown>>((resolve) => {
      onMessage?.({ type: "QINGSHE_AUTOMATION_STATUS" }, {}, resolve)
    })

    expect(result).toMatchObject({
      ok: true,
      paired: false,
      connectionStatus: "unpaired",
    })
    expect(set).toHaveBeenCalledWith({ qingsheExtensionConnection: null })
  })

  it("cancels an automation run through the scoped server client", async () => {
    const { createServerClient } = loadClassicApi<{
      createServerClient: (options: Record<string, unknown>) => {
        cancelRun: (runId: string) => Promise<unknown>
      }
    }>(serverClientSource, "QingsheServerClient")
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "run-1", status: "cancelled", items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    await createServerClient({
      baseUrl: "https://assets.xiduoduo.top/api/v1",
      token: "extension-token",
      fetchImpl,
    }).cancelRun("run-1")

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://assets.xiduoduo.top/api/v1/extension-runs/run-1/cancel",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("requeues a failed item for an explicit retry", () => {
    const { nextAutomationState } = loadClassicApi<{
      nextAutomationState: (
        state: Record<string, unknown>,
        event: Record<string, unknown>,
      ) => Record<string, unknown>
    }>(automationStateSource, "QingsheAutomationState")

    const retried = nextAutomationState(
      {
        status: "failed",
        error: "生成超时",
        currentOrdinal: 1,
        items: [{ id: "item-1", ordinal: 1, status: "failed", error: "生成超时" }],
      },
      { type: "ITEM_RETRY", itemId: "item-1" },
    )

    expect(retried).toMatchObject({ status: "running", currentOrdinal: 1, error: null })
    expect(retried["items"]).toMatchObject([
      { id: "item-1", ordinal: 1, status: "queued", error: null },
    ])
  })

  it("submits a prompt through the ChatGPT composer", async () => {
    document.body.innerHTML = `
      <div id="prompt-textarea" contenteditable="true"></div>
      <button type="button" data-testid="send-button">Send</button>
    `
    const send = document.querySelector<HTMLButtonElement>("[data-testid='send-button']")
    const clicked = vi.fn()
    send?.addEventListener("click", clicked)
    const { providerForUrl, submitPrompt } = loadClassicApi<{
      providerForUrl: (url: string) => { id: string }
      submitPrompt: (provider: { id: string }, prompt: string) => Promise<void>
    }>(providerAdaptersSource, "QingsheProviderAdapters")
    const provider = providerForUrl("https://chatgpt.com/")

    await submitPrompt(provider, "婚庆素材，请生成 1 张")

    expect(provider.id).toBe("chatgpt")
    expect(document.querySelector("#prompt-textarea")?.textContent).toContain("婚庆素材")
    expect(clicked).toHaveBeenCalledOnce()
  })

  it("submits a prompt through the Gemini composer", async () => {
    document.body.innerHTML = `
      <div class="ql-editor" role="textbox" contenteditable="true"></div>
      <button type="button" aria-label="发送消息">Send</button>
    `
    const clicked = vi.fn()
    document.querySelector("button")?.addEventListener("click", clicked)
    const { providerForUrl, submitPrompt } = loadClassicApi<{
      providerForUrl: (url: string) => { id: string }
      submitPrompt: (provider: { id: string }, prompt: string) => Promise<void>
    }>(providerAdaptersSource, "QingsheProviderAdapters")
    const provider = providerForUrl("https://gemini.google.com/app")

    await submitPrompt(provider, "婚礼花艺，请生成 1 张")

    expect(provider.id).toBe("gemini")
    expect(document.querySelector(".ql-editor")?.textContent).toContain("婚礼花艺")
    expect(clicked).toHaveBeenCalledOnce()
  })

  it("waits for a new stable generated image and reports it to the background", async () => {
    vi.useFakeTimers()
    new Function(providerAdaptersSource)()
    document.body.innerHTML = `
      <div id="prompt-textarea" contenteditable="true"></div>
      <button type="button" data-testid="send-button">Send</button>
      <img src="https://example.test/existing.png" alt="existing" width="512" height="512" />
    `
    const messages: Array<Record<string, unknown>> = []
    let listener:
      | ((
          message: Record<string, unknown>,
          sender: unknown,
          sendResponse: (value: unknown) => void,
        ) => boolean)
      | null = null
    new Function("chrome", contentScriptSource)({
      runtime: {
        sendMessage: vi.fn().mockImplementation(async (message: Record<string, unknown>) => {
          messages.push(message)
          return { ok: true }
        }),
        onMessage: {
          addListener(value: typeof listener) {
            listener = value
          },
        },
      },
    })
    const contentListener = listener as unknown as (
      message: Record<string, unknown>,
      sender: unknown,
      sendResponse: (value: unknown) => void,
    ) => boolean
    const firstAck = vi.fn()
    const firstKeepsPortOpen = contentListener(
      {
        type: "QINGSHE_AUTOMATION_GENERATE_ITEM",
        provider: "chatgpt",
        runId: "run-1",
        itemId: "item-1",
        prompt: "婚庆素材",
        ordinal: 1,
        total: 10,
      },
      {},
      firstAck,
    )
    const duplicateAck = vi.fn()
    const duplicateKeepsPortOpen = contentListener(
      {
        type: "QINGSHE_AUTOMATION_GENERATE_ITEM",
        provider: "chatgpt",
        runId: "run-1",
        itemId: "item-1",
        prompt: "婚庆素材",
        ordinal: 1,
        total: 10,
      },
      {},
      duplicateAck,
    )
    await Promise.resolve()

    expect(firstKeepsPortOpen).toBe(false)
    expect(firstAck).toHaveBeenCalledWith({ ok: true, started: true, active: true })
    expect(duplicateKeepsPortOpen).toBe(false)
    expect(duplicateAck).toHaveBeenCalledWith({ ok: true, started: false, active: true })
    expect(document.querySelector("button")?.textContent).toBe("Send")

    const generated = document.createElement("img")
    generated.src = "https://images.example.test/generated-wedding.png"
    generated.alt = "Generated wedding material"
    generated.width = 720
    generated.height = 720
    let complete = false
    Object.defineProperties(generated, {
      complete: { get: () => complete },
      naturalWidth: { value: 1024 },
      naturalHeight: { value: 1024 },
    })
    document.body.append(generated)
    await Promise.resolve()
    expect(messages).not.toContainEqual(
      expect.objectContaining({ type: "QINGSHE_AUTOMATION_IMAGE" }),
    )
    complete = true
    generated.dispatchEvent(new Event("load"))
    await vi.advanceTimersByTimeAsync(2_500)

    expect(messages).toContainEqual({
      type: "QINGSHE_AUTOMATION_IMAGE",
      runId: "run-1",
      itemId: "item-1",
      image: expect.objectContaining({
        source: "https://images.example.test/generated-wedding.png",
      }),
    })
  })

  it("reports a running automation item without submitting the prompt again", async () => {
    vi.useFakeTimers()
    new Function(providerAdaptersSource)()
    document.body.innerHTML = `
      <div id="prompt-textarea" contenteditable="true"></div>
      <button type="button" data-testid="send-button">Send</button>
    `
    const click = vi.fn()
    document.querySelector("button")?.addEventListener("click", click)
    let listener:
      | ((
          message: Record<string, unknown>,
          sender: unknown,
          sendResponse: (value: unknown) => void,
        ) => boolean)
      | null = null
    new Function("chrome", contentScriptSource)({
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ ok: true }),
        onMessage: {
          addListener(value: typeof listener) {
            listener = value
          },
        },
      },
    })
    const contentListener = listener as unknown as (
      message: Record<string, unknown>,
      sender: unknown,
      sendResponse: (value: unknown) => void,
    ) => boolean
    contentListener(
      {
        type: "QINGSHE_AUTOMATION_GENERATE_ITEM",
        provider: "chatgpt",
        runId: "run-resume",
        itemId: "item-resume",
        prompt: "花艺素材",
        ordinal: 1,
        total: 2,
      },
      {},
      vi.fn(),
    )
    await vi.advanceTimersByTimeAsync(1)
    const response = vi.fn()

    const keepsPortOpen = contentListener(
      {
        type: "QINGSHE_AUTOMATION_QUERY_ITEM",
        runId: "run-resume",
        itemId: "item-resume",
      },
      {},
      response,
    )

    expect(keepsPortOpen).toBe(false)
    expect(response).toHaveBeenCalledWith({ active: true })
    expect(click).toHaveBeenCalledOnce()
  })

  it("cancels the active page waiter instead of uploading after the run is cancelled", async () => {
    vi.useFakeTimers()
    new Function(providerAdaptersSource)()
    document.body.innerHTML = `
      <div id="prompt-textarea" contenteditable="true"></div>
      <button type="button" data-testid="send-button">Send</button>
    `
    const sendMessage = vi.fn().mockResolvedValue({ ok: true })
    let listener:
      | ((
          message: Record<string, unknown>,
          sender: unknown,
          sendResponse: (value: unknown) => void,
        ) => boolean)
      | null = null
    new Function("chrome", contentScriptSource)({
      runtime: {
        sendMessage,
        onMessage: {
          addListener(value: typeof listener) {
            listener = value
          },
        },
      },
    })
    const contentListener = listener as unknown as (
      message: Record<string, unknown>,
      sender: unknown,
      sendResponse: (value: unknown) => void,
    ) => boolean
    contentListener(
      {
        type: "QINGSHE_AUTOMATION_GENERATE_ITEM",
        provider: "chatgpt",
        runId: "run-cancel",
        itemId: "item-cancel",
        prompt: "花艺素材",
        ordinal: 1,
        total: 1,
      },
      {},
      vi.fn(),
    )
    await vi.advanceTimersByTimeAsync(1)
    const cancelResponse = vi.fn()

    const keepsPortOpen = contentListener(
      {
        type: "QINGSHE_AUTOMATION_CANCEL_ITEM",
        runId: "run-cancel",
        itemId: "item-cancel",
      },
      {},
      cancelResponse,
    )
    await vi.advanceTimersByTimeAsync(1)
    const queryResponse = vi.fn()
    contentListener(
      {
        type: "QINGSHE_AUTOMATION_QUERY_ITEM",
        runId: "run-cancel",
        itemId: "item-cancel",
      },
      {},
      queryResponse,
    )

    expect(keepsPortOpen).toBe(false)
    expect(cancelResponse).toHaveBeenCalledWith({ ok: true, cancelled: true })
    expect(queryResponse).toHaveBeenCalledWith({ active: false })
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "QINGSHE_AUTOMATION_IMAGE" }),
    )
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "QINGSHE_AUTOMATION_ERROR" }),
    )
  })

  it("notifies the provider tab before cancelling the durable server run", async () => {
    new Function(automationStateSource)()
    new Function(serverClientSource)()
    const storageState: Record<string, unknown> = {
      qingsheExtensionConnection: {
        baseUrl: "https://assets.xiduoduo.top/api/v1",
        token: "extension-token",
        deviceId: "device-1",
      },
      qingsheAutomationState: {
        id: "run-cancel",
        tabId: 77,
        status: "running",
        items: [{ id: "item-cancel", ordinal: 1, status: "generating" }],
      },
    }
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, cancelled: true })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "run-cancel",
            status: "cancelled",
            items: [{ id: "item-cancel", ordinal: 1, status: "cancelled" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    )
    let workerListener:
      | ((
          message: Record<string, unknown>,
          sender: unknown,
          sendResponse: (value: Record<string, unknown>) => void,
        ) => boolean)
      | null = null
    new Function("chrome", serviceWorkerSource)({
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: {
          addListener(value: typeof workerListener) {
            workerListener = value
          },
        },
      },
      storage: {
        local: {
          get: vi.fn().mockImplementation(async (key: string) => ({ [key]: storageState[key] })),
          set: vi.fn().mockImplementation(async (value: Record<string, unknown>) => {
            Object.assign(storageState, value)
          }),
        },
      },
      tabs: { sendMessage, onRemoved: { addListener: vi.fn() } },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
      downloads: { download: vi.fn() },
    })
    const response = await new Promise<Record<string, unknown>>((resolve) => {
      workerListener?.({ type: "QINGSHE_AUTOMATION_CANCEL" }, {}, resolve)
    })

    expect(response).toMatchObject({ ok: true })
    expect(sendMessage).toHaveBeenCalledWith(77, {
      type: "QINGSHE_AUTOMATION_CANCEL_ITEM",
      runId: "run-cancel",
      itemId: "item-cancel",
    })
    expect(fetch).toHaveBeenCalledWith(
      "https://assets.xiduoduo.top/api/v1/extension-runs/run-cancel/cancel",
      expect.objectContaining({ method: "POST" }),
    )
    expect(storageState["qingsheAutomationState"]).toMatchObject({
      status: "cancelled",
      cancelPending: false,
    })
  })

  it("keeps an offline cancellation durable and finishes it on the next status refresh", async () => {
    new Function(automationStateSource)()
    new Function(serverClientSource)()
    const storageState: Record<string, unknown> = {
      qingsheExtensionConnection: {
        baseUrl: "https://assets.xiduoduo.top/api/v1",
        token: "extension-token",
        deviceId: "device-1",
      },
      qingsheAutomationState: {
        id: "run-offline-cancel",
        tabId: 88,
        status: "running",
        items: [{ id: "item-offline", ordinal: 1, status: "generating" }],
      },
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "temporarily unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "run-offline-cancel",
            status: "cancelled",
            items: [{ id: "item-offline", ordinal: 1, status: "cancelled" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
    vi.stubGlobal("fetch", fetchMock)
    let workerListener:
      | ((
          message: Record<string, unknown>,
          sender: unknown,
          sendResponse: (value: Record<string, unknown>) => void,
        ) => boolean)
      | null = null
    new Function("chrome", serviceWorkerSource)({
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: {
          addListener(value: typeof workerListener) {
            workerListener = value
          },
        },
      },
      storage: {
        local: {
          get: vi.fn().mockImplementation(async (key: string) => ({ [key]: storageState[key] })),
          set: vi.fn().mockImplementation(async (value: Record<string, unknown>) => {
            Object.assign(storageState, value)
          }),
        },
      },
      tabs: {
        sendMessage: vi.fn().mockResolvedValue({ ok: true, cancelled: true }),
        onRemoved: { addListener: vi.fn() },
      },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
      downloads: { download: vi.fn() },
    })
    const cancelled = await new Promise<Record<string, unknown>>((resolve) => {
      workerListener?.({ type: "QINGSHE_AUTOMATION_CANCEL" }, {}, resolve)
    })

    expect(cancelled).toMatchObject({
      ok: true,
      state: {
        status: "cancelling",
        cancelPending: true,
        error: "已停止生成；服务器恢复后会自动完成取消",
      },
    })

    const refreshed = await new Promise<Record<string, unknown>>((resolve) => {
      workerListener?.({ type: "QINGSHE_AUTOMATION_STATUS" }, {}, resolve)
    })

    expect(refreshed).toMatchObject({
      ok: true,
      connectionStatus: "online",
      state: { status: "cancelled", cancelPending: false, error: null },
    })
  })

  it("creates a server run, opens a new chat, and starts the first item", async () => {
    new Function(automationStateSource)()
    new Function(serverClientSource)()
    const storageState: Record<string, unknown> = {
      qingsheExtensionConnection: {
        baseUrl: "https://assets.xiduoduo.top/api/v1",
        token: "extension-token",
        deviceId: "device-1",
      },
    }
    const run = {
      id: "run-1",
      provider: "chatgpt",
      prompt: "婚庆素材",
      count: 2,
      status: "running",
      items: [
        { id: "item-1", ordinal: 1, status: "queued" },
        { id: "item-2", ordinal: 2, status: "queued" },
      ],
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, options: RequestInit = {}) => {
        if (url.startsWith("data:image/png")) {
          return new Response(new Blob(["generated"], { type: "image/png" }), {
            status: 200,
            headers: { "content-type": "image/png" },
          })
        }
        if (url.endsWith("/extension-runs") && options.method === "POST") {
          return new Response(JSON.stringify(run), {
            status: 201,
            headers: { "content-type": "application/json" },
          })
        }
        if (url.includes("/items/item-1") && options.method === "PATCH") {
          const update = JSON.parse(String(options.body))
          return new Response(JSON.stringify({ ...run.items[0], status: update.status }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        }
        if (url.includes("/items/item-1/upload") && options.method === "POST") {
          return new Response(JSON.stringify({ task_id: "task-1", created: true }), {
            status: 201,
            headers: { "content-type": "application/json" },
          })
        }
        if (url.includes("/items/item-2") && options.method === "PATCH") {
          return new Response(JSON.stringify({ ...run.items[1], status: "generating" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        }
        throw new Error(`Unexpected request: ${url}`)
      }),
    )
    let onMessage:
      | ((
          message: Record<string, unknown>,
          sender: Record<string, unknown>,
          sendResponse: (value: Record<string, unknown>) => void,
        ) => boolean)
      | null = null
    const sendMessage = vi.fn().mockResolvedValue({ ok: true })
    const chromeApi = {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: {
          addListener(value: typeof onMessage) {
            onMessage = value
          },
        },
      },
      storage: {
        local: {
          get: vi
            .fn()
            .mockImplementation(async (key: string) =>
              typeof key === "string" ? { [key]: storageState[key] } : { ...storageState },
            ),
          set: vi.fn().mockImplementation(async (value: Record<string, unknown>) => {
            Object.assign(storageState, value)
          }),
        },
      },
      tabs: {
        create: vi.fn().mockResolvedValue({ id: 77, status: "complete" }),
        get: vi.fn().mockResolvedValue({ id: 77, status: "complete" }),
        sendMessage,
        query: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
        onRemoved: { addListener: vi.fn() },
      },
      windows: { update: vi.fn() },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
      action: { setBadgeText: vi.fn() },
      downloads: { download: vi.fn() },
    }
    new Function("chrome", serviceWorkerSource)(chromeApi)

    const response = await new Promise<Record<string, unknown>>((resolve) => {
      onMessage?.(
        {
          type: "QINGSHE_AUTOMATION_START",
          config: { provider: "chatgpt", prompt: "婚庆素材", count: 2, category: null },
        },
        {},
        resolve,
      )
    })

    expect(response).toMatchObject({ ok: true })
    expect(chromeApi.tabs.create).toHaveBeenCalledWith({
      url: "https://chatgpt.com/",
      active: true,
    })
    expect(sendMessage).toHaveBeenCalledWith(
      77,
      expect.objectContaining({
        type: "QINGSHE_AUTOMATION_GENERATE_ITEM",
        runId: "run-1",
        itemId: "item-1",
        ordinal: 1,
        total: 2,
      }),
    )
    expect(storageState["qingsheAutomationState"]).toMatchObject({
      id: "run-1",
      tabId: 77,
      currentOrdinal: 1,
    })

    const imageResponse = await new Promise<Record<string, unknown>>((resolve) => {
      onMessage?.(
        {
          type: "QINGSHE_AUTOMATION_IMAGE",
          runId: "run-1",
          itemId: "item-1",
          image: {
            source: "data:image/png;base64,YQ==",
            filename: "01-wedding.png",
          },
        },
        { tab: { id: 77 } },
        resolve,
      )
    })

    expect(imageResponse).toMatchObject({ ok: true })
    expect(sendMessage).toHaveBeenCalledWith(
      77,
      expect.objectContaining({
        type: "QINGSHE_AUTOMATION_GENERATE_ITEM",
        itemId: "item-2",
        ordinal: 2,
      }),
    )
    expect(storageState["qingsheAutomationState"]).toMatchObject({
      currentOrdinal: 2,
      items: [
        expect.objectContaining({ id: "item-1", status: "processing" }),
        expect.objectContaining({ id: "item-2", status: "generating" }),
      ],
    })
  })

  it("does not submit a duplicate prompt when a restarted worker finds the item active", async () => {
    new Function(automationStateSource)()
    new Function(serverClientSource)()
    const run = {
      id: "run-resume",
      provider: "chatgpt",
      prompt: "婚礼花艺",
      count: 1,
      status: "running",
      items: [{ id: "item-resume", ordinal: 1, status: "generating" }],
    }
    const storageState: Record<string, unknown> = {
      qingsheExtensionConnection: {
        baseUrl: "https://assets.xiduoduo.top/api/v1",
        token: "extension-token",
        deviceId: "device-resume",
      },
      qingsheAutomationState: { ...run, tabId: 77, currentOrdinal: 1 },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(run), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    )
    let startup: (() => void) | null = null
    const sendMessage = vi
      .fn()
      .mockImplementation(async (_tabId: number, message: { type: string }) => {
        if (message.type === "QINGSHE_AUTOMATION_QUERY_ITEM") return { active: true }
        throw new Error(`Unexpected tab message: ${message.type}`)
      })
    const chromeApi = {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: {
          addListener(listener: () => void) {
            startup = listener
          },
        },
        onMessage: { addListener: vi.fn() },
      },
      storage: {
        local: {
          get: vi.fn().mockImplementation(async (key: string) => ({ [key]: storageState[key] })),
          set: vi.fn().mockImplementation(async (value: Record<string, unknown>) => {
            Object.assign(storageState, value)
          }),
        },
      },
      tabs: {
        get: vi.fn().mockResolvedValue({ id: 77, status: "complete" }),
        create: vi.fn(),
        sendMessage,
        onRemoved: { addListener: vi.fn() },
      },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
      action: { setBadgeText: vi.fn() },
      downloads: { download: vi.fn() },
    }
    new Function("chrome", serviceWorkerSource)(chromeApi)

    ;(startup as unknown as () => void)()

    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(77, {
        type: "QINGSHE_AUTOMATION_QUERY_ITEM",
        runId: "run-resume",
        itemId: "item-resume",
      }),
    )
    expect(sendMessage).not.toHaveBeenCalledWith(
      77,
      expect.objectContaining({ type: "QINGSHE_AUTOMATION_GENERATE_ITEM" }),
    )
  })

  it("accepts a scoped extension token only from the material panel bridge", async () => {
    new Function(automationStateSource)()
    new Function(serverClientSource)()
    let onMessage:
      | ((
          message: Record<string, unknown>,
          sender: Record<string, unknown>,
          sendResponse: (value: Record<string, unknown>) => void,
        ) => boolean)
      | null = null
    const set = vi.fn().mockResolvedValue(undefined)
    const chromeApi = {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: {
          addListener(value: typeof onMessage) {
            onMessage = value
          },
        },
      },
      storage: { local: { get: vi.fn(), set } },
      tabs: {},
      downloads: { download: vi.fn() },
    }
    new Function("chrome", serviceWorkerSource)(chromeApi)

    const response = await new Promise<Record<string, unknown>>((resolve) => {
      onMessage?.(
        {
          type: "QINGSHE_EXTENSION_PAIRED",
          connection: {
            baseUrl: "https://assets.xiduoduo.top/api/v1",
            token: "scoped-extension-token",
            deviceId: "device-1",
          },
        },
        { tab: { url: "https://assets.xiduoduo.top/admin/asset-admin.html?extension_pair=1" } },
        resolve,
      )
    })

    expect(response).toEqual({ ok: true })
    expect(set).toHaveBeenCalledWith({
      qingsheExtensionConnection: {
        baseUrl: "https://assets.xiduoduo.top/api/v1",
        token: "scoped-extension-token",
        deviceId: "device-1",
      },
    })
  })

  it("exposes full-auto provider, prompt, count, category, and progress controls", () => {
    expect(popupHtml).toContain('id="auto-provider"')
    expect(popupHtml).toContain('id="auto-prompt"')
    expect(popupHtml).toContain('id="auto-count"')
    expect(popupHtml).toContain('id="auto-category"')
    expect(popupHtml).toContain('id="auto-start"')
    expect(popupHtml).toContain('id="auto-progress"')
    expect(popupSource).toContain("QINGSHE_AUTOMATION_CANCEL")
    expect(popupSource).toContain("QINGSHE_AUTOMATION_RETRY")
    expect(serviceWorkerSource).toContain("resumeAutomation")
  })

  it("renders the audit preview from the real popup instead of a duplicated mock layout", () => {
    expect(previewHtml).toContain('src="popup.html?preview=1"')
    expect(previewHtml).not.toContain('id="auto-progress"')
    expect(popupHtml).toContain('<script src="preview-runtime.js"></script>')
    expect(() => new Function(previewRuntimeSource)).not.toThrow()
    expect(popupCss).toMatch(/\.auto-panel\[hidden\][\s\S]*display:\s*none/)
  })
})
