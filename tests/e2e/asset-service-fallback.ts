import type { Page } from "@playwright/test"

export async function useBuiltInAssetFallback(page: Page): Promise<void> {
  await page.route("**/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ status: "degraded" }),
    })
  })
  await page.route("**/assets?*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ assets: null }),
    })
  })
  await page.route("**/events*", async (route) => {
    await route.fulfill({ contentType: "text/event-stream", body: "" })
  })
  await page.route("**/assets/import?*", async (route) => {
    await route.fulfill({ status: 202 })
  })
}
