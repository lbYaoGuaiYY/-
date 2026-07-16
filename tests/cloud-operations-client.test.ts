import { describe, expect, it } from "vitest"

import {
  formatCloudBytes,
  parseCloudClients,
  parseCloudOperationsSummary,
  parseCloudTransfers,
} from "../src/features/asset-admin/cloud-operations-client"

describe("cloud operations client boundary", () => {
  it("parses server capacity, library, client, transfer and control data", () => {
    const summary = parseCloudOperationsSummary({
      status: "ready",
      generated_at: "2026-07-13T00:00:00+00:00",
      uptime_seconds: 3600,
      host: {
        cpu: { count: 1, load_1m: 0.2, load_5m: 0.1, load_15m: 0.1, estimated_usage_percent: 20 },
        memory: { total_bytes: 1024, used_bytes: 512, available_bytes: 512, used_percent: 50 },
        disk: { total_bytes: 4096, used_bytes: 1024, available_bytes: 3072, used_percent: 25 },
        uptime_seconds: 3600,
      },
      library: { total: 8, ready: 6, review: 1, deleted: 1, processing: 0, failed: 0, bytes: 2048 },
      clients: { active_5m: 3, seen_24h: 5 },
      requests: { last_24h: 100, failures_24h: 2, average_duration_ms: 14.2 },
      transfers: { active_downloads: 2, downloads_24h: 30, download_bytes_24h: 3072 },
      controls: {
        maintenance_mode: false,
        downloads_enabled: true,
        max_concurrent_downloads: 8,
        active_downloads: 2,
      },
      alerts: [],
    })

    expect(summary.clients.active_5m).toBe(3)
    expect(summary.host.memory.used_percent).toBe(50)
    expect(summary.controls.downloads_enabled).toBe(true)
    expect(formatCloudBytes(summary.transfers.download_bytes_24h)).toBe("3 KB")
  })

  it("rejects raw client identifiers and malformed transfer windows", () => {
    expect(() =>
      parseCloudClients({
        clients: [
          {
            id: "device-b",
            platform: "windows",
            version: "0.1.0",
            last_seen: "now",
            requests_24h: 1,
            download_bytes_24h: 2,
          },
        ],
      }),
    ).toThrow()
    expect(() => parseCloudTransfers({ windows: [{ downloads: -1 }] })).toThrow()
  })
})
