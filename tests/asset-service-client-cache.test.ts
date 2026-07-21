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

  it("forwards a caller AbortSignal to the catalog request", async () => {
    kyMock.get.mockResolvedValueOnce(
      new Response(JSON.stringify({ assets: [] }), {
        headers: { "X-Catalog-Revision": "2" },
      }),
    )
    const { listServiceAssetPage } = await import("../src/features/assets/asset-service-client")
    const controller = new AbortController()

    await listServiceAssetPage(
      {
        search: "signal-test",
        category: "",
        status: "ready",
        needsReview: false,
        limit: 121,
        offset: 0,
      },
      { signal: controller.signal },
    )

    expect(kyMock.get.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal })
  })

  it("does not cache an aborted response", async () => {
    let resolveResponse!: (response: Response) => void
    kyMock.get.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (resolveResponse = resolve)),
    )
    const { listServiceAssetPage } = await import("../src/features/assets/asset-service-client")
    const query = {
      search: "aborted-cache",
      category: "",
      status: "ready",
      needsReview: false,
      limit: 122,
      offset: 0,
    } as const
    const controller = new AbortController()
    const request = listServiceAssetPage(query, { signal: controller.signal })
    controller.abort()
    resolveResponse(
      new Response(JSON.stringify({ assets: [] }), {
        headers: { ETag: '"aborted-etag"', "X-Catalog-Revision": "3" },
      }),
    )
    await expect(request).rejects.toThrow()

    kyMock.get.mockResolvedValueOnce(new Response(JSON.stringify({ assets: [] })))
    await listServiceAssetPage(query)
    expect(kyMock.get.mock.calls.at(-1)?.[1]).not.toMatchObject({
      headers: { "If-None-Match": '"aborted-etag"' },
    })
  })

  it("rejects an aborted signal without relying on throwIfAborted", async () => {
    const { listServiceAssetPage } = await import("../src/features/assets/asset-service-client")
    const controller = new AbortController()
    Object.defineProperty(controller.signal, "throwIfAborted", { value: undefined })
    controller.abort()

    await expect(
      listServiceAssetPage(
        {
          search: "legacy-webkit-abort",
          category: "",
          status: "ready",
          needsReview: false,
          limit: 123,
          offset: 0,
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(kyMock.get).not.toHaveBeenCalled()
  })
})
