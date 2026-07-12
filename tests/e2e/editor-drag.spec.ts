import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { useBuiltInAssetFallback } from "./asset-service-fallback"

test.use({ viewport: { width: 1280, height: 800 } })
test.beforeEach(async ({ page }) => useBuiltInAssetFallback(page))

test("drags a wedding asset from the panel onto the canvas", async ({ page }) => {
  // Given
  await page.goto("/")
  await setImageInput(page)
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-background-loaded", "true")
  const asset = page.getByTestId("asset-card-floral-arch")
  const canvas = page.getByTestId("editor-canvas")
  const assetBox = await asset.boundingBox()
  const canvasBox = await canvas.boundingBox()
  if (assetBox === null || canvasBox === null) throw new Error("Drag targets must be visible")

  // When
  await page.mouse.move(assetBox.x + assetBox.width / 2, assetBox.y + assetBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(assetBox.x + assetBox.width / 2 + 12, assetBox.y + assetBox.height / 2, {
    steps: 4,
  })
  await expect(page.getByTestId("asset-drag-overlay")).toBeVisible()
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2, {
    steps: 12,
  })
  await page.mouse.up()

  // Then
  await expect(page.getByTestId("layer-list")).toContainText("奶油花艺拱门")
  await expect(page.getByTestId("layer-item-floral-arch")).toHaveCount(1)
  await expect(page.getByTestId("asset-drag-overlay")).toHaveCount(0)
})

test("selects multiple canvas layers with the built-in marquee", async ({ page }) => {
  // Given
  await page.goto("/")
  await setImageInput(page)
  await page.getByTestId("asset-card-floral-arch").click()
  await page.getByTestId("asset-card-flower-column").click()
  const canvas = page.locator("canvas.upper-canvas")
  const canvasBox = await canvas.boundingBox()
  if (canvasBox === null) throw new Error("Fabric canvas must be visible")

  // When
  await page.mouse.move(canvasBox.x + 80, canvasBox.y + 80)
  await page.mouse.down()
  await page.mouse.move(canvasBox.x + canvasBox.width - 80, canvasBox.y + canvasBox.height - 80, {
    steps: 8,
  })
  await page.mouse.up()

  // Then
  const selectedRows = page.getByTestId("layer-list").locator(".layer-row.is-selected")
  await expect(selectedRows).toHaveCount(2)
  await expect(page.getByRole("heading", { name: /图层/ })).toContainText("已选 2")
  await expect(page.getByRole("button", { name: "删除所选素材" })).toBeEnabled()
  await page.screenshot({ path: "test-results/multi-select.png", fullPage: true })

  await page.keyboard.press("Control+C")
  await page.keyboard.press("Control+V")
  await expect(page.getByTestId("layer-list").locator(".layer-row")).toHaveCount(4)
  await expect(selectedRows).toHaveCount(2)
  await page.keyboard.press("Control+Z")
  await expect(page.getByTestId("layer-list").locator(".layer-row")).toHaveCount(2)

  await page.getByTestId("layer-item-floral-arch").locator(".layer-select").click()
  await page
    .getByTestId("layer-item-flower-column")
    .locator(".layer-select")
    .click({ modifiers: ["Control"] })
  await page.keyboard.press("Control+D")
  await expect(page.getByTestId("layer-list").locator(".layer-row")).toHaveCount(4)
  await expect(selectedRows).toHaveCount(2)
  await page.keyboard.press("Delete")
  await expect(page.getByTestId("layer-list").locator(".layer-row")).toHaveCount(2)
})

test("aligns multiple layers from the existing editor toolbar", async ({ page }) => {
  await page.goto("/")
  await setImageInput(page)
  await page.getByTestId("asset-card-floral-arch").click()
  await page.getByTestId("asset-card-flower-column").click()

  await page.getByLabel("X", { exact: true }).fill("820")
  await page.getByTestId("layer-item-floral-arch").locator(".layer-select").click()
  await page
    .getByTestId("layer-item-flower-column")
    .locator(".layer-select")
    .click({ modifiers: ["Control"] })

  const alignCenter = page.getByRole("button", { name: "水平居中" })
  await expect(alignCenter).toBeEnabled()
  await alignCenter.click()
  await expect(page.getByTestId("layer-list").locator(".layer-row.is-selected")).toHaveCount(2)
  await page.waitForTimeout(200)
  await page.screenshot({ path: "test-results/alignment-toolbar-active.png", fullPage: true })

  await page.getByTestId("layer-item-floral-arch").locator(".layer-select").click()
  const firstX = await page.getByLabel("X", { exact: true }).inputValue()
  await page.getByTestId("layer-item-flower-column").locator(".layer-select").click()
  const secondX = await page.getByLabel("X", { exact: true }).inputValue()
  expect(secondX).toBe(firstX)
})

