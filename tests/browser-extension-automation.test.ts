import { afterEach, describe, expect, it, vi } from "vitest"
import popupHtml from "../browser-extension/popup.html?raw"
import popupSource from "../browser-extension/popup.js?raw"
import automationStateSource from "../browser-extension/src/automation-state.js?raw"
import contentScriptSource from "../browser-extension/src/content-script.js?raw"
import providerAdaptersSource from "../browser-extension/src/provider-adapters.js?raw"
import serverClientSource from "../browser-extension/src/server-client.js?raw"
import serviceWorkerSource from "../browser-extension/src/service-worker.js?raw"

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
    contentListener(
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
      vi.fn(),
    )
    await Promise.resolve()

    const generated = document.createElement("img")
    generated.src = "https://images.example.test/generated-wedding.png"
    generated.alt = "Generated wedding material"
    generated.width = 720
    generated.height = 720
    Object.defineProperties(generated, {
      complete: { value: true },
      naturalWidth: { value: 1024 },
      naturalHeight: { value: 1024 },
    })
    document.body.append(generated)
    await Promise.resolve()
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
})
