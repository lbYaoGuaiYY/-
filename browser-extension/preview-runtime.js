if (typeof globalThis.chrome?.runtime?.sendMessage !== "function") {
  const previewConfig = {
    provider: "chatgpt",
    prompt: "白色背景的现代婚礼迎宾花艺，主体完整，正面视角",
    count: 10,
    category: "花艺",
  }
  const previewItems = Array.from({ length: 10 }, (_, index) => ({
    id: `preview-item-${index + 1}`,
    ordinal: index + 1,
    status: index < 4 ? "ready" : index === 4 ? "uploading" : "queued",
  }))
  let previewRun = {
    id: "preview-run",
    ...previewConfig,
    status: "running",
    items: previewItems,
  }
  const localState = { qingsheAutomationConfig: previewConfig }
  const previewImages = [
    {
      id: "preview-floral",
      source: "/src/features/assets/media/burgundy-autumn-floral.png",
      preview: "/src/features/assets/media/burgundy-autumn-floral.png",
      alt: "酒红色秋季花艺",
      width: 1216,
      height: 862,
      filename: "01-酒红色秋季花艺.png",
    },
  ]

  globalThis.chrome = {
    ...(globalThis.chrome || {}),
    runtime: {
      async sendMessage(message) {
        if (message?.type === "QINGSHE_AUTOMATION_STATUS") {
          return {
            ok: true,
            paired: true,
            connectionStatus: "online",
            state: previewRun,
          }
        }
        if (message?.type === "QINGSHE_AUTOMATION_START") {
          previewRun = { ...previewRun, ...message.config, status: "running" }
          return { ok: true, state: previewRun }
        }
        if (message?.type === "QINGSHE_AUTOMATION_CANCEL") {
          previewRun = { ...previewRun, status: "cancelled" }
          return { ok: true, state: previewRun }
        }
        if (message?.type === "QINGSHE_AUTOMATION_RETRY") {
          previewRun = { ...previewRun, status: "running" }
          return { ok: true, state: previewRun }
        }
        return { ok: true }
      },
    },
    storage: {
      local: {
        async get(key) {
          return typeof key === "string" ? { [key]: localState[key] } : { ...localState }
        },
        async set(value) {
          Object.assign(localState, value)
        },
      },
    },
    tabs: {
      async query() {
        return [{ id: 1, url: "https://chatgpt.com/c/qingshe-preview", title: "ChatGPT" }]
      },
      async sendMessage(_tabId, message) {
        return message?.type === "QINGSHE_SCAN" ? { images: previewImages } : { ok: true }
      },
    },
    scripting: { async executeScript() {} },
  }
}
