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

  it("backs off after failures and recovers from a synchronous throw", async () => {
    vi.useFakeTimers()
    const check = vi
      .fn<() => void | Promise<void>>()
      .mockImplementationOnce(() => {
        throw new Error("offline")
      })
      .mockResolvedValue(undefined)

    const stop = startVisibleCatalogPolling(check, 5_000, 20_000)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(check).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(9_999)
    expect(check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(check).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(check).toHaveBeenCalledTimes(3)
    stop()
  })
})
