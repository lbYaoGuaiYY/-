import { expect, type Page, test } from "@playwright/test"

import { useBuiltInAssetFallback } from "./asset-service-fallback"

const BACKGROUND_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 1122, height: 1402 },
})

test.beforeEach(async ({ page }) => useBuiltInAssetFallback(page))

async function importBackground(page: Page): Promise<void> {
  const input = page.getByTestId("background-file-input")
  await input.evaluate((element, encodedImage) => {
    if (!(element instanceof HTMLInputElement))
      throw new TypeError("background file input is required")
    const binaryImage = atob(encodedImage)
    const imageBytes = new Uint8Array(binaryImage.length)
    for (let index = 0; index < binaryImage.length; index += 1)
      imageBytes[index] = binaryImage.charCodeAt(index)
    const files = new DataTransfer()
    files.items.add(new File([imageBytes], "background.png", { type: "image/png" }))
    element.files = files.files
    element.dispatchEvent(new Event("change", { bubbles: true }))
  }, BACKGROUND_PNG_BASE64)
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-background-loaded", "true")
}

test("iPad touch bar keeps materials, layers, delete, and export reachable", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByTestId("editor-shell")).toBeVisible()
  await importBackground(page)

  const tabbar = page.locator(".mobile-tabbar")
  const assetCard = page.getByTestId("asset-card-floral-arch")
  const layer = page.getByTestId("layer-item-floral-arch")

  await expect(tabbar).toBeVisible()
  await tabbar.getByRole("button", { name: "素材", exact: true }).tap()
  await expect(assetCard).toBeVisible()
  await assetCard.tap()
  await expect(tabbar.getByRole("button", { name: "删除所选素材" })).toBeEnabled()

  await tabbar.getByRole("button", { name: "删除所选素材" }).tap()
  await expect(layer).toHaveCount(0)

  await tabbar.getByRole("button", { name: "图层", exact: true }).tap()
  await expect(page.locator(".side-panel-right")).toHaveAttribute("data-panel-mode", "layers")
  await expect(tabbar.getByRole("button", { name: "更多编辑操作" })).toBeVisible()
  await tabbar.getByRole("button", { name: "更多编辑操作" }).tap()
  const moreActions = page.getByRole("dialog", { name: "更多编辑操作" })
  await expect(moreActions).toBeVisible()
  await expect(moreActions.getByRole("button", { name: "导入可编辑项目" })).toBeVisible()
  await expect(moreActions.getByRole("button", { name: "备份可编辑项目" })).toBeVisible()
  await expect(moreActions.getByRole("button", { name: "导出 JPG" })).toBeVisible()
  await moreActions.locator("header").getByRole("button", { name: "关闭更多编辑操作" }).tap()

  await page.getByRole("button", { name: "关闭图层面板" }).tap()
  await tabbar.getByRole("button", { name: "图层", exact: true }).tap()
  await expect(page.locator(".side-panel-right")).toHaveAttribute("data-panel-mode", "layers")

  await tabbar.getByRole("button", { name: "素材", exact: true }).tap()
  await assetCard.tap()
  await tabbar.getByRole("button", { name: "导出", exact: true }).tap()
  await expect(page.getByRole("dialog", { name: "图片已生成" })).toBeVisible()
})

test("iPad panels close by re-tapping the tab or tapping the scrim", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByTestId("editor-shell")).toBeVisible()
  await importBackground(page)

  const tabbar = page.locator(".mobile-tabbar")
  await tabbar.getByRole("button", { name: "素材", exact: true }).tap()
  await expect(page.locator(".side-panel-left")).toHaveClass(/is-open/)
  await expect(page.locator(".panel-scrim")).toBeVisible()

  await page.locator(".panel-scrim").tap({ position: { x: 16, y: 16 } })
  await expect(page.locator(".side-panel-left")).not.toHaveClass(/is-open/)
  await expect(page.locator(".panel-scrim")).toHaveCount(0)

  await tabbar.getByRole("button", { name: "图层", exact: true }).tap()
  await expect(page.locator(".side-panel-right")).toHaveAttribute("data-panel-mode", "layers")
  await tabbar.getByRole("button", { name: "图层", exact: true }).tap()
  await expect(page.locator(".side-panel-right")).toHaveAttribute("data-panel-mode", "closed")
})
