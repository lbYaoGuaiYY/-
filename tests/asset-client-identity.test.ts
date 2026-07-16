import { describe, expect, it } from "vitest"

import {
  type AssetClientIdentity,
  createAssetClientHeaders,
  getAssetClientIdentity,
} from "../src/features/assets/asset-client-identity"

describe("asset client identity", () => {
  it("persists one anonymous device identifier without using user data", () => {
    const storage = new Map<string, string>()
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    }
    const first = getAssetClientIdentity(adapter, () => "8f03cde7-3d26-4a41-a245-42fb6a358e81")
    const second = getAssetClientIdentity(adapter, () => "replaced-id")

    expect(first.id).toBe("8f03cde7-3d26-4a41-a245-42fb6a358e81")
    expect(second.id).toBe(first.id)
  })

  it("creates the telemetry headers expected by the cloud API", () => {
    const identity: AssetClientIdentity = {
      id: "8f03cde7-3d26-4a41-a245-42fb6a358e81",
      platform: "macos",
      version: "0.1.0",
    }

    expect(createAssetClientHeaders(identity)).toEqual({
      "X-Qingshe-Client": "8f03cde7-3d26-4a41-a245-42fb6a358e81",
      "X-Qingshe-Platform": "macos",
      "X-Qingshe-Version": "0.1.0",
    })
  })
})
