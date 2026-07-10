import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1280, height: 800 } })

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
  await expect(page.getByTestId("asset-drag-overlay")).toHaveCount(0)
})

async function setImageInput(page: Page): Promise<void> {
  await page.getByTestId("background-file-input").evaluate(async (element) => {
    if (!(element instanceof HTMLInputElement))
      throw new TypeError("image input is not a file input")
    const canvas = document.createElement("canvas")
    canvas.width = 1200
    canvas.height = 800
    const context = canvas.getContext("2d")
    if (context === null) throw new Error("2D canvas is unavailable")
    context.fillStyle = "#e6ded1"
    context.fillRect(0, 0, canvas.width, canvas.height)
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
  })
}
