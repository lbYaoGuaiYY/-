import { expect, test } from "@playwright/test"

const REVIEW_ASSET_ID = "00000000-0000-4000-8000-000000000777"
const APPROVED_ASSET_ID = "00000000-0000-4000-8000-000000000778"

test("editor requests only approved catalog assets", async ({ page }) => {
  // Given
  const reviewFilters: string[] = []
  await page.route("http://127.0.0.1:7000/assets?*", async (route) => {
    const url = new URL(route.request().url())
    const reviewFilter = url.searchParams.get("needs_review") ?? ""
    reviewFilters.push(reviewFilter)
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        assets:
          reviewFilter === "0"
            ? [serviceAsset(APPROVED_ASSET_ID, "已审核素材", "家具", false)]
            : [serviceAsset(REVIEW_ASSET_ID, "待检查素材", "其他", true)],
      }),
    })
  })

  // When
  await page.goto("/")

  // Then
  await expect(page.getByTestId(`asset-card-${APPROVED_ASSET_ID}`)).toBeVisible()
  await expect(page.getByTestId(`asset-card-${REVIEW_ASSET_ID}`)).toHaveCount(0)
  expect(reviewFilters).toContain("0")
})

test("server panel confirms reviewed assets in their current category", async ({ page }) => {
  let reviewResolved = false
  const patches: unknown[] = []
  await page.route("**/admin/processing-dashboard", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        nodes: [],
        tasks: reviewResolved ? [] : [reviewTask()],
        extension_devices: [],
        automation_runs: [],
      }),
    })
  })
  await page.route("**/admin/observability/summary", async (route) => {
    await route.fulfill({ status: 503, body: "not needed for this flow" })
  })
  await page.route(`**/admin/assets/${REVIEW_ASSET_ID}`, async (route) => {
    patches.push(await route.request().postDataJSON())
    reviewResolved = true
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ updated: true }),
    })
  })
  await page.goto("/asset-admin.html")

  await expect(page.getByRole("heading", { name: "待检查" })).toBeVisible()
  await expect(page.getByLabel("待检查素材 分类")).toHaveValue("其他")
  await page.getByRole("button", { name: "确认入库", exact: true }).click()

  expect(patches).toEqual([{ category: "其他", needs_review: false }])
  await expect(page.getByText("暂无待检查素材", { exact: true })).toBeVisible()
})

function reviewTask() {
  return {
    id: "00000000-0000-4000-8000-000000000776",
    name: "待检查素材",
    category: "其他",
    needs_review: true,
    status: "ready",
    node_id: null,
    asset_id: REVIEW_ASSET_ID,
    error: null,
    created_at: "2026-07-11T00:00:00+00:00",
    updated_at: "2026-07-11T00:00:00+00:00",
  }
}

function serviceAsset(id: string, name: string, category: string, needsReview: boolean) {
  return {
    id,
    code: id === REVIEW_ASSET_ID ? "QS-000777" : "QS-000778",
    name,
    category,
    status: "ready",
    mime_type: "image/png",
    width: 400,
    height: 300,
    version: 1,
    needs_review: needsReview,
    favorite: false,
    dominant_color: null,
    tags: [category],
    usage_count: 0,
    created_at: "2026-07-11T00:00:00+00:00",
    updated_at: "2026-07-11T00:00:00+00:00",
  }
}
