export function startVisibleCatalogPolling(
  check: () => void | Promise<void>,
  intervalMs = 5_000,
): () => void {
  let stopped = false
  let running = false
  const timer = window.setInterval(() => {
    if (stopped || running || document.visibilityState !== "visible") return
    running = true
    void Promise.resolve(check()).finally(() => {
      running = false
    })
  }, intervalMs)
  return () => {
    stopped = true
    window.clearInterval(timer)
  }
}
