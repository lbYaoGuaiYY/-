import { zipSync } from "./fflate.js"
import { scanTabWithRetry } from "./scan-active-tab.js"
import { siteForHost } from "./site-adapters.js"

const state = { images: [], selected: new Set(), tab: null, automation: null, paired: false }
const $ = (id) => document.getElementById(id)

function setStatus(text, error = false) {
  $("status").textContent = text
  $("status").classList.toggle("is-error", error)
}

function setMode(mode) {
  const automatic = mode === "auto"
  $("auto-panel").hidden = !automatic
  $("manual-panel").hidden = automatic
  $("tab-auto").classList.toggle("is-active", automatic)
  $("tab-manual").classList.toggle("is-active", !automatic)
  $("tab-auto").setAttribute("aria-pressed", String(automatic))
  $("tab-manual").setAttribute("aria-pressed", String(!automatic))
  if (!automatic) void scan()
}

function automationCounts(run) {
  const items = Array.isArray(run?.items) ? run.items : []
  return {
    ready: items.filter((item) => item.status === "ready").length,
    processing: items.filter((item) => item.status === "processing").length,
    failed: items.filter((item) => item.status === "failed").length,
    total: Number(run?.count || items.length || 0),
  }
}

function renderAutomation() {
  const run = state.automation
  const counts = automationCounts(run)
  $("connection-state").textContent = state.paired ? "服务器已连接" : "未连接"
  $("connection-state").classList.toggle("is-online", state.paired)
  $("auto-connect").hidden = state.paired
  $("auto-start").disabled = !state.paired || ["running", "queued"].includes(run?.status)
  $("auto-cancel").hidden = !["running", "queued"].includes(run?.status)
  $("auto-retry").hidden = run?.status !== "failed"
  if (!run) {
    $("auto-progress-count").textContent = "尚未开始"
    $("auto-progress-detail").textContent = state.paired
      ? "开始后可以关闭此弹窗"
      : "首次使用需在素材面板确认连接"
    $("auto-progress-bar").style.width = "0%"
    return
  }
  $("auto-progress-count").textContent = `${counts.ready} / ${counts.total}`
  $("auto-progress-bar").style.width = `${counts.total ? (counts.ready / counts.total) * 100 : 0}%`
  const active = run.items?.find((item) =>
    ["generating", "uploading", "processing", "queued"].includes(item.status),
  )
  $("auto-progress-detail").textContent =
    run.status === "completed"
      ? "全部完成，成品已进入轻设 App"
      : run.status === "failed"
        ? run.error || `有 ${counts.failed} 项失败`
        : active
          ? `第 ${active.ordinal} 张 · ${active.status === "generating" ? "正在生成" : active.status === "uploading" ? "正在上传" : active.status === "processing" ? "正在抠图" : "等待生成"}`
          : counts.processing > 0
            ? `还有 ${counts.processing} 张正在抠图`
            : "正在同步服务器状态"
}

async function refreshAutomationStatus() {
  const result = await chrome.runtime.sendMessage({ type: "QINGSHE_AUTOMATION_STATUS" })
  if (!result?.ok) return
  state.paired = Boolean(result.paired)
  state.automation = result.state ?? null
  renderAutomation()
}

async function startAutomation() {
  const prompt = $("auto-prompt").value.trim()
  const count = Number($("auto-count").value)
  if (!prompt) throw new Error("请输入提示词")
  if (!Number.isInteger(count) || count < 1 || count > 50)
    throw new Error("数量必须在 1 到 50 之间")
  setStatus("正在打开新对话…")
  const config = {
    provider: $("auto-provider").value,
    prompt,
    count,
    category: $("auto-category").value || null,
  }
  await chrome.storage.local.set({ qingsheAutomationConfig: config })
  const result = await chrome.runtime.sendMessage({ type: "QINGSHE_AUTOMATION_START", config })
  if (!result?.ok) throw new Error(result?.error || "全自动任务启动失败")
  state.automation = result.state
  setStatus("已开始，正在生成第 1 张图片")
  renderAutomation()
}

async function automationAction(type, pendingText) {
  setStatus(pendingText)
  const result = await chrome.runtime.sendMessage({ type })
  if (!result?.ok) throw new Error(result?.error || "全自动任务操作失败")
  state.automation = result.state ?? null
  renderAutomation()
}

function selectedImages() {
  return state.images.filter((image) => state.selected.has(image.id))
}

