import { describe, expect, it } from "vitest"

import { isCloudAutoSyncCandidate } from "../src/features/assets/asset-cloud-client"

describe("cloud auto sync eligibility", () => {
  it("syncs an approved ready asset but keeps review assets local", () => {
    // Given: one ready asset and one asset that still needs an operator review.
    const approved = { status: "ready", needs_review: false }
    const pendingReview = { status: "ready", needs_review: true }

    // When: the asset administration flow decides whether to publish automatically.

    // Then: only the approved in-library asset is published.
    expect(isCloudAutoSyncCandidate(approved)).toBe(true)
    expect(isCloudAutoSyncCandidate(pendingReview)).toBe(false)
  })
})
