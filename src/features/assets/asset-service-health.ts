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

export async function readAssetServiceHealth(): Promise<AssetServiceHealth> {
  const startedAt = performance.now()
  try {
    const payload = HealthSchema.parse(
      await ky
        .get(`${ASSET_SERVICE_CONFIG.baseUrl}/health`, {
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
