if (typeof importScripts === "function") {
  importScripts("automation-state.js", "server-client.js")
}

const PANEL_URL = "https://assets.xiduoduo.top/admin/asset-admin.html?extension_bridge=1"
const PAIR_PANEL_URL = "https://assets.xiduoduo.top/admin/asset-admin.html?extension_pair=1"
const BRIDGE_CHUNK_SIZE = 192 * 1024
const DISCOVERY_STORAGE_KEY = "qingsheDiscoveredTabs"
const MAX_DISCOVERIES_PER_TAB = 120
const CONNECTION_STORAGE_KEY = "qingsheExtensionConnection"
const AUTOMATION_STORAGE_KEY = "qingsheAutomationState"
const HEARTBEAT_ALARM = "qingshe-extension-heartbeat"
const PROVIDER_URLS = {
  chatgpt: "https://chatgpt.com/",
  gemini: "https://gemini.google.com/app",
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ qingsheExtensionVersion: "0.2.0" })
  ensureHeartbeatAlarm()
})

function ensureHeartbeatAlarm() {
  if (typeof chrome.alarms?.create === "function") {
    chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 })
  }
}

async function readStoredValue(key) {
  const stored = await chrome.storage.local.get(key)
  return stored[key] ?? null
}

async function readExtensionConnection() {
  const connection = await readStoredValue(CONNECTION_STORAGE_KEY)
  if (
    !connection ||
    typeof connection.baseUrl !== "string" ||
    typeof connection.token !== "string"
  ) {
    throw new Error("请先连接轻设素材服务器")
  }
  return connection
}

function connectedServerClient(connection) {
  return globalThis.QingsheServerClient.createServerClient(connection)
}

async function saveAutomationState(state) {
  await chrome.storage.local.set({ [AUTOMATION_STORAGE_KEY]: state })
  return state
}

async function waitForProviderTab(tabId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const tab = await chrome.tabs.get(tabId)
      if (tab?.status === "complete") return
    } catch {
      // The new tab is not visible to the extension yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("生成页面加载超时")
}

async function sendToProviderTab(tabId, message) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, message)
    } catch (error) {
      if (attempt === 0 && typeof chrome.scripting?.executeScript === "function") {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ["provider-adapters.js", "content-script.js"],
          })
        } catch {
          // A manifest content script may still be reaching document_idle.
        }
      }
      if (attempt === 29) throw error
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error("无法连接生成页面")
}

async function startAutomationItem(state) {
  const item = globalThis.QingsheAutomationState.activeAutomationItem(state)
  if (!item) return state
  const connection = await readExtensionConnection()
  const client = connectedServerClient(connection)
  await client.updateItem(state.id, item.id, { status: "generating" })
  const next = globalThis.QingsheAutomationState.nextAutomationState(state, {
    type: "ITEM_STARTED",
    itemId: item.id,
  })
  await saveAutomationState(next)
  const response = await sendToProviderTab(next.tabId, {
    type: "QINGSHE_AUTOMATION_GENERATE_ITEM",
    provider: next.provider,
    runId: next.id,
    itemId: item.id,
    prompt: next.prompt,
    ordinal: item.ordinal,
    total: next.count,
  })
  if (response?.ok === false) throw new Error(response.error || "生成页面拒绝了自动任务")
  return next
}

async function startAutomation(config) {
  const providerUrl = PROVIDER_URLS[config?.provider]
  const prompt = typeof config?.prompt === "string" ? config.prompt.trim() : ""
  const count = Number(config?.count)
  if (!providerUrl || !prompt || !Number.isInteger(count) || count < 1 || count > 50) {
    throw new Error("全自动配置无效")
  }
  const connection = await readExtensionConnection()
  const client = connectedServerClient(connection)
  const run = await client.createRun({
    provider: config.provider,
    prompt,
    count,
    category: config.category || null,
  })
  const tab = await chrome.tabs.create({ url: providerUrl, active: true })
  if (typeof tab.id !== "number") throw new Error("无法打开生成页面")
  const firstItem = run.items?.find((item) => item.status === "queued")
  const state = await saveAutomationState({
    ...run,
    tabId: tab.id,
    currentOrdinal: firstItem?.ordinal ?? null,
    error: null,
  })
  await waitForProviderTab(tab.id)
  return startAutomationItem(state)
}

async function cancelAutomation() {
  const state = await readStoredValue(AUTOMATION_STORAGE_KEY)
  if (!state?.id) throw new Error("当前没有全自动任务")
  const connection = await readExtensionConnection()
  const run = await connectedServerClient(connection).cancelRun(state.id)
  return saveAutomationState({
    ...state,
    ...run,
    tabId: state.tabId,
    currentOrdinal: null,
    error: null,
  })
}

