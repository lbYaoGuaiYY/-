import { resolve } from "node:path"
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"
import { useBuiltInAssetFallback } from "./asset-service-fallback"

const auditDirectory = resolve("docs/audits/2026-07-17-final-product")

async function expectNoBlockingAccessibilityViolations(page: import("@playwright/test").Page) {
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()
  const blocking = accessibility.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  )
  expect(blocking, blocking.map((violation) => violation.id).join(", ")).toEqual([])
}

test("captures the accepted 1280px product surfaces", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await useBuiltInAssetFallback(page)
  await page.goto("/")
  await expect(page.getByTestId("editor-shell")).toBeVisible()
  await page
    .getByTestId("background-file-input")
    .setInputFiles(resolve("src/features/assets/media/burgundy-autumn-floral.png"))
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-background-loaded", "true")
  await page.getByTestId("asset-card-floral-arch").click()
  await expect(page.getByTestId("layer-item-floral-arch")).toBeVisible()
  await expect(page.getByRole("status", { name: "项目保存状态" })).toHaveText("已自动保存")
  await expectNoBlockingAccessibilityViolations(page)
  await page.screenshot({ path: resolve(auditDirectory, "17-editor-full-width.png") })

  await page.getByRole("button", { name: "项目列表" }).click()
  await expect(page).toHaveURL(/\/projects/)
  await expect(page.getByRole("heading", { name: "项目" })).toBeVisible()
  await expectNoBlockingAccessibilityViolations(page)
  await page.screenshot({ path: resolve(auditDirectory, "18-projects-full-width.png") })

  const assetPanel = await page.context().newPage()
  await assetPanel.setViewportSize({ width: 1280, height: 800 })
  await assetPanel.route("https://assets.xiduoduo.top/api/v1/admin/processing-dashboard", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "authentication required" }),
    }),
  )
  await assetPanel.goto("/asset-admin.html")
  await expect(assetPanel.locator("main")).toBeVisible()
  await expect(assetPanel.getByRole("button", { name: "登录素材面板" })).toBeEnabled({
    timeout: 10_000,
  })
  await expect(assetPanel.getByRole("status")).not.toHaveText("正在验证登录状态…")
  await expectNoBlockingAccessibilityViolations(assetPanel)
  await assetPanel.screenshot({ path: resolve(auditDirectory, "19-asset-panel-full-width.png") })

  const processor = await page.context().newPage()
  await processor.setViewportSize({ width: 1280, height: 800 })
  await processor.goto("/processor.html")
  await expect(processor.getByRole("heading", { name: "轻抠" })).toBeVisible()
  await expect(processor.getByRole("status")).toHaveText("网页预览：安装版会连接本地处理服务")
  await expectNoBlockingAccessibilityViolations(processor)
  await processor.screenshot({ path: resolve(auditDirectory, "20-processor-full-width.png") })
})
