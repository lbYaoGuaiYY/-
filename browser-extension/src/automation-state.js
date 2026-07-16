;(function defineAutomationState(scope) {
  function nextAutomationState(state, event) {
    const items = Array.isArray(state.items) ? state.items.map((item) => ({ ...item })) : []
    const itemIndex = items.findIndex((item) => item.id === event.itemId)
    const next = { ...state, items, updatedAt: new Date().toISOString() }
    if (event.type === "RUN_SYNC" && event.run) return { ...state, ...event.run }
    if (event.type === "RUN_CANCELLED") return { ...next, status: "cancelled" }
    if (itemIndex < 0) return next
    if (event.type === "ITEM_STARTED") {
      items[itemIndex] = { ...items[itemIndex], status: "generating", error: null }
      next.status = "running"
      next.currentOrdinal = items[itemIndex].ordinal
    } else if (event.type === "IMAGE_FOUND") {
      items[itemIndex] = { ...items[itemIndex], status: "uploading", error: null }
    } else if (event.type === "IMAGE_UPLOADED") {
      items[itemIndex] = { ...items[itemIndex], status: "processing", error: null }
      const queued = items.find((item) => item.status === "queued")
      next.currentOrdinal = queued?.ordinal ?? null
      next.status = "running"
    } else if (event.type === "ITEM_FAILED") {
      items[itemIndex] = {
        ...items[itemIndex],
        status: "failed",
        error: event.error || "生成失败",
      }
      next.status = "failed"
      next.error = event.error || "生成失败"
    } else if (event.type === "ITEM_RETRY") {
      items[itemIndex] = { ...items[itemIndex], status: "queued", error: null }
      next.status = "running"
      next.error = null
      next.currentOrdinal = items[itemIndex].ordinal
    }
    return next
  }

  function activeAutomationItem(state) {
    if (!Array.isArray(state?.items)) return null
    return (
      state.items.find((item) => item.ordinal === state.currentOrdinal) ??
      state.items.find((item) => item.status === "queued") ??
      null
    )
  }

  scope.QingsheAutomationState = { activeAutomationItem, nextAutomationState }
})(globalThis)