async function retryAutomation() {
  const state = await readStoredValue(AUTOMATION_STORAGE_KEY)
  const failed = state?.items?.find((item) => item.status === "failed")
  if (!state?.id || !failed) throw new Error("没有可重试的失败图片")
  const connection = await readExtensionConnection()
  await connectedServerClient(connection).updateItem(state.id, failed.id, {
    status: "queued",
    error: null,
  })
  const retried = globalThis.QingsheAutomationState.nextAutomationState(state, {
    type: "ITEM_RETRY",
    itemId: failed.id,
  })
  await saveAutomationState(retried)
  return startAutomationItem(retried)
}

async function resumeAutomation() {
  try {
    const state = await readStoredValue(AUTOMATION_STORAGE_KEY)
    const connection = await readStoredValue(CONNECTION_STORAGE_KEY)
    if (!connection || !state?.id || !["running", "queued"].includes(state.status)) return null
    const serverRun = await connectedServerClient(connection).readRun(state.id)
    if (!["running", "queued"].includes(serverRun.status)) {
      return saveAutomationState({ ...state, ...serverRun, tabId: state.tabId })
    }
    const active = serverRun.items?.find((item) =>
      ["queued", "generating", "uploading"].includes(item.status),
    )
    if (!active) return saveAutomationState({ ...state, ...serverRun, tabId: state.tabId })
    let tabId = state.tabId
    try {
      if (typeof tabId !== "number") throw new Error("missing tab")
      await chrome.tabs.get(tabId)
    } catch {
      const tab = await chrome.tabs.create({ url: PROVIDER_URLS[serverRun.provider], active: true })
      tabId = tab.id
    }
    if (typeof tabId !== "number") throw new Error("无法恢复生成页面")
    const resumed = await saveAutomationState({
      ...state,
      ...serverRun,
      tabId,
      currentOrdinal: active.ordinal,
      error: null,
    })
    await waitForProviderTab(tabId)
    return startAutomationItem(resumed)
  } catch {
    return null
  }
}

if (typeof chrome.runtime.onStartup?.addListener === "function") {
  chrome.runtime.onStartup.addListener(() => {
    ensureHeartbeatAlarm()
    void resumeAutomation()
  })
}

async function imageBlob(image) {
  if (!image || typeof image.source !== "string") throw new Error("生成图片无效")
  const response = await fetch(image.source, { credentials: "include" })
  if (!response.ok) throw new Error(`生成图片下载失败（HTTP ${response.status}）`)
  const blob = await response.blob()
  if (!blob.size) throw new Error("生成图片内容为空")
  return blob
}

async function handleAutomationImage(message, sender) {
  const state = await readStoredValue(AUTOMATION_STORAGE_KEY)
  if (!state || state.id !== message.runId || state.tabId !== sender.tab?.id) {
    throw new Error("生成图片不属于当前自动任务")
  }
  const item = state.items?.find((candidate) => candidate.id === message.itemId)
  if (!item) throw new Error("自动运行项不存在")
  if (item.status === "processing" || item.status === "ready") return state
  const connection = await readExtensionConnection()
  const client = connectedServerClient(connection)
  await client.updateItem(state.id, item.id, { status: "uploading" })
  const uploading = globalThis.QingsheAutomationState.nextAutomationState(state, {
    type: "IMAGE_FOUND",
    itemId: item.id,
  })
  await saveAutomationState(uploading)
  const blob = await imageBlob(message.image)
  await client.uploadItem(
    state.id,
    item.id,
    blob,
    typeof message.image.filename === "string" ? message.image.filename : "generated-image.png",
  )
  const advanced = globalThis.QingsheAutomationState.nextAutomationState(uploading, {
    type: "IMAGE_UPLOADED",
    itemId: item.id,
  })
  await saveAutomationState(advanced)
  return advanced.currentOrdinal === null ? advanced : startAutomationItem(advanced)
}

async function handleAutomationError(message, sender) {
  const state = await readStoredValue(AUTOMATION_STORAGE_KEY)
  if (!state || state.id !== message.runId || state.tabId !== sender.tab?.id) return null
  const item = state.items?.find((candidate) => candidate.id === message.itemId)
  if (!item) return null
  const detail = typeof message.error === "string" ? message.error : "生成图片失败"
  const connection = await readExtensionConnection()
  await connectedServerClient(connection).updateItem(state.id, item.id, {
    status: "failed",
    error: detail,
  })
  const failed = globalThis.QingsheAutomationState.nextAutomationState(state, {
    type: "ITEM_FAILED",
    itemId: item.id,
    error: detail,
  })
  return saveAutomationState(failed)
}

