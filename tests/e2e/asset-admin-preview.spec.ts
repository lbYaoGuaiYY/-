import { expect, test } from "@playwright/test"

test("submits an imported portrait to the local processing queue", async ({ page }) => {
  let importRequests = 0
  await page.route("http://127.0.0.1:7000/assets?*", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ assets: [] }) })
  })
  await page.route("http://127.0.0.1:7000/jobs", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ jobs: [] }) })
  })
  await page.route("http://127.0.0.1:7000/events", async (route) => {
    await route.fulfill({ contentType: "text/event-stream", body: "" })
  })
  await page.route("http://127.0.0.1:7000/assets/import?*", async (route) => {
    importRequests += 1
    await route.fulfill({ status: 201 })
  })

  await page.goto("/asset-admin.html")
  await page.getByTestId("asset-admin-file-input").evaluate(async (element) => {
    if (!(element instanceof HTMLInputElement)) throw new TypeError("Expected a file input")

    const canvas = document.createElement("canvas")
    canvas.width = 400
    canvas.height = 800
    const context = canvas.getContext("2d")
    if (context === null) throw new TypeError("Expected a 2D canvas context")
    context.fillStyle = "#A11D33"
    context.fillRect(0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value === null) reject(new TypeError("Expected a PNG blob"))
        else resolve(value)
      }, "image/png")
    })
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], "portrait.png", { type: "image/png" }))
    element.files = transfer.files
    element.dispatchEvent(new Event("change", { bubbles: true }))
  })

  await expect(
    page.getByText("已加入 1 张图片；处理完成后会自动出现。", { exact: true }),
  ).toBeVisible()
  expect(importRequests).toBe(1)
  await expect(page.getByRole("button", { name: "选择一张或多张原始图片" })).toBeEnabled()
})

test("shows maintenance failures without an unhandled rejection", async ({ page }) => {
  // Given
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  await page.route("http://127.0.0.1:7000/assets?*", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ assets: [] }) })
  })
  await page.route("http://127.0.0.1:7000/jobs", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ jobs: [] }) })
  })
  await page.route("http://127.0.0.1:7000/events", async (route) => {
    await route.fulfill({ contentType: "text/event-stream", body: "" })
  })
  await page.route("http://127.0.0.1:7000/maintenance/backup", async (route) => {
    await route.fulfill({ status: 500, body: "backup unavailable" })
  })
  await page.goto("/asset-admin.html")

  // When
  await page.locator(".asset-admin-maintenance-actions button").first().click()

  // Then
  await expect(page.locator(".asset-admin-note")).toContainText("目录备份失败")
  expect(pageErrors).toEqual([])
})
