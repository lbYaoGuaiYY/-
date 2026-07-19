const PANEL_ORIGIN = "https://assets.xiduoduo.top"
const MIN_IMAGE_EDGE = 128
const MAX_BRIDGE_CHUNK = 192 * 1024
const IMAGE_MIME_TYPES = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
}
const transfers = new Map()
const pendingPanelFiles = []
let panelReady = false
const discoveredSources = new Set()
const activeAutomationItems = new Map()
let discoveryTimer = null

function absoluteUrl(value) {
  if (!value) return null
  try {
    return new URL(value, location.href).toString()
  } catch {
    return null
  }
}

function pickSource(image) {
  const candidates = [
    image.currentSrc,
    image.src,
    image.getAttribute("data-src"),
    image.getAttribute("data-original"),
    image.getAttribute("data-url"),
  ]
  const srcset = image.getAttribute("srcset") || image.getAttribute("data-srcset")
  if (srcset) {
    const last = srcset.split(",").at(-1)?.trim().split(/\s+/)[0]
    candidates.unshift(last)
  }
  return candidates.map(absoluteUrl).find(Boolean) ?? null
}

function isUsefulImage(image, source) {
  if (!source || source.startsWith(PANEL_ORIGIN)) return false
  const renderedWidth = image.width || 0
  const renderedHeight = image.height || 0
  if (
    renderedWidth > 0 &&
    renderedHeight > 0 &&
    (renderedWidth < MIN_IMAGE_EDGE || renderedHeight < MIN_IMAGE_EDGE)
  )
    return false
  const intrinsicWidth = image.naturalWidth || 0
  const intrinsicHeight = image.naturalHeight || 0
  if (
    (renderedWidth === 0 || renderedHeight === 0) &&
    intrinsicWidth > 0 &&
    intrinsicHeight > 0 &&
    (intrinsicWidth < MIN_IMAGE_EDGE || intrinsicHeight < MIN_IMAGE_EDGE)
  )
    return false
  const role =
    `${image.alt || ""} ${image.getAttribute("aria-label") || ""} ${image.className || ""}`.toLowerCase()
  if (/avatar|icon|logo|emoji|favicon|profile|toolbar|menu|sparkle/.test(role)) return false
  return true
}

function contentTypeForSource(source) {
  try {
    const extension = new URL(source).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()
    return extension ? IMAGE_MIME_TYPES[extension] || null : null
  } catch {
    return null
  }
}

function extensionForContentType(contentType) {
  const normalized = String(contentType || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase()
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg"
  if (normalized === "image/webp") return "webp"
  if (normalized === "image/avif") return "avif"
  if (normalized === "image/gif") return "gif"
  return "png"
}

function filenameFor(item, index, contentType = "image/png") {
  const raw = (item.alt || item.title || "ai-image").trim().replace(/[^\w\-\u4e00-\u9fff]+/g, "-")
  const extension = extensionForContentType(contentType)
  return `${String(index + 1).padStart(2, "0")}-${raw.slice(0, 48) || "ai-image"}.${extension}`
}

function dataUrlFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener("load", () => resolve(reader.result), { once: true })
    reader.addEventListener("error", () => reject(reader.error || new Error("图片读取失败")), {
      once: true,
    })
    reader.readAsDataURL(blob)
  })
}

function dataUrlFromImage(image) {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (!width || !height) throw new Error("图片尚未加载")
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("无法读取图片像素")
  context.drawImage(image, 0, 0, width, height)
  const dataUrl = canvas.toDataURL("image/png")
  if (!dataUrl || dataUrl === "data:,") throw new Error("无法导出图片像素")
  return dataUrl
}

async function portableSource(source, image) {
  if (!source.startsWith("blob:")) return { source, contentType: contentTypeForSource(source) }
  try {
    const response = await fetch(source)
    if (!response.ok) throw new Error(`图片读取失败（${response.status}）`)
    const blob = await response.blob()
    return {
      source: await dataUrlFromBlob(blob),
      contentType: blob.type || response.headers.get("content-type") || "image/png",
    }
  } catch {
    return { source: dataUrlFromImage(image), contentType: "image/png" }
  }
}

async function scanImages() {
  const seen = new Set()
  const results = []
  for (const image of document.images) {
    const source = pickSource(image)
    if (!isUsefulImage(image, source) || seen.has(source)) continue
    seen.add(source)
    let portable
    try {
      portable = await portableSource(source, image)
    } catch {
      continue
    }
    results.push({
      id: `${source}#${results.length}`,
      source: portable.source,
      preview: portable.source,
      alt: image.alt || image.title || "生成图片",
      width: image.naturalWidth || image.width || null,
      height: image.naturalHeight || image.height || null,
      filename: filenameFor(image, results.length, portable.contentType || "image/png"),
    })
  }
  return results
}

function usefulImageSources() {
  return new Set(
    Array.from(document.images, (image) => pickSource(image)).filter((source) => source !== null),
  )
}