async function heartbeatExtension() {
  try {
    const connection = await readExtensionConnection()
    await connectedServerClient(connection).heartbeat()
  } catch {
    // Pairing and transient network errors are shown in the popup state.
  }
}

async function automationStatus() {
  const connection = await readStoredValue(CONNECTION_STORAGE_KEY)
  let state = await readStoredValue(AUTOMATION_STORAGE_KEY)
  if (connection && state?.id) {
    try {
      const serverRun = await connectedServerClient(connection).readRun(state.id)
      const active = serverRun.items?.find((item) =>
        ["queued", "generating", "uploading"].includes(item.status),
      )
      state = {
        ...state,
        ...serverRun,
        tabId: state.tabId,
        currentOrdinal: active?.ordinal ?? null,
      }
      await saveAutomationState(state)
    } catch {
      // Keep the last durable local state while the server is temporarily unavailable.
    }
  }
  return { paired: Boolean(connection), state }
}

if (typeof chrome.alarms?.onAlarm?.addListener === "function") {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === HEARTBEAT_ALARM) void heartbeatExtension()
  })
  ensureHeartbeatAlarm()
}

function base64FromBytes(bytes) {
  let binary = ""
  const step = 0x8000
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step))
  }
  return btoa(binary)
}

async function waitForPanelContentScript(tabId) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: "QINGSHE_BRIDGE_PING" })
      if (result?.ok) return
    } catch {
      // The tab may still be loading or the content script may be between
      // document_idle and the first message listener registration.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error("素材面板加载超时，请重新打开面板")
}

async function openPanelTab() {
  const existing = await chrome.tabs.query({ url: "https://assets.xiduoduo.top/admin/*" })
  const tab = existing[0] ?? (await chrome.tabs.create({ url: PANEL_URL }))
  if (!tab.id) throw new Error("无法打开素材面板")
  await chrome.tabs.update(tab.id, { active: true })
  if (typeof tab.windowId === "number") {
    await chrome.windows.update(tab.windowId, { focused: true })
  }
  await waitForPanelContentScript(tab.id)
  return tab.id
}

async function openExtensionPairingTab() {
  const existing = await chrome.tabs.query({ url: "https://assets.xiduoduo.top/admin/*" })
  const tab = existing[0] ?? (await chrome.tabs.create({ url: PAIR_PANEL_URL }))
  if (!tab.id) throw new Error("无法打开素材面板")
  await chrome.tabs.update(tab.id, { active: true, url: PAIR_PANEL_URL })
  if (typeof tab.windowId === "number") {
    await chrome.windows.update(tab.windowId, { focused: true })
  }
}

async function saveExtensionConnection(message, sender) {
  let panelOrigin = ""
  try {
    panelOrigin = new URL(sender.tab?.url || "").origin
  } catch {
    throw new Error("插件配对来源无效")
  }
  const connection = message.connection
  if (
    panelOrigin !== "https://assets.xiduoduo.top" ||
    !connection ||
    connection.baseUrl !== "https://assets.xiduoduo.top/api/v1" ||
    typeof connection.token !== "string" ||
    connection.token.length < 16 ||
    typeof connection.deviceId !== "string" ||
    connection.deviceId.length === 0
  ) {
    throw new Error("插件配对数据无效")
  }
  await chrome.storage.local.set({ [CONNECTION_STORAGE_KEY]: connection })
  void heartbeatExtension()
}

