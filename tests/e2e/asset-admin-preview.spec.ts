import { expect, test } from "@playwright/test"

test("submits an imported portrait to the server processing queue", async ({ page }) => {
  let taskRequests = 0
  await routeCloudDashboard(page)
  await page.route("**/admin/processing-tasks", async (route) => {
    taskRequests += 1
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000099" }),
    })
  })

  await page.goto("/asset-admin.html")
  await expect(page.getByRole("heading", { name: "把素材放进云库" })).toBeVisible()
  await page
    .locator('.material-panel__ingest input[type="file"]')
    .first()
    .setInputFiles({
      name: "portrait.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nzsAAAAASUVORK5CYII=",
        "base64",
      ),
    })

  await expect.poll(() => taskRequests).toBe(1)
  await expect(
    page.getByText("已创建 1 个入库任务。轻抠未在线，启动本机轻抠后会自动处理。", {
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "上传原图并抠图" })).toBeEnabled()
})

test("shows cloud control failures without an unhandled rejection", async ({ page }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  await routeCloudDashboard(page)
  await page.route("**/admin/controls", async (route) => {
    await route.fulfill({ status: 500, body: "control unavailable" })
  })
  await page.goto("/asset-admin.html")
  await page.locator(".asset-admin-cloud.is-compact summary").click()

  await page.getByRole("button", { name: "暂停新下载" }).click()

  await expect(page.locator(".asset-admin-cloud__error")).toContainText("500")
  expect(pageErrors).toEqual([])
})

test("shows cloud capacity clients transfers and safe controls", async ({ page }) => {
  await routeCloudDashboard(page)

  await page.goto("/asset-admin.html")
  await page.locator(".asset-admin-cloud.is-compact summary").click()

  await expect(page.getByRole("heading", { name: "云端诊断" })).toBeVisible()
  await expect(page.getByText("内存 62%")).toBeVisible()
  await expect(page.getByText("活跃客户端 3")).toBeVisible()
  await expect(page.getByText("下载中 2")).toBeVisible()
  await expect(page.getByRole("button", { name: "暂停新下载" })).toBeVisible()
})

async function routeCloudDashboard(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/admin/processing-dashboard", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(dashboard()) })
  })
  await page.route("**/admin/observability/summary", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(cloudSummary()) })
  })
}

function dashboard() {
  return { nodes: [], tasks: [], extension_devices: [], automation_runs: [] }
}

function cloudSummary() {
  return {
    status: "ready",
    generated_at: "2026-07-13T00:00:00Z",
    uptime_seconds: 3600,
    host: {
      cpu: { count: 1, load_1m: 0.2, load_5m: 0.1, load_15m: 0.1, estimated_usage_percent: 20 },
      memory: { total_bytes: 1024, used_bytes: 635, available_bytes: 389, used_percent: 62 },
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
  }
}
