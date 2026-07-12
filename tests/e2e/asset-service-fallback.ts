import type { Page } from "@playwright/test"

export async function useBuiltInAssetFallback(page: Page): Promise<void> {
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