async function bridgeSelectedImages(images) {
  if (!Array.isArray(images) || images.length === 0) throw new Error("没有选择图片")
  const tabId = await openPanelTab()
  for (const image of images) {
    if (!image || typeof image.source !== "string") continue
    const response = await fetch(image.source, { credentials: "include" })
    if (!response.ok) throw new Error(`图片下载失败（${response.status}）`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    const type = response.headers.get("content-type") || "image/png"
    const base64 = base64FromBytes(bytes)
    const transferId = crypto.randomUUID()
    await chrome.tabs.sendMessage(tabId, {
      type: "QINGSHE_BRIDGE_FILE_START",
      transferId,
      name: image.filename || "ai-image.png",
      mimeType: type,
    })
    for (let index = 0; index < base64.length; index += BRIDGE_CHUNK_SIZE) {
      await chrome.tabs.sendMessage(tabId, {
        type: "QINGSHE_BRIDGE_FILE_CHUNK",
        transferId,
        chunk: base64.slice(index, index + BRIDGE_CHUNK_SIZE),
      })
    }
    await chrome.tabs.sendMessage(tabId, { type: "QINGSHE_BRIDGE_FILE_END", transferId })
  }
}

function storableDiscovery(image) {
  const source =
    typeof image?.source === "string" && image.source.length <= 4_096 ? image.source : ""
  return {
    source,
    alt: typeof image?.alt === "string" ? image.alt.slice(0, 200) : "生成图片",
    filename: typeof image?.filename === "string" ? image.filename.slice(0, 160) : "ai-image.png",
    width: Number.isFinite(image?.width) ? image.width : null,
    height: Number.isFinite(image?.height) ? image.height : null,
  }
}

async function persistDiscoveries(message, sender) {
  const tabId = sender.tab?.id
  if (typeof tabId !== "number" || !Array.isArray(message.images)) return
  const stored = await chrome.storage.local.get(DISCOVERY_STORAGE_KEY)
  const tabs = stored[DISCOVERY_STORAGE_KEY] ?? {}
  const previous = tabs[tabId] ?? { images: [], unseen: 0 }
  const images = [...previous.images]
  const known = new Set(images.map((image) => image.source).filter(Boolean))
  let added = 0
  for (const candidate of message.images) {
    const image = storableDiscovery(candidate)
    const key = image.source || `${image.filename}:${image.width}:${image.height}`
    if (known.has(key)) continue
    known.add(key)
    images.push(image)
    added += 1
  }
  const unseen = Math.min(999, Number(previous.unseen || 0) + added)
  tabs[tabId] = {
    url: typeof message.url === "string" ? message.url : sender.tab?.url || "",
    title: typeof message.title === "string" ? message.title : sender.tab?.title || "",
    images: images.slice(-MAX_DISCOVERIES_PER_TAB),
    unseen,
    updatedAt: new Date().toISOString(),
  }
  await chrome.storage.local.set({ [DISCOVERY_STORAGE_KEY]: tabs })
  if (typeof chrome.action?.setBadgeText === "function") {
    await chrome.action.setBadgeText({ tabId, text: unseen > 0 ? String(unseen) : "" })
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "QINGSHE_AUTOMATION_STATUS") {
    void automationStatus().then(
      (result) => sendResponse({ ok: true, ...result }),
      () => sendResponse({ ok: false, paired: false, state: null }),
    )
    return true
  }
  if (message?.type === "QINGSHE_PAIR_EXTENSION") {
    void openExtensionPairingTab().then(
      () => sendResponse({ ok: true }),
      (error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "打开配对页失败",
        }),
    )
    return true
  }
  if (message?.type === "QINGSHE_EXTENSION_PAIRED") {
    void saveExtensionConnection(message, sender).then(
      () => sendResponse({ ok: true }),
      (error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "插件配对失败",
        }),
    )
    return true
  }
  if (message?.type === "QINGSHE_AUTOMATION_START") {
    void startAutomation(message.config).then(
      (state) => sendResponse({ ok: true, state }),
      (error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "全自动任务启动失败",
        }),
    )
    return true
  }
  if (message?.type === "QINGSHE_AUTOMATION_CANCEL") {
    void cancelAutomation().then(
      (state) => sendResponse({ ok: true, state }),
      (error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "取消全自动任务失败",
        }),
    )
    return true
  }
  if (message?.type === "QINGSHE_AUTOMATION_RETRY") {
    void retryAutomation().then(
      (state) => sendResponse({ ok: true, state }),
      (error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "重试全自动任务失败",
        }),
    )
    return true
  }
  if (message?.type === "QINGSHE_AUTOMATION_IMAGE") {
    void handleAutomationImage(message, sender).then(
      (state) => sendResponse({ ok: true, state }),
      (error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "生成图片上传失败",
        }),
    )
    return true
  }
  if (message?.type === "QINGSHE_AUTOMATION_ERROR") {
    void handleAutomationError(message, sender).then(
      (state) => sendResponse({ ok: true, state }),
      (error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "全自动任务失败",
        }),
    )
    return true
  }
  if (message?.type === "QINGSHE_IMAGES_DISCOVERED") {
    void persistDiscoveries(message, sender).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    )
    return true
  }
  if (message?.type === "QINGSHE_SEND_TO_PANEL") {
    void bridgeSelectedImages(message.images).then(
      () => sendResponse({ ok: true }),
      (error) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "发送失败" }),
    )
    return true
  }
  if (message?.type !== "QINGSHE_DOWNLOAD_ONE" || typeof message.url !== "string") return false
  chrome.downloads
    .download({
      url: message.url,
      filename: `轻设归档/${message.filename || "ai-image.png"}`,
      conflictAction: "uniquify",
      saveAs: false,
    })
    .then(
      (id) => sendResponse({ ok: true, id }),
      () => sendResponse({ ok: false }),
    )
  return true
})
