import { afterEach, describe, expect, it, vi } from "vitest"
import manifestText from "../browser-extension/manifest.json?raw"
import contentScript from "../browser-extension/src/content-script.js?raw"
import serviceWorker from "../browser-extension/src/service-worker.js?raw"

describe("browser extension scan recovery", () => {
  afterEach(() => {
    document.body.replaceChildren()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("keeps the manifest content script parseable as a classic script", () => {
    expect(() => new Function(contentScript)).not.toThrow()
  })

  it("declares compatible Chrome and Firefox Manifest V3 background entries", () => {
    const manifest = JSON.parse(manifestText)

    expect(manifest.background).toEqual({
      service_worker: "service-worker.js",
      scripts: ["automation-state.js", "server-client.js", "service-worker.js"],
    })
    expect(manifest.browser_specific_settings.gecko).toEqual({
      id: "qingshe-images@xiduoduo.top",
      strict_min_version: "121.0",
    })
    expect(manifest.permissions).toContain("alarms")
  })

  it("returns the Gemini generated blob image instead of the sparkle logo", async () => {
    const sparkle = document.createElement("img")
    sparkle.src = "https://www.gstatic.com/lamda/images/gemini_sparkle.svg"
    sparkle.className = "sparkle-image"
    sparkle.width = 150
    sparkle.height = 150
    Object.defineProperties(sparkle, {
      naturalWidth: { value: 150 },
      naturalHeight: { value: 150 },
    })

    const generated = document.createElement("img")
    generated.src = "blob:https://gemini.google.com/generated-image"
    generated.alt = "，AI 生成"
    generated.width = 708
    generated.height = 386
    Object.defineProperties(generated, {
      naturalWidth: { value: 1024 },
      naturalHeight: { value: 559 },
    })
    document.body.append(sparkle, generated)

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Blob(["generated image bytes"], { type: "image/png" }), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      ),
    )

    type ScanResponse = { images: Array<{ alt: string; source: string }> }
    let onMessage:
      | ((
          message: { type: string },
          sender: unknown,
          sendResponse: (value: ScanResponse) => void,
        ) => boolean)
      | null = null
    const chromeApi = {
      runtime: {
        onMessage: {
          addListener(listener: typeof onMessage) {
            onMessage = listener
          },
        },
      },
    }
    new Function("chrome", contentScript)(chromeApi)

    let keepsMessagePortOpen = false
    const response = await new Promise<ScanResponse>((resolve) => {
      keepsMessagePortOpen = onMessage?.({ type: "QINGSHE_SCAN" }, {}, resolve) ?? false
    })

    expect(keepsMessagePortOpen).toBe(true)
    expect(response.images).toHaveLength(1)
    expect(response.images[0]?.alt).toBe("，AI 生成")
    expect(response.images[0]?.source).toMatch(/^data:image\/png;base64,/)
  })

  it("uses the loaded Gemini image pixels after its blob URL has expired", async () => {
    const generated = document.createElement("img")
    generated.src = "blob:https://gemini.google.com/expired-generated-image"
    generated.alt = "，AI 生成"
    generated.width = 708
    generated.height = 386
    Object.defineProperties(generated, {
      naturalWidth: { value: 1024 },
      naturalHeight: { value: 559 },
    })
    document.body.append(generated)

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Blob URL revoked")))
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => ({ drawImage }) as unknown as CanvasRenderingContext2D,
    )
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,rendered-image",
    )

    type ScanResponse = { images: Array<{ source: string }> }
    let onMessage:
      | ((
          message: { type: string },
          sender: unknown,
          sendResponse: (value: ScanResponse) => void,
        ) => boolean)
      | null = null
    new Function("chrome", contentScript)({
      runtime: {
        onMessage: {
          addListener(listener: typeof onMessage) {
            onMessage = listener
          },
        },
      },
    })

    const response = await new Promise<ScanResponse>((resolve) => {
      onMessage?.({ type: "QINGSHE_SCAN" }, {}, resolve)
    })

    expect(response.images).toHaveLength(1)
    expect(response.images[0]?.source).toBe("data:image/png;base64,rendered-image")
    expect(drawImage).toHaveBeenCalledWith(generated, 0, 0, 1024, 559)
  })

  it("reports newly generated images without opening the popup", async () => {
    vi.useFakeTimers()
    const sendMessage = vi.fn().mockResolvedValue({ ok: true })
    new Function("chrome", contentScript)({
      runtime: {
        sendMessage,
        onMessage: { addListener: vi.fn() },
      },
    })
    const generated = document.createElement("img")
    generated.src = "https://images.example.test/wedding-generated.png"
    generated.alt = "婚礼花艺生成图"
    generated.width = 720
    generated.height = 720
    Object.defineProperties(generated, {
      complete: { value: true },
      naturalWidth: { value: 1024 },
      naturalHeight: { value: 1024 },
    })

    document.body.append(generated)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(350)

    expect(sendMessage).toHaveBeenCalledWith({
      type: "QINGSHE_IMAGES_DISCOVERED",
      url: window.location.href,
      title: document.title,
      images: [
        expect.objectContaining({
          source: "https://images.example.test/wedding-generated.png",
          alt: "婚礼花艺生成图",
        }),
      ],
    })
  })

  it("injects the content script once when the active tab was opened before the extension", async () => {
    const sendCalls: string[] = []
    const injectedTabs: number[] = []
    const chromeApi = {
      tabs: {
        sendMessage: async (_tabId: number, message: { type: string }) => {
          sendCalls.push(message.type)
          if (sendCalls.length === 1) throw new Error("Receiving end does not exist")
          return { images: [{ id: "image-1" }] }
        },
      },
      scripting: {
        executeScript: async ({
          target,
          files,
        }: {
          target: { tabId: number }
          files: string[]
        }) => {
          injectedTabs.push(target.tabId)
          expect(files).toEqual(["provider-adapters.js", "content-script.js"])
        },
      },
    }

    const { scanTab } = await import("../browser-extension/src/scan-active-tab.js")
    const result = await scanTab(42, chromeApi)

    expect(result.images).toHaveLength(1)
    expect(sendCalls).toEqual(["QINGSHE_SCAN", "QINGSHE_SCAN"])
    expect(injectedTabs).toEqual([42])
  })

  it("retries once when a freshly loaded page has not exposed its generated image yet", async () => {
    const scanResults = [{ images: [] }, { images: [{ id: "generated-image" }] }]
    const chromeApi = {
      tabs: {
        sendMessage: vi.fn().mockImplementation(async () => scanResults.shift()),
      },
    }
    const sleep = vi.fn().mockResolvedValue(undefined)
    const { scanTabWithRetry } = await import("../browser-extension/src/scan-active-tab.js")

    const result = await scanTabWithRetry(42, chromeApi, { retryDelay: 400, sleep })

    expect(result.images).toEqual([{ id: "generated-image" }])
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(400)
  })

  it("stores continuous discoveries and updates the extension badge", async () => {
    type WorkerResponse = { ok: boolean }
    let onMessage:
      | ((
          message: Record<string, unknown>,
          sender: { tab?: { id?: number } },
          sendResponse: (value: WorkerResponse) => void,
        ) => boolean)
      | null = null
    const set = vi.fn().mockResolvedValue(undefined)
    const setBadgeText = vi.fn().mockResolvedValue(undefined)
    const chromeApi = {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: {
          addListener(listener: typeof onMessage) {
            onMessage = listener
          },
        },
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ qingsheDiscoveredTabs: {} }),
          set,
        },
      },
      action: { setBadgeText },
      tabs: {},
      downloads: { download: vi.fn() },
    }
    new Function("chrome", serviceWorker)(chromeApi)

    const response = await new Promise<WorkerResponse>((resolve) => {
      onMessage?.(
        {
          type: "QINGSHE_IMAGES_DISCOVERED",
          url: "https://chatgpt.com/c/one",
          title: "ChatGPT",
          images: [
            { source: "https://example.test/one.png", alt: "one" },
            { source: "https://example.test/two.png", alt: "two" },
          ],
        },
        { tab: { id: 42 } },
        resolve,
      )
    })

    expect(response).toEqual({ ok: true })
    expect(set).toHaveBeenCalledWith({
      qingsheDiscoveredTabs: {
        42: expect.objectContaining({ unseen: 2 }),
      },
    })
    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 42, text: "2" })
  })

  it("activates an existing material panel tab and focuses its window before sending", async () => {
    type WorkerResponse = { ok: boolean; error?: string }
    let onMessage:
      | ((
          message: { type: string; images: Array<{ source: string; filename: string }> },
          sender: unknown,
          sendResponse: (value: WorkerResponse) => void,
        ) => boolean)
      | null = null
    const chromeApi = {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: {
          addListener(listener: typeof onMessage) {
            onMessage = listener
          },
        },
      },
      storage: { local: { set: vi.fn() } },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 55, windowId: 9 }]),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 55, windowId: 9 }),
        sendMessage: vi
          .fn()
          .mockImplementation(async (_tabId: number, message: { type: string }) =>
            message.type === "QINGSHE_BRIDGE_PING" ? { ok: true } : { ok: true },
          ),
      },
      windows: { update: vi.fn().mockResolvedValue({ id: 9, focused: true }) },
      downloads: { download: vi.fn() },
    }
    new Function("chrome", serviceWorker)(chromeApi)

    const result = await new Promise<WorkerResponse>((resolve) => {
      onMessage?.(
        {
          type: "QINGSHE_SEND_TO_PANEL",
          images: [{ source: "data:image/png;base64,YQ==", filename: "car.png" }],
        },
        {},
        resolve,
      )
    })

    expect(result).toEqual({ ok: true })
    expect(chromeApi.tabs.update).toHaveBeenCalledWith(55, { active: true })
    expect(chromeApi.windows.update).toHaveBeenCalledWith(9, { focused: true })
  })

  it("buffers bridged files until the material panel announces that it is ready", () => {
    type BridgeListener = (
      message: Record<string, unknown>,
      sender: unknown,
      sendResponse: (value: unknown) => void,
    ) => boolean
    const listenerHolder: { current: BridgeListener | null } = { current: null }
    const postMessage = vi.fn()
    const panelWindow = Object.create(window) as Window
    Object.defineProperty(panelWindow, "postMessage", { value: postMessage })
    Object.defineProperty(panelWindow, "addEventListener", {
      value: window.addEventListener.bind(window),
    })
    new Function("chrome", "location", "window", "document", contentScript)(
      {
        runtime: {
          onMessage: {
            addListener(listener: BridgeListener) {
              listenerHolder.current = listener
            },
          },
        },
      },
      {
        origin: "https://assets.xiduoduo.top",
        href: "https://assets.xiduoduo.top/admin/asset-admin.html",
      },
      panelWindow,
      document,
    )
    const bridgeListener = listenerHolder.current
    if (bridgeListener === null) throw new Error("Content script did not register a listener")

    bridgeListener(
      {
        type: "QINGSHE_BRIDGE_FILE_START",
        transferId: "transfer-1",
        name: "car.png",
        mimeType: "image/png",
      },
      {},
      vi.fn(),
    )
    bridgeListener(
      { type: "QINGSHE_BRIDGE_FILE_CHUNK", transferId: "transfer-1", chunk: "YQ==" },
      {},
      vi.fn(),
    )
    bridgeListener({ type: "QINGSHE_BRIDGE_FILE_END", transferId: "transfer-1" }, {}, vi.fn())

    expect(postMessage).not.toHaveBeenCalled()

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://assets.xiduoduo.top",
        data: { source: "qingshe-panel", type: "qingshe-extension-ready" },
      }),
    )

    expect(postMessage).toHaveBeenCalledWith(
      {
        source: "qingshe-extension",
        type: "qingshe-extension-upload",
        file: { name: "car.png", type: "image/png", dataUrl: "data:image/png;base64,YQ==" },
      },
      "https://assets.xiduoduo.top",
    )
  })
})
