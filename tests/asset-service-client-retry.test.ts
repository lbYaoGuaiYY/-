import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe("asset service transient retry", () => {
  it("retries one transient 502 before returning the catalog page", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("upstream restarting", { status: 502 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ assets: [] }), {
          headers: { "Content-Type": "application/json", "X-Catalog-Revision": "14" },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    const { listServiceAssetPage } = await import("../src/features/assets/asset-service-client")
    const page = await listServiceAssetPage({
      search: "",
      category: "",
      status: "ready",
      needsReview: false,
      limit: 120,
      offset: 0,
    })

    expect(page).toEqual({ assets: [], hasMore: false, revision: "14" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