test("flips every selected layer from the multi-selection inspector", async ({ page }) => {
  // Given
  await page.goto("/")
  await setImageInput(page)
  await page.getByTestId("asset-card-floral-arch").click()
  await page.getByTestId("asset-card-flower-column").click()
  await page.getByTestId("layer-item-floral-arch").locator(".layer-select").click()
  await page
    .getByTestId("layer-item-flower-column")
    .locator(".layer-select")
    .click({ modifiers: ["Control"] })

  // When
  await page.getByRole("button", { name: "批量水平翻转" }).click()

  // Then
  await expect(page.getByTestId("layer-list").locator(".layer-row.is-selected")).toHaveCount(2)
  await page.getByTestId("layer-item-floral-arch").locator(".layer-select").click()
  await expect(page.getByRole("button", { name: "水平翻转" })).toHaveClass(/is-active/)
  await page.getByTestId("layer-item-flower-column").locator(".layer-select").click()
  await expect(page.getByRole("button", { name: "水平翻转" })).toHaveClass(/is-active/)
})

test("copies and pastes a selected canvas object from its context menu", async ({ page }) => {
  // Given
  await page.goto("/")
  await setImageInput(page)
  await page.getByTestId("asset-card-floral-arch").click()
  const canvas = page.locator("canvas.upper-canvas")

  // When
  await canvas.click({ button: "right", position: { x: 600, y: 400 } })
  await expect(page.getByTestId("layer-context-menu")).toBeVisible()
  await page.getByRole("menuitem", { name: "复制", exact: true }).click()
  await canvas.click({ position: { x: 312, y: 208 } })
  await page.keyboard.press("Control+V")

  // Then
  await expect(page.getByTestId("layer-list").locator(".layer-row")).toHaveCount(2)
})

test("copies and pastes a selected canvas object with keyboard shortcuts", async ({ page }) => {
  // Given
  await page.goto("/")
  await setImageInput(page)
  await page.getByTestId("asset-card-floral-arch").click()
  const canvas = page.locator("canvas.upper-canvas")

  // When
  await canvas.click({ position: { x: 312, y: 208 } })
  await page.keyboard.press("Control+C")
  await page.keyboard.press("Control+V")

  // Then
  await expect(page.getByTestId("layer-list").locator(".layer-row")).toHaveCount(2)
})

test("snaps a dragged layer to the canvas center", async ({ page }) => {
  await page.goto("/")
  await setImageInput(page)
  await page.getByTestId("asset-card-floral-arch").click()
  await page.getByLabel("X", { exact: true }).fill("500")

  const canvas = page.locator("canvas.upper-canvas")
  const canvasBox = await canvas.boundingBox()
  if (canvasBox === null) throw new Error("Fabric canvas must be visible")
  const start = {
    x: canvasBox.x + (500 / 1200) * canvasBox.width,
    y: canvasBox.y + canvasBox.height / 2,
  }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + (96 / 1200) * canvasBox.width, start.y, { steps: 8 })
  await page.mouse.up()

  await expect(page.getByLabel("X", { exact: true })).toHaveValue("600")
})

test("places and cancels an asset with the keyboard", async ({ page }) => {
  // Given
  await page.goto("/")
  await setImageInput(page)
  const asset = page.getByTestId("asset-card-floral-arch")
  await asset.focus()
  await expect(page.getByText(/焦点位于婚礼素材时，按空格键或回车键拿起素材/)).toHaveCount(1)

  // When cancelling
  await page.keyboard.press("Space")
  await expect(page.getByTestId("asset-drag-overlay")).toBeVisible()
  await page.keyboard.press("Escape")

  // Then cancellation is clean
  await expect(page.getByTestId("asset-drag-overlay")).toHaveCount(0)
  await expect(page.getByTestId("layer-item-floral-arch")).toHaveCount(0)
  await expect(asset).toBeFocused()

  // When placing
  await page.keyboard.press("Space")
  await page.keyboard.press("ArrowRight")
  await expect(page.getByTestId("editor-canvas")).toHaveClass(/is-drop-target/)
  await page.keyboard.press("Space")

  // Then
  await expect(page.getByTestId("layer-item-floral-arch")).toHaveCount(1)
  await expect(page.getByTestId("asset-drag-overlay")).toHaveCount(0)
})

test("keeps touch scrolling usable and supports long-press placement", async ({ page }) => {
  await page.goto("/")
  await setImageInput(page)
  const asset = page.getByTestId("asset-card-floral-arch")
  const canvas = page.getByTestId("editor-canvas")
  const assetBox = await asset.boundingBox()
  const canvasBox = await canvas.boundingBox()
  if (assetBox === null || canvasBox === null) throw new Error("Touch targets must be visible")
  const start = { x: assetBox.x + assetBox.width / 2, y: assetBox.y + assetBox.height / 2 }
  const client = await page.context().newCDPSession(page)
  await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 })

  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] })
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: start.x, y: start.y + 32 }],
  })
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await expect(page.getByTestId("asset-drag-overlay")).toHaveCount(0)
  await expect(page.getByTestId("layer-item-floral-arch")).toHaveCount(0)

  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] })
  await page.waitForTimeout(220)
  await expect(page.getByTestId("asset-drag-overlay")).toBeVisible()
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 }],
  })
  await expect(canvas).toHaveClass(/is-drop-target/)
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })

  await expect(page.getByTestId("layer-item-floral-arch")).toHaveCount(1)
  await expect(page.getByTestId("asset-drag-overlay")).toHaveCount(0)
  await client.detach()
})

