import { describe, expect, it } from "vitest"

import {
  type AssetServiceHealth,
  type AssetServiceHealthTracker,
  stabilizeAssetServiceHealth,
} from "../src/features/assets/asset-service-health"

const OFFLINE_SAMPLE = {
  connection: "offline",
  latencyMs: null,
  serviceStatus: null,
} as const satisfies AssetServiceHealth

describe("asset service health stabilization", () => {
  it("treats isolated failures as a slow connection instead of flapping offline", () => {
    let tracker: AssetServiceHealthTracker = {
      consecutiveFailures: 0,
      health: { connection: "online", latencyMs: 420, serviceStatus: "ready" },
    }

    tracker = stabilizeAssetServiceHealth(tracker, OFFLINE_SAMPLE)
    expect(tracker.health?.connection).toBe("slow")
    tracker = stabilizeAssetServiceHealth(tracker, OFFLINE_SAMPLE)
    expect(tracker.health?.connection).toBe("slow")
    tracker = stabilizeAssetServiceHealth(tracker, OFFLINE_SAMPLE)
    expect(tracker.health?.connection).toBe("offline")
  })

  it("recovers immediately after any successful sample", () => {
    const recovered = stabilizeAssetServiceHealth(
      { consecutiveFailures: 2, health: { ...OFFLINE_SAMPLE, connection: "slow" } },
      { connection: "online", latencyMs: 380, serviceStatus: "ready" },
    )

    expect(recovered).toEqual({
      consecutiveFailures: 0,
      health: { connection: "online", latencyMs: 380, serviceStatus: "ready" },
    })
  })
})
