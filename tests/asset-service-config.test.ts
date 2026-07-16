import { describe, expect, it } from "vitest"

import {
  createAssetServiceConfig,
  createAssetServiceMediaUrl,
} from "../src/features/assets/asset-service-config"

describe("asset service configuration", () => {
  it("uses the local service when cloud settings are absent", () => {
    // Given: an editor build without cloud environment values.
    const config = createAssetServiceConfig({})

    // When: the client builds a processed-material URL.
    const url = createAssetServiceMediaUrl(config, "asset-id", "processed", 1)

    // Then: the existing local service remains the default and no token leaks into the URL.
    expect(config.baseUrl).toBe("http://127.0.0.1:7000")
    expect(url).toBe("http://127.0.0.1:7000/assets/asset-id/processed?version=1&response_format=3")
  })

  it("adds the editor token only to cloud media URLs", () => {
    // Given: a cloud API URL and its read-only editor token.
    const config = createAssetServiceConfig({
      VITE_ASSET_SERVICE_URL: "https://assets.xiduoduo.top/api/v1/",
      VITE_ASSET_EDITOR_TOKEN: "editor secret",
      VITE_ASSET_SERVICE_EVENTS: "0",
    })

    // When: the client builds a thumbnail URL.
    const url = createAssetServiceMediaUrl(config, "asset-id", "thumbnail", 3)

    // Then: the path is normalized, versioned, and authorized for native image loading.
    expect(config.eventsEnabled).toBe(false)
    expect(url).toBe(
      "https://assets.xiduoduo.top/api/v1/assets/asset-id/thumbnail?version=3&response_format=3&access_token=editor+secret",
    )
  })

  it("rejects a loopback editor endpoint in production", () => {
    expect(() =>
      createAssetServiceConfig({
        VITE_APP_ENV: "production",
        VITE_ASSET_SERVICE_URL: "http://127.0.0.1:7000",
      }),
    ).toThrow("生产素材服务必须使用 https://assets.xiduoduo.top/api/v1")
  })

  it.each([
    "http://191.223.220.201/api/v1",
    "http://xiduoduo.top/api/v1",
    "https://assets.xiduoduo.top/qingshe-assets/api/v1",
    "https://xiduoduo.top/api/v1",
  ])("rejects non-canonical production endpoint %s", (endpoint) => {
    expect(() =>
      createAssetServiceConfig({
        VITE_APP_ENV: "production",
        VITE_ASSET_SERVICE_URL: endpoint,
      }),
    ).toThrow("生产素材服务必须使用 https://assets.xiduoduo.top/api/v1")
  })

  it("accepts only the canonical production endpoint", () => {
    const config = createAssetServiceConfig({
      VITE_APP_ENV: "production",
      VITE_ASSET_SERVICE_URL: "https://assets.xiduoduo.top/api/v1/",
    })

    expect(config.baseUrl).toBe("https://assets.xiduoduo.top/api/v1")
  })
})