function waitForStableGeneratedImage(
  baseline,
  { stabilityMs = 2_000, timeoutMs = 240_000, signal } = {},
) {
  return new Promise((resolve, reject) => {
    let candidate = null
    let candidateSource = null
    let stabilityTimer = null
    let timeoutTimer = null
    let observer = null
    let settled = false
    const handleImageLoad = (event) => {
      if (event.target instanceof HTMLImageElement) check()
    }
    const cleanup = () => {
      observer?.disconnect()
      document.removeEventListener("load", handleImageLoad, true)
      if (timeoutTimer !== null) clearTimeout(timeoutTimer)
      if (stabilityTimer !== null) clearTimeout(stabilityTimer)
      signal?.removeEventListener("abort", abort)
    }
    const abort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(signal?.reason instanceof Error ? signal.reason : new Error("生成任务已取消"))
    }
    const settleWithImage = async () => {
      if (
        settled ||
        candidate === null ||
        candidateSource === null ||
        pickSource(candidate) !== candidateSource
      )
        return
      settled = true
      cleanup()
      try {
        const portable = await portableSource(candidateSource, candidate)
        resolve({
          id: candidateSource,
          source: portable.source,
          preview: portable.source,
          alt: candidate.alt || candidate.title || "生成图片",
          width: candidate.naturalWidth || candidate.width || null,
          height: candidate.naturalHeight || candidate.height || null,
          filename: filenameFor(candidate, 0, portable.contentType || "image/png"),
        })
      } catch (error) {
        reject(error)
      }
    }
    const check = () => {
      const next = Array.from(document.images)
        .reverse()
        .find((image) => {
          const source = pickSource(image)
          return (
            image.complete &&
            source !== null &&
            !baseline.has(source) &&
            isUsefulImage(image, source)
          )
        })
      const source = next ? pickSource(next) : null
      if (!next || !source || (next === candidate && source === candidateSource)) return
      candidate = next
      candidateSource = source
      if (stabilityTimer !== null) clearTimeout(stabilityTimer)
      stabilityTimer = setTimeout(() => void settleWithImage(), stabilityMs)
    }
    observer = new MutationObserver(check)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["src", "srcset", "data-src", "data-original", "data-url"],
      childList: true,
      subtree: true,
    })
    document.addEventListener("load", handleImageLoad, true)
    timeoutTimer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error("等待生成图片超时"))
    }, timeoutMs)
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener("abort", abort, { once: true })
    check()
  })
}

function automationItemKey(message) {
  return `${String(message?.runId || "")}:${String(message?.itemId || "")}`
}

async function sendRuntimeMessageWithRetry(message, { attempts = 8, delayMs = 250 } = {}) {
  let lastError = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await chrome.runtime.sendMessage(message)
      if (response?.ok === false) throw new Error(response.error || "轻设插件后台拒绝了任务")
      return response
    } catch (error) {
      lastError = error
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("无法连接轻设插件后台")
}

async function generateAutomationItem(message, signal) {
  const adapters = globalThis.QingsheProviderAdapters
  const provider = adapters?.providers?.[message.provider]
  if (!provider) throw new Error("当前生成站点不受支持")
  const baseline = usefulImageSources()
  const waitController = new AbortController()
  const stopWaiting = () => waitController.abort(signal?.reason)
  signal?.addEventListener("abort", stopWaiting, { once: true })
  const generatedImage = waitForStableGeneratedImage(baseline, {
    signal: waitController.signal,
  })
  const itemPrompt = adapters.buildItemPrompt(message.prompt, message.ordinal, message.total)
  try {
    await adapters.submitPrompt(provider, itemPrompt)
    const image = await generatedImage
    image.filename = `${String(message.ordinal).padStart(2, "0")}-${image.filename.replace(/^\d+-/, "")}`
    await sendRuntimeMessageWithRetry({
      type: "QINGSHE_AUTOMATION_IMAGE",
      runId: message.runId,
      itemId: message.itemId,
      image,
    })
  } catch (error) {
    waitController.abort(error)
    await generatedImage.catch(() => undefined)
    throw error
  } finally {
    signal?.removeEventListener("abort", stopWaiting)
  }
}

function startAutomationItem(message) {
  const key = automationItemKey(message)
  if (!message?.runId || !message?.itemId || activeAutomationItems.has(key)) return false
  const controller = new AbortController()
  const task = generateAutomationItem(message, controller.signal)
    .catch(async (error) => {
      if (controller.signal.aborted) return
      const detail = error instanceof Error ? error.message : "生成图片失败"
      try {
        await sendRuntimeMessageWithRetry({
          type: "QINGSHE_AUTOMATION_ERROR",
          runId: message.runId,
          itemId: message.itemId,
          error: detail,
        })
      } catch {
        // The service worker will recover this item from durable server state.
      }
    })
    .finally(() => activeAutomationItems.delete(key))
  activeAutomationItems.set(key, { controller, task })
  return true
}

