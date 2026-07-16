import { afterEach, describe, expect, it, vi } from "vitest"

import { startVisibleCatalogPolling } from "../src/features/assets/catalog-refresh-scheduler"

describe("visible catalog polling", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("checks twice in ten seconds while the editor is visible", async () => {
    vi.useFakeTimers()
    const check = vi.fn().mockResolvedValue(undefined)

    const stop = startVisibleCatalogPolling(check, 5_000)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(check).toHaveBeenCalledTimes(2)
    stop()
  })

  it("does not poll while the editor document is hidden", async () => {
    vi.useFakeTimers()
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
    const check = vi.fn().mockResolvedValue(undefined)

    const stop = startVisibleCatalogPolling(check, 5_000)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(check).not.toHaveBeenCalled()
    stop()
  })
})
