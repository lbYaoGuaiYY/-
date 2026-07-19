import { describe, expect, it } from "vitest"
import {
  assetAdminCloudBaseUrl,
  OFFICIAL_ASSET_ADMIN_API_URL,
} from "../src/features/asset-admin/asset-admin-config"

describe("asset admin cloud configuration", () => {
  it("uses the official API without embedding an administrator token in production", () => {
    expect(assetAdminCloudBaseUrl({ VITE_APP_ENV: "production" })).toBe(
      OFFICIAL_ASSET_ADMIN_API_URL,
    )
  })

  it("allows an explicit local API only outside production", () => {
    expect(
      assetAdminCloudBaseUrl({
        VITE_APP_ENV: "development",
        VITE_ASSET_CLOUD_URL: "http://127.0.0.1:7000/api/v1/",
      }),
    ).toBe("http://127.0.0.1:7000/api/v1")
  })
})