function cancelAutomationItem(message) {
  const key = automationItemKey(message)
  const active = activeAutomationItems.get(key)
  if (!active) return false
  active.controller.abort(new Error("生成任务已取消"))
  return true
}

function postFileToPanel(file) {
  window.postMessage(
    {
      source: "qingshe-extension",
      type: "qingshe-extension-upload",
      file,
    },
    PANEL_ORIGIN,
  )
}

function deliverFileFromBridge(transfer) {
  const file = {
    name: transfer.name,
    type: transfer.type || "image/png",
    dataUrl: `data:${transfer.type || "image/png"};base64,${transfer.chunks.join("")}`,
  }
  if (!panelReady) {
    pendingPanelFiles.push(file)
    return
  }
  postFileToPanel(file)
}

if (location.origin === PANEL_ORIGIN) {
  window.addEventListener("message", (event) => {
    if (event.origin !== PANEL_ORIGIN || event.data?.source !== "qingshe-panel") return
    if (event.data?.type === "qingshe-extension-ready") {
      panelReady = true
      for (const file of pendingPanelFiles.splice(0)) postFileToPanel(file)
      return
    }
    if (event.data?.type === "qingshe-extension-pair") {
      void chrome.runtime.sendMessage({
        type: "QINGSHE_EXTENSION_PAIRED",
        connection: event.data.connection,
      })
    }
  })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "QINGSHE_BRIDGE_PING" && location.origin === PANEL_ORIGIN) {
    sendResponse({ ok: true })
    return false
  }
  if (message?.type === "QINGSHE_SCAN") {
    void scanImages().then(
      (images) => sendResponse({ images, title: document.title, url: location.href }),
      () => sendResponse({ images: [], title: document.title, url: location.href }),
    )
    return true
  }
  if (message?.type === "QINGSHE_AUTOMATION_PROVIDER_READY") {
    const adapters = globalThis.QingsheProviderAdapters
    const provider = adapters?.providerForUrl?.(location.href)
    const composerReady =
      provider?.id === message.provider &&
      provider.composerSelectors.some((selector) => document.querySelector(selector) !== null)
    sendResponse({ ok: true, ready: composerReady, provider: provider?.id ?? null })
    return false
  }
  if (message?.type === "QINGSHE_AUTOMATION_GENERATE_ITEM") {
    const started = startAutomationItem(message)
    sendResponse({ ok: true, started, active: true })
    return false
  }
  if (message?.type === "QINGSHE_AUTOMATION_QUERY_ITEM") {
    sendResponse({ active: activeAutomationItems.has(automationItemKey(message)) })
    return false
  }
  if (message?.type === "QINGSHE_AUTOMATION_CANCEL_ITEM") {
    sendResponse({ ok: true, cancelled: cancelAutomationItem(message) })
    return false
  }
  if (location.origin !== PANEL_ORIGIN) return false
  if (message?.type === "QINGSHE_BRIDGE_FILE_START") {
    transfers.set(message.transferId, { name: message.name, type: message.mimeType, chunks: [] })
    sendResponse({ ok: true })
    return false
  }
  if (message?.type === "QINGSHE_BRIDGE_FILE_CHUNK") {
    const transfer = transfers.get(message.transferId)
    if (
      !transfer ||
      typeof message.chunk !== "string" ||
      message.chunk.length > MAX_BRIDGE_CHUNK * 2
    ) {
      sendResponse({ ok: false })
      return false
    }
    transfer.chunks.push(message.chunk)
    sendResponse({ ok: true })
    return false
  }
  if (message?.type === "QINGSHE_BRIDGE_FILE_END") {
    const transfer = transfers.get(message.transferId)
    if (!transfer) {
      sendResponse({ ok: false })
      return false
    }
    transfers.delete(message.transferId)
    deliverFileFromBridge(transfer)
    sendResponse({ ok: true })
    return false
  }
  return false
})

async function reportDiscoveredImages() {
  if (location.origin === PANEL_ORIGIN || typeof chrome.runtime.sendMessage !== "function") return
  const images = await scanImages()
  const discovered = images.filter((image) => !discoveredSources.has(image.source))
  if (discovered.length === 0) return
  for (const image of discovered) discoveredSources.add(image.source)
  await chrome.runtime.sendMessage({
    type: "QINGSHE_IMAGES_DISCOVERED",
    url: location.href,
    title: document.title,
    images: discovered,
  })
}

function scheduleDiscovery() {
  if (discoveryTimer !== null) clearTimeout(discoveryTimer)
  discoveryTimer = setTimeout(() => {
    discoveryTimer = null
    void reportDiscoveredImages()
  }, 300)
}

new MutationObserver(scheduleDiscovery).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["src", "srcset", "data-src", "data-original", "data-url"],
  childList: true,
  subtree: true,
})
scheduleDiscovery()
