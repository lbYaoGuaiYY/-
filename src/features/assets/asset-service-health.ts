import ky from "ky"
import { z } from "zod"

import { ASSET_SERVICE_CONFIG } from "./asset-service-config"

const HealthSchema = z.object({ status: z.enum(["ready", "degraded", "maintenance"]) })

export type AssetServiceConnection = "offline" | "online" | "slow"

export type AssetServiceHealth = {
  readonly connection: AssetServiceConnection
  readonly latencyMs: number | null
  readonly serviceStatus: "degraded" | "maintenance" | "ready" | null
}

export type AssetServiceHealthTracker = {
  readonly consecutiveFailures: number
  readonly health: AssetServiceHealth | null
}

export const ASSET_SERVICE_OFFLINE_CONFIRMATIONS = 3

export function stabilizeAssetServiceHealth(
  current: AssetServiceHealthTracker,
  sample: AssetServiceHealth,
  offlineConfirmations = ASSET_SERVICE_OFFLINE_CONFIRMATIONS,
): AssetServiceHealthTracker {
  if (sample.connection !== "offline") {
    return { consecutiveFailures: 0, health: sample }
  }

  const consecutiveFailures = current.consecutiveFailures + 1
  if (consecutiveFailures >= Math.max(1, offlineConfirmations)) {
    return { consecutiveFailures, health: sample }
  }

  return {
    consecutiveFailures,
    health: {
      connection: "slow",
      latencyMs: current.health?.latencyMs ?? null,
      serviceStatus: current.health?.serviceStatus ?? null,
    },
  }
}

export async function readAssetServiceHealth(signal?: AbortSignal): Promise<AssetServiceHealth> {
  const startedAt = performance.now()
  try {
    const payload = HealthSchema.parse(
      await ky
        .get(`${ASSET_SERVICE_CONFIG.baseUrl}/health`, {
          ...(signal === undefined ? {} : { signal }),
          retry: {
            limit: 1,
            methods: ["get"],
            statusCodes: [408, 425, 429, 500, 502, 503, 504],
          },
          timeout: 5_000,
        })
        .json(),
    )
    const latencyMs = Math.round(performance.now() - startedAt)
    return {
      connection: latencyMs >= 1_200 || payload.status !== "ready" ? "slow" : "online",
      latencyMs,
      serviceStatus: payload.status,
    }
  } catch {
    return { connection: "offline", latencyMs: null, serviceStatus: null }
  }
}
