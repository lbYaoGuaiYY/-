import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const listPage = vi.fn()
  const saveCatalog = vi.fn()
  const readProcessed = vi.fn()
  const listCatalog = vi.fn()
  class MockCloudAssetCache {
    saveCatalog = saveCatalog
    readProcessed = readProcessed
    listCatalog = listCatalog
  }
  return { listCatalog, listPage, MockCloudAssetCache, readProcessed, saveCatalog }
})

vi.mock("../src/features/assets/asset-service-client", () => ({
  ASSET_PAGE_SIZE: 120,
  getServiceCatalogRevision: vi.fn(),
  listServiceAssetPage: mocks.listPage,
  serviceAssetMediaUrl: vi.fn(
    (assetId: string, kind: string, version: number) =>
      `https://assets.example.test/${assetId}/${kind}?version=${version}`,
  ),
  subscribeToAssetEvents: vi.fn(() => () => undefined),
  throwIfAssetRequestAborted: (signal: AbortSignal | undefined) => {
    if (signal?.aborted !== true) return
    throw signal.reason ?? new DOMException("The operation was aborted", "AbortError")
  },
}))
vi.mock("../src/features/assets/cloud-asset-cache", () => ({
  CloudAssetCache: mocks.MockCloudAssetCache,
}))
vi.mock("../src/features/assets/catalog-refresh-scheduler", () => ({
  startVisibleCatalogPolling: vi.fn(() => () => undefined),
}))
vi.mock("../src/features/assets/managed-asset-store", () => ({
  ManagedAssetStore: class {
    list = vi.fn().mockResolvedValue([])
  },
}))

import {
  ASSET_SEARCH_DEBOUNCE_MS,
  useManagedAssets,
} from "../src/features/assets/use-managed-assets"

const INITIAL_QUERY = { search: "", category: "" as const }

function asset(name: string) {
  return {
    id: `00000000-0000-4000-8000-${name === "first" ? "000000000001" : "000000000002"}`,
    code: name,
    name,
    category: "其他" as const,
    status: "ready",
    mime_type: "image/png",
    width: 320,
    height: 240,
    version: 1,
    needs_review: false,
    favorite: false,
    dominant_color: null,
    tags: [],
    usage_count: 0,
    created_at: "2026-07-21T00:00:00Z",
    updated_at: "2026-07-21T00:00:00Z",
  }
}

