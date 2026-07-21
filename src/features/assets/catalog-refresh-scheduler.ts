export function startVisibleCatalogPolling(
  check: () => void | Promise<void>,
  intervalMs = 15_000,
  maxIntervalMs = 60_000,
): () => void {
  let stopped = false
  const baseInterval = Math.max(1, intervalMs)
  const maximumInterval = Math.max(baseInterval, maxIntervalMs)
  let nextInterval = baseInterval
  let timer: number | null = null

  const schedule = (): void => {
    if (stopped) return
    timer = window.setTimeout(async () => {
      if (document.visibilityState !== "visible") {
        nextInterval = baseInterval
        schedule()
        return
      }
      try {
        await check()
        nextInterval = baseInterval
      } catch {
        nextInterval = Math.min(maximumInterval, nextInterval * 2)
      } finally {
        schedule()
      }
    }, nextInterval)
  }

  schedule()
  return () => {
    stopped = true
    if (timer !== null) window.clearTimeout(timer)
  }
}
