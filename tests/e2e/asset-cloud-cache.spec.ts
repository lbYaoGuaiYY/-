import { expect, test } from "@playwright/test"

const ASSET_ID = "00000000-0000-4000-8000-000000000777"
const TEST_IMAGE_PATH = "src/features/assets/media/burgundy-autumn-floral.png"

test("keeps a cloud asset usable after the catalog becomes unavailable", async ({ page }) => {
  // Given
  let online = true
  let processedRequests = 0
  await page.route("http://127.0.0.1:7000/assets?*", async (route) => {
    if (!online) {
      await route.abort("failed")
      return
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ assets: [serviceAsset()] }),
    })
  })
  await page.route(`http://127.0.0.1:7000/assets/${ASSET_ID}/processed?*`, async (route) => {
    processedRequests += 1
    await route.fulfill({ contentType: "image/png", path: TEST_IMAGE_PATH })
  })
  await page.route(`http://127.0.0.1:7000/assets/${ASSET_ID}/thumbnail?*`, async (route) => {
    await route.fulfill({ contentType: "image/png", path: TEST_IMAGE_PATH })
  })
  await page.goto("/")
  const asset = page.getByTestId(`asset-card-${ASSET_ID}`)
  await expect(asset).toBeVisible()
  await asset.click()
  await expect(page.getByTestId("layer-list").locator(".layer-row")).toHaveCount(1)

  // When
  online = false
  await page.reload()

  // Then
  await expect(asset).toBeVisible()
  await asset.click()
  await expect(page.getByTestId("layer-list").locator(".layer-row")).toHaveCount(1)
  expect(processedRequests).toBe(1)
})

test("keeps a current project material after pinning it in offline management", async ({
  page,
}) => {
  // Given
  await page.route("http://127.0.0.1:7000/assets?*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ assets: [serviceAsset()] }),
    })
  })
  await page.route(`http://127.0.0.1:7000/assets/${ASSET_ID}/processed?*`, async (route) => {
    await route.fulfill({ contentType: "image/png", path: TEST_IMAGE_PATH })
  })
  await page.route(`http://127.0.0.1:7000/assets/${ASSET_ID}/thumbnail?*`, async (route) => {
    await route.fulfill({ contentType: "image/png", path: TEST_IMAGE_PATH })
  })
  await page.goto("/")
  await page.getByTestId(`asset-card-${ASSET_ID}`).click()
  await expect(page.getByTestId("layer-list").locator(".layer-row")).toHaveCount(1)

  // When
  await page.getByRole("button", { name: "离线素材管理" }).click()
  const dialog = page.getByRole("dialog", { name: "离线素材管理" })
  await expect(dialog).toContainText("云端缓存测试花艺")
  await dialog.getByRole("button", { name: "固定当前项目素材" }).click()

  // Then
  await expect(dialog.getByRole("button", { name: "清理未固定缓存" })).toBeDisabled()
  await expect(dialog).toContainText("云端缓存测试花艺")
})

function serviceAsset() {
  return {
    id: ASSET_ID,
    code: "QS-000777",
    name: "云端缓存测试花艺",
    category: "花艺",
    status: "ready",
    mime_type: "image/png",
    width: 400,
    height: 300,
    version: 1,
    needs_review: false,
    favorite: false,
    dominant_color: null,
    tags: ["花艺"],
    usage_count: 0,
    created_at: "2026-07-11T00:00:00+00:00",
    updated_at: "2026-07-11T00:00:00+00:00",
  }
}
