import { expect, test } from "@playwright/test"

test("renders the desktop handbook outline and responsive mobile selector", async ({ page }) => {
  await page.goto("/manual.html#ipad")
  await expect(page.getByRole("heading", { name: "轻设产品说明书", exact: true })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "说明书大纲" })).toBeVisible()
  await expect(page.locator("#ipad h2")).toHaveText("iPad 版")

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator(".manual-mobile-header select")).toBeVisible()
  const layout = await page.locator("body").evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)
})

test("keeps the handbook vertically scrollable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 })
  await page.goto("/manual.html")

  const scrollState = await page.locator("body").evaluate(() => ({
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
    bodyOverflowY: getComputedStyle(document.body).overflowY,
  }))

  expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight)
  expect(scrollState.bodyOverflowY).toBe("auto")
})
