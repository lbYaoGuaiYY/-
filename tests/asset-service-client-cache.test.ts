import { describe, expect, it, vi } from "vitest"

const kyMock = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock("ky", () => ({
  default: {
    create: () => kyMock,
  },
}))

describe("asset service conditional catalog requests", () => {
  it("reuses a cached page when the service returns 304", async () => {
    const asset = {
      id: "00000000-0000-4000-8000-000000000001",
      code: "QS-000001",
      name: "缓存素材",
      category: "花艺",
      status: "ready",
      mime_type: "image/png",
      width: 320,
      height: 240,
      version: 1,
      needs_review: false,
      favorite: false,
      dominant_color: null,
      tags: ["花艺"],
      usage_count: 0,
      created_at: "2026-07-12T00:00:00+00:00",
      updated_at: "2026-07-12T00:00:00+00:00",
    }
    kyMock.get
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ assets: [asset] }), {
          headers: { ETag: '"catalog-1"', "X-Catalog-Revision": "1" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 304,
          headers: { ETag: '"catalog-1"', "X-Catalog-Revision": "1" },
        }),
      )

    const { listServiceAssetPage } = await import("../src/features/assets/asset-service-client")
    const query = {
      search: "",
      category: "",
      status: "ready",
      needsReview: false,
      limit: 120,
      offset: 0,
    } as const

    const firstPage = await listServiceAssetPage(query)
    const secondPage = await listServiceAssetPage(query)

    expect(secondPage).toEqual(firstPage)
    expect(kyMock.get).toHaveBeenCalledTimes(2)
    expect(kyMock.get.mock.calls[1]?.[1]).toMatchObject({
      headers: { "If-None-Match": '"catalog-1"' },
    })
  })
})