function render() {
  const list = $("image-list")
  list.replaceChildren()
  for (const image of state.images) {
    const item = document.createElement("div")
    item.className = `image-item${state.selected.has(image.id) ? " is-selected" : ""}`
    const label = document.createElement("label")
    const checkbox = document.createElement("input")
    checkbox.type = "checkbox"
    checkbox.checked = state.selected.has(image.id)
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selected.add(image.id)
      else state.selected.delete(image.id)
      render()
    })
    const content = document.createElement("div")
    const preview = document.createElement("img")
    preview.src = image.preview
    preview.alt = image.alt
    const name = document.createElement("span")
    name.textContent = image.filename
    content.append(preview, name)
    label.append(checkbox, content)
    item.append(label)
    list.append(item)
  }
  const count = selectedImages().length
  $("count").textContent = `${state.images.length} 张图片 · 已选 ${count} 张`
  for (const id of ["download", "zip", "send"]) $(id).disabled = count === 0
  $("select-all").checked = state.images.length > 0 && count === state.images.length
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  return tabs[0] ?? null
}

async function scan() {
  state.tab = await activeTab()
  if (!state.tab?.id) {
    setStatus("没有找到当前网页", true)
    return
  }
  try {
    const result = await scanTabWithRetry(state.tab.id)
    state.images = result?.images ?? []
    state.selected = new Set(state.images.map((image) => image.id))
    setStatus(
      state.images.length
        ? `已识别 ${state.images.length} 张候选图片`
        : "当前页面没有识别到生成图片",
    )
    render()
  } catch {
    setStatus("请在 ChatGPT、Gemini 或其他支持的网页中重试", true)
  }
}

async function downloadSelected() {
  for (const image of selectedImages()) {
    await chrome.runtime.sendMessage({
      type: "QINGSHE_DOWNLOAD_ONE",
      url: image.source,
      filename: image.filename,
    })
  }
  setStatus(`已提交 ${selectedImages().length} 张图片下载`)
}

async function fetchImage(image) {
  const response = await fetch(image.source, { credentials: "include" })
  if (!response.ok) throw new Error(`图片下载失败（${response.status}）`)
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    type: response.headers.get("content-type") || "image/png",
  }
}

async function zipSelected() {
  const files = {}
  let index = 0
  for (const image of selectedImages()) {
    const result = await fetchImage(image)
    files[image.filename || `ai-image-${++index}.png`] = result.bytes
  }
  const blob = new Blob([zipSync(files)], { type: "application/zip" })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = href
  anchor.download = `轻设图片-${Date.now()}.zip`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
  setStatus(`已打包 ${Object.keys(files).length} 张图片`)
}

async function sendToPanel() {
  const result = await chrome.runtime.sendMessage({
    type: "QINGSHE_SEND_TO_PANEL",
    images: selectedImages(),
  })
  if (!result?.ok) throw new Error(result?.error || "发送失败")
  setStatus(`已发送 ${selectedImages().length} 张，素材面板将按透明 PNG 入库`)
}

void activeTab().then((tab) => {
  if (tab?.url) $("site-label").textContent = siteForHost(new URL(tab.url).hostname).label
})
$("tab-auto").addEventListener("click", () => setMode("auto"))
$("tab-manual").addEventListener("click", () => setMode("manual"))
$("auto-connect").addEventListener("click", () => {
  void chrome.runtime
    .sendMessage({ type: "QINGSHE_PAIR_EXTENSION" })
    .then((result) => {
      if (!result?.ok) throw new Error(result?.error || "打开配对页失败")
      setStatus("请在素材面板确认连接")
    })
    .catch((error) => setStatus(error.message, true))
})
$("auto-start").addEventListener(
  "click",
  () => void startAutomation().catch((error) => setStatus(error.message, true)),
)
$("auto-cancel").addEventListener(
  "click",
  () =>
    void automationAction("QINGSHE_AUTOMATION_CANCEL", "正在取消…")
      .then(() => setStatus("任务已取消"))
      .catch((error) => setStatus(error.message, true)),
)
$("auto-retry").addEventListener(
  "click",
  () =>
    void automationAction("QINGSHE_AUTOMATION_RETRY", "正在重试失败图片…")
      .then(() => setStatus("已重新开始生成"))
      .catch((error) => setStatus(error.message, true)),
)
$("scan").addEventListener("click", () => void scan())
$("select-all").addEventListener("change", (event) => {
  state.selected = event.target.checked ? new Set(state.images.map((image) => image.id)) : new Set()
  render()
})
$("download").addEventListener("click", () => void downloadSelected())
$("zip").addEventListener(
  "click",
  () => void zipSelected().catch((error) => setStatus(error.message, true)),
)
$("send").addEventListener(
  "click",
  () => void sendToPanel().catch((error) => setStatus(error.message, true)),
)
void chrome.storage.local.get("qingsheAutomationConfig").then((stored) => {
  const config = stored.qingsheAutomationConfig
  if (!config) return
  $("auto-provider").value = config.provider || "chatgpt"
  $("auto-prompt").value = config.prompt || ""
  $("auto-count").value = String(config.count || 10)
  $("auto-category").value = config.category || ""
})
void refreshAutomationStatus()
setInterval(() => void refreshAutomationStatus(), 1_000)