test("reorders layers from the panel and round-trips undo", async ({ page }) => {
  await page.goto("/")
  await setImageInput(page)
  await page.getByTestId("asset-card-floral-arch").click()
  await expect(page.getByTestId("layer-item-floral-arch")).toHaveCount(1)
  await page.getByTestId("asset-card-flower-column").click()
  await expect(page.getByTestId("layer-item-flower-column")).toHaveCount(1)
  await page.getByTestId("asset-card-welcome-sign").click()
  await expect(page.getByTestId("layer-item-welcome-sign")).toHaveCount(1)
  const rows = page.getByTestId("layer-list").locator(":scope > li")
  await expect(rows).toHaveText([/木质迎宾牌/, /柔粉花柱/, /奶油花艺拱门/])

  const sourceBox = await page.getByTestId("layer-sort-handle-floral-arch").boundingBox()
  const targetBox = await page.getByTestId("layer-item-welcome-sign").boundingBox()
  if (sourceBox === null || targetBox === null)
    throw new Error("Layer sort targets must be visible")
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 10,
  })
  await page.mouse.up()

  await expect(rows).toHaveText([/奶油花艺拱门/, /木质迎宾牌/, /柔粉花柱/])
  await page.getByRole("button", { name: "撤销" }).click()
  await expect(rows).toHaveText([/木质迎宾牌/, /柔粉花柱/, /奶油花艺拱门/])
  await page.getByRole("button", { name: "重做" }).click()
  await expect(rows).toHaveText([/奶油花艺拱门/, /木质迎宾牌/, /柔粉花柱/])
})

test("shows layer thumbnails and enforces visibility and lock state", async ({ page }) => {
  await page.goto("/")
  await setImageInput(page)
  await page.getByTestId("asset-card-floral-arch").click()
  const row = page.getByTestId("layer-item-floral-arch")
  await expect(row.locator(".layer-thumbnail img")).toHaveCount(1)

  await page.getByRole("button", { name: "锁定奶油花艺拱门" }).click()
  await expect(row).toHaveClass(/is-locked/)
  await expect(page.getByTestId("layer-sort-handle-floral-arch")).toBeDisabled()
  await expect(page.getByLabel("X", { exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "解锁奶油花艺拱门" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )

  await page.getByRole("button", { name: "解锁奶油花艺拱门" }).click()
  await expect(page.getByLabel("X", { exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "隐藏奶油花艺拱门" }).click()
  await expect(row).toHaveClass(/is-hidden/)
  await expect(page.getByLabel("X", { exact: true })).toBeDisabled()

  await page.getByRole("button", { name: "撤销" }).click()
  await expect(page.getByRole("button", { name: "隐藏奶油花艺拱门" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
})

test("routes phone assets, layers, and properties to distinct panels", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto("/")
  await setImageInput(page)

  await page.getByRole("button", { name: "素材", exact: true }).click()
  const assetPanel = page.locator(".side-panel-left")
  await expect(assetPanel).toHaveClass(/is-open/)
  await page.getByTestId("asset-card-floral-arch").click()
  await expect(assetPanel).not.toHaveClass(/is-open/)

  await page.getByRole("button", { name: "图层", exact: true }).click()
  const rightPanel = page.locator(".side-panel-right")
  await expect(rightPanel).toHaveAttribute("data-panel-mode", "layers")
  await expect(page.getByTestId("layer-item-floral-arch")).toHaveCount(1)
  await expect(page.getByRole("heading", { name: /图层/ })).toBeVisible()
  await expect(page.getByRole("heading", { name: "属性", exact: true })).toHaveCount(0)

  await page.getByRole("button", { name: "属性", exact: true }).click()
  await expect(rightPanel).toHaveAttribute("data-panel-mode", "properties")
  await expect(page.getByRole("heading", { name: "属性", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: /图层/ })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

async function setImageInput(page: Page, fillColor: string | null = "#e6ded1"): Promise<void> {
  await page.getByTestId("background-file-input").evaluate(async (element, fillColor) => {
    if (!(element instanceof HTMLInputElement))
      throw new TypeError("image input is not a file input")
    const canvas = document.createElement("canvas")
    canvas.width = 1200
    canvas.height = 800
    const context = canvas.getContext("2d")
    if (context === null) throw new Error("2D canvas is unavailable")
    if (fillColor !== null) {
      context.fillStyle = fillColor
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value === null) reject(new Error("Failed to create test venue image"))
        else resolve(value)
      }, "image/png")
    })
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], "venue.png", { type: "image/png" }))
    element.files = transfer.files
    element.dispatchEvent(new Event("change", { bubbles: true }))
  }, fillColor)
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute(
    "data-background-loaded",
    "true",
    { timeout: 10_000 },
  )
}
