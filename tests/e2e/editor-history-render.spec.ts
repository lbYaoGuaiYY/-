import { expect, test } from "@playwright/test"

import { useBuiltInAssetFallback } from "./asset-service-fallback"

test.beforeEach(async ({ page }) => useBuiltInAssetFallback(page))

test("keeps the background painted throughout undo and redo", async ({ page }) => {
  // Given
  await page.goto("/")
  const input = page.getByTestId("background-file-input")
  await input.evaluate(async (element) => {
    if (!(element instanceof HTMLInputElement)) throw new TypeError("Expected a file input")
    const source = document.createElement("canvas")
    source.width = 2400
    source.height = 1600
    const context = source.getContext("2d")
    if (context === null) throw new TypeError("Expected a 2D canvas context")
    context.fillStyle = "#c68f62"
    context.fillRect(0, 0, source.width, source.height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      source.toBlob((next) =>
        next === null ? reject(new TypeError("PNG creation failed")) : resolve(next),
      )
    })
    const files = new DataTransfer()
    files.items.add(new File([blob], "large-background.png", { type: "image/png" }))
    element.files = files.files
    element.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-background-loaded", "true")
  await page.getByTestId("asset-card-floral-arch").click()
  await expect(page.getByTestId("layer-item-floral-arch")).toBeVisible()

  // When
  const opacityFrames = page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.lower-canvas")
    if (canvas === null) throw new TypeError("Expected Fabric's lower canvas")
    const context = canvas.getContext("2d")
    if (context === null) throw new TypeError("Expected the lower canvas context")
    const frames: number[] = []
    const deadline = performance.now() + 1200
    await new Promise<void>((resolve) => {
      const sample = () => {
        frames.push(context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[3] ?? 0)
        if (performance.now() >= deadline) {
          resolve()
          return
        }
        window.requestAnimationFrame(sample)
      }
      window.requestAnimationFrame(sample)
    })
    return frames
  })
  await page.getByRole("button", { name: "撤销", exact: true }).click()
  await expect(page.getByTestId("layer-item-floral-arch")).toHaveCount(0)
  await page.getByRole("button", { name: "重做", exact: true }).click()
  await expect(page.getByTestId("layer-item-floral-arch")).toBeVisible()

  // Then
  expect(await opacityFrames).not.toContain(0)
})
