import { expect, type Page, test } from "@playwright/test"

test("keeps the asset library scrollable in a short desktop window", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 })
  await page.route("http://127.0.0.1:7000/assets?*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        assets: Array.from({ length: 120 }, (_value, index) => serviceAsset(index)),
      }),
    })
  })
  await page.goto("/")

  const scroll = page.locator(".asset-panel__virtual-scroll")
  await expect(scroll).toBeVisible()
  const initial = await scroll.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))

  expect(initial.scrollHeight).toBeGreaterThan(initial.clientHeight)
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
})

test("pans a zoomed canvas with the middle mouse button", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/")
  await importLargeBackground(page)
  await page.getByRole("button", { name: "放大画布" }).click()
  await page.getByRole("button", { name: "放大画布" }).click()

  const scroll = page.locator(".stage-scroll")
  const bounds = await scroll.boundingBox()
  if (bounds === null) throw new TypeError("Expected the canvas scroll container")
  await expect
    .poll(() => scroll.evaluate((element) => element.scrollWidth > element.clientWidth))
    .toBe(true)

  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down({ button: "middle" })
  await page.mouse.move(bounds.x + bounds.width / 2 - 140, bounds.y + bounds.height / 2 - 90)
  await page.mouse.up({ button: "middle" })

  await expect
    .poll(() =>
      scroll.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop })),
    )
    .toEqual(expect.objectContaining({ left: expect.any(Number), top: expect.any(Number) }))
  const position = await scroll.evaluate((element) => ({
    left: element.scrollLeft,
    top: element.scrollTop,
  }))
  expect(position.left + position.top).toBeGreaterThan(0)
})

async function importLargeBackground(page: Page): Promise<void> {
  const input = page.getByTestId("background-file-input")
  await input.evaluate(async (element) => {
    if (!(element instanceof HTMLInputElement)) throw new TypeError("Expected a background input")
    const canvas = document.createElement("canvas")
    canvas.width = 2400
    canvas.height = 1600
    const context = canvas.getContext("2d")
    if (context === null) throw new TypeError("Expected a 2D canvas context")
    context.fillStyle = "#805A46"
    context.fillRect(0, 0, canvas.width, canvas.height)
    const image = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value === null) reject(new TypeError("Expected a PNG blob"))
        else resolve(value)
      }, "image/png")
    })
    const files = new DataTransfer()
    files.items.add(new File([image], "large-background.png", { type: "image/png" }))
    element.files = files.files
    element.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-background-loaded", "true")
}

function serviceAsset(index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    code: `QS-${String(index + 1).padStart(6, "0")}`,
    name: `素材 ${index + 1}`,
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
