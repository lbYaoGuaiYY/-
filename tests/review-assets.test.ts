import { describe, expect, it } from "vitest"

import { parseRemoteProcessingDashboard } from "../src/features/asset-admin/remote-processing-client"

describe("review-only admin assets", () => {
  it("parses explicit pending review assets without manufacturing a task", () => {
    const dashboard = parseRemoteProcessingDashboard({
      nodes: [],
      tasks: [],
      pending_review_assets: [
        {
          id: "00000000-0000-4000-8000-000000000777",
          code: "QS-000777",
          name: "review-only",
          category: "鍏朵粬",
          status: "ready",
          mime_type: "image/png",
          width: 4,
          height: 3,
          version: 1,
          needs_review: 1,
          favorite: 0,
          dominant_color: null,
          tags: ["鍏朵粬"],
          usage_count: 0,
          created_at: "2026-07-21T08:00:00+00:00",
          updated_at: "2026-07-21T08:00:00+00:00",
        },
      ],
    })

    expect(dashboard.tasks).toEqual([])
    expect(dashboard.pending_review_assets[0]).toMatchObject({
      id: "00000000-0000-4000-8000-000000000777",
      needs_review: true,
      favorite: false,
    })
  })

  it("keeps older dashboard payloads compatible", () => {
    expect(parseRemoteProcessingDashboard({ nodes: [], tasks: [] }).pending_review_assets).toEqual(
      [],
    )
  })
})