function page(name: string) {
  return { assets: [asset(name)], hasMore: false, revision: "1" }
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  mocks.listPage.mockReset()
  mocks.saveCatalog.mockReset().mockResolvedValue(undefined)
  mocks.readProcessed.mockReset().mockResolvedValue(new Map())
  mocks.listCatalog.mockReset().mockRejectedValue(new Error("cache unavailable"))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("useManagedAssets", () => {
  it("keeps online assets ready when catalog or processed cache persistence fails", async () => {
    mocks.listPage.mockResolvedValue(page("online"))
    mocks.saveCatalog.mockRejectedValue(new Error("quota exceeded"))
    mocks.readProcessed.mockRejectedValue(new Error("cache is corrupt"))

    const { result } = renderHook(() => useManagedAssets(INITIAL_QUERY))
    await flushAsyncWork()

    expect(result.current.status).toBe("ready")
    expect(result.current.assets.map((item) => item.name)).toEqual(["online"])
    expect(result.current.hasMore).toBe(false)
  })

  it("debounces rapid searches and ignores a stale page after the latest result", async () => {
    vi.useFakeTimers()
    mocks.listPage.mockResolvedValueOnce(page("initial"))
    const first = deferred<ReturnType<typeof page>>()
    const second = deferred<ReturnType<typeof page>>()
    mocks.listPage.mockImplementation(({ search }: { search: string }) => {
      if (search === "first") return first.promise
      if (search === "second") return second.promise
      return Promise.resolve(page("initial"))
    })

    const { result, rerender } = renderHook(
      ({ search }: { search: string }) => useManagedAssets({ search, category: "" }),
      { initialProps: { search: "" } },
    )
    await flushAsyncWork()
    mocks.listPage.mockClear()

    rerender({ search: "first" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(249)
    })
    expect(mocks.listPage).not.toHaveBeenCalled()

    rerender({ search: "second" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(249)
    })
    expect(mocks.listPage).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(mocks.listPage).toHaveBeenCalledTimes(1)
    expect(mocks.listPage.mock.calls[0]?.[0]).toMatchObject({ search: "second" })

    second.resolve(page("second"))
    await flushAsyncWork()
    expect(result.current.assets.map((item) => item.name)).toEqual(["second"])

    first.resolve(page("first"))
    await flushAsyncWork()
    expect(result.current.assets.map((item) => item.name)).toEqual(["second"])
  })

  it("clears a superseded pagination state when the catalog refreshes", async () => {
    mocks.listPage.mockResolvedValueOnce({ ...page("first"), hasMore: true })
    const pagination = deferred<ReturnType<typeof page>>()

    const { result } = renderHook(() => useManagedAssets(INITIAL_QUERY))
    await flushAsyncWork()
    mocks.listPage.mockImplementation(({ offset }: { offset: number }) =>
      offset > 0 ? pagination.promise : Promise.resolve(page("second")),
    )

    act(() => result.current.loadMore())
    expect(result.current.isLoadingMore).toBe(true)

    act(() => result.current.refresh())
    await flushAsyncWork()
    expect(result.current.isLoadingMore).toBe(false)
    expect(result.current.status).toBe("ready")
    expect(result.current.assets.map((item) => item.name)).toEqual(["second"])

    pagination.resolve(page("first"))
    await flushAsyncWork()
    expect(result.current.isLoadingMore).toBe(false)
    expect(result.current.assets.map((item) => item.name)).toEqual(["second"])
  })

  it("aborts a superseded query before starting the latest page request", async () => {
    vi.useFakeTimers()
    const first = deferred<ReturnType<typeof page>>()
    const second = deferred<ReturnType<typeof page>>()
    mocks.listPage.mockImplementation(({ search }: { search: string }) => {
      if (search === "first") return first.promise
      if (search === "second") return second.promise
      return Promise.resolve(page("initial"))
    })

    const { result, rerender } = renderHook(
      ({ search }: { search: string }) => useManagedAssets({ search, category: "" }),
      { initialProps: { search: "" } },
    )
    await flushAsyncWork()

    rerender({ search: "first" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ASSET_SEARCH_DEBOUNCE_MS)
    })
    expect(mocks.listPage).toHaveBeenCalledWith(
      expect.objectContaining({ search: "first" }),
      expect.any(Object),
    )
    rerender({ search: "second" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ASSET_SEARCH_DEBOUNCE_MS - 1)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    const firstCall = mocks.listPage.mock.calls.find((call) => call[0]?.search === "first") as
      | [unknown, { signal: AbortSignal }]
      | undefined
    const secondCall = mocks.listPage.mock.calls.find((call) => call[0]?.search === "second") as
      | [unknown, { signal: AbortSignal }]
      | undefined
    expect(firstCall?.[1].signal.aborted).toBe(true)
    expect(secondCall?.[1].signal.aborted).toBe(false)

    second.resolve(page("second"))
    await flushAsyncWork()
    first.resolve(page("first"))
    await flushAsyncWork()
    expect(result.current.assets.map((item) => item.name)).toEqual(["second"])
  })

  it("aborts the active first-page request on refresh and unmount", async () => {
    const pending = deferred<ReturnType<typeof page>>()
    mocks.listPage.mockReturnValue(pending.promise)
    const { result, unmount } = renderHook(() => useManagedAssets(INITIAL_QUERY))
    await flushAsyncWork()
    const initialCall = mocks.listPage.mock.calls[0] as
      | [unknown, { signal: AbortSignal }]
      | undefined
    expect(initialCall?.[1].signal.aborted).toBe(false)

    act(() => result.current.refresh())
    await flushAsyncWork()
    expect(initialCall?.[1].signal.aborted).toBe(true)
    const refreshedCall = mocks.listPage.mock.calls[1] as
      | [unknown, { signal: AbortSignal }]
      | undefined
    expect(refreshedCall?.[1].signal.aborted).toBe(false)

    unmount()
    expect(refreshedCall?.[1].signal.aborted).toBe(true)
    pending.resolve(page("stale"))
    await flushAsyncWork()
  })
})

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}
