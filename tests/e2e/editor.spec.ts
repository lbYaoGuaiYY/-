import AxeBuilder from "@axe-core/playwright"
import type { Locator, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { useBuiltInAssetFallback } from "./asset-service-fallback"

/**
 * Implementation contract for the editor surface:
 * - `editor-shell`: visible root of the application.
 * - `background-file-input`: an `<input type="file">` accepting PNG/JPEG/WebP.
 * - `editor-canvas`: visible canvas wrapper; after import it exposes
 *   `data-background-loaded="true"`.
 * - `asset-card-floral-arch`: button-like built-in asset named “奶油花艺拱门”.
 * - `asset-panel-toggle`: always-reachable control for the asset panel/drawer.
 * - `layer-list` and `layer-item-floral-arch`: observable layer state.
 * - Action buttons use the exact accessible names “导入底图”, “撤销”, “重做”,
 *   “删除所选素材”, and “导出 PNG”.
 */

const BACKGROUND_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
const FLORAL_ARCH_LAYER_ID = "layer-item-floral-arch"

type ViewportCase = {
  readonly height: number
  readonly name: string
  readonly width: number
}

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet portrait", width: 768, height: 1024 },
] as const satisfies readonly ViewportCase[]

test.beforeEach(async ({ page }) => useBuiltInAssetFallback(page))

async function openEditor(page: Page): Promise<void> {
  await page.goto("/")
  await expect(page.getByTestId("editor-shell")).toBeVisible()
}

async function importBackground(page: Page): Promise<void> {
  const input = page.getByTestId("background-file-input")

  await input.evaluate((element, encodedImage) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new TypeError("background-file-input must be an HTML input")
    }

    const binaryImage = atob(encodedImage)
    const imageBytes = new Uint8Array(binaryImage.length)
    for (let index = 0; index < binaryImage.length; index += 1) {
      imageBytes[index] = binaryImage.charCodeAt(index)
    }

    const files = new DataTransfer()
    files.items.add(new File([imageBytes], "background.png", { type: "image/png" }))
    element.files = files.files
    element.dispatchEvent(new Event("change", { bubbles: true }))
  }, BACKGROUND_PNG_BASE64)

  await expect(page.getByTestId("editor-canvas")).toHaveAttribute(
    "data-background-loaded",
    "true",
    { timeout: 10_000 },
  )
}

async function addFloralArch(page: Page): Promise<void> {
  await page.getByTestId("asset-card-floral-arch").click()
  await expect(floralArchLayer(page)).toBeVisible()
}

function floralArchLayer(page: Page): Locator {
  return page.getByTestId(FLORAL_ARCH_LAYER_ID)
}

test.describe("editor acceptance contract", () => {
  test("uses the neutral charcoal workspace theme", async ({ page }) => {
    await openEditor(page)
    const theme = await page.locator(":root").evaluate((node) => {
      const style = getComputedStyle(node)
      return {
        app: style.getPropertyValue("--surface-app").trim(),
        panel: style.getPropertyValue("--surface-panel").trim(),
        selected: style.getPropertyValue("--surface-selected").trim(),
      }
    })

    expect(theme).toEqual({ app: "#161616", panel: "#252525", selected: "#3f3f3f" })
  })

  test("keeps material ingestion out of the editor surface", async ({ page }) => {
    // Given: the ordinary editor build is opened for a planner.
    await openEditor(page)

    // When: the planner inspects the material panel.

    // Then: the panel offers ready materials only, not the internal ingestion action.
    await expect(page.getByRole("button", { name: "导入素材入库", exact: true })).toHaveCount(0)
  })

  test("loads without browser console or page errors", async ({ page }) => {
    // Given: mutable event buffers collect browser diagnostics for this navigation.
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text())
      }
    })
    page.on("pageerror", (error) => pageErrors.push(error.message))

    // When
    await page.goto("/")

    // Then
    await expect(page.getByTestId("editor-shell")).toBeVisible()
    expect(consoleErrors, "browser console errors").toEqual([])
    expect(pageErrors, "uncaught page errors").toEqual([])
  })

  test("shows a loaded canvas when a background is imported", async ({ page }) => {
    // Given
    await openEditor(page)

    // When
    await importBackground(page)

    // Then
    await expect(page.getByTestId("editor-canvas")).toBeVisible()
  })

  test("adds the built-in floral arch to the layer list", async ({ page }) => {
    // Given
    await openEditor(page)
    await importBackground(page)

    // When
    await page.getByTestId("asset-card-floral-arch").click()

    // Then
    await expect(floralArchLayer(page)).toBeVisible()
    await expect(page.getByRole("button", { name: "删除所选素材", exact: true })).toBeEnabled()
  })

  test("undoes the latest asset addition", async ({ page }) => {
    // Given
    await openEditor(page)
    await importBackground(page)
    await addFloralArch(page)

    // When
    await page.getByRole("button", { name: "撤销", exact: true }).click()

    // Then
    await expect(floralArchLayer(page)).toHaveCount(0)
    await expect(page.getByRole("button", { name: "重做", exact: true })).toBeEnabled()
  })

  test("redoes an undone asset addition", async ({ page }) => {
    // Given
    await openEditor(page)
    await importBackground(page)
    await addFloralArch(page)
    await page.getByRole("button", { name: "撤销", exact: true }).click()

    // When
    await page.getByRole("button", { name: "重做", exact: true }).click()

    // Then
    await expect(floralArchLayer(page)).toBeVisible()
  })

  test("deletes the selected built-in asset", async ({ page }) => {
    // Given
    await openEditor(page)
    await importBackground(page)
    await addFloralArch(page)

    // When
    await page.getByRole("button", { name: "删除所选素材", exact: true }).click()

    // Then
    await expect(floralArchLayer(page)).toHaveCount(0)
  })

  test("applies a side view preset and restores the front view with undo", async ({ page }) => {
    // Given
    await openEditor(page)
    await importBackground(page)
    await addFloralArch(page)

    // When
    await page.getByRole("button", { name: "右侧视图", exact: true }).click()

    // Then
    await expect(page.getByRole("button", { name: "右侧视图", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )

    // When
    await page.getByRole("button", { name: "撤销", exact: true }).click()
    await floralArchLayer(page).locator(".layer-select").click()

    // Then
    await expect(page.getByRole("button", { name: "正面视图", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
  })

  test("clamps numeric inspector values to their declared bounds", async ({ page }) => {
    // Given
    await openEditor(page)
    await importBackground(page)
    await addFloralArch(page)
    const numberInputs = page.locator('input[type="number"]')
    const scale = numberInputs.nth(2)
    const opacity = numberInputs.nth(4)

    // When
    await scale.fill("600")
    await opacity.fill("-20")

    // Then
    await expect(scale).toHaveValue("500")
    await expect(opacity).toHaveValue("0")
  })

  test("downloads a PNG export", async ({ page }) => {
    // Given
    await openEditor(page)
    await importBackground(page)
    await addFloralArch(page)

    // When
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "导出 PNG", exact: true }).click(),
    ])

    // Then
    expect(download.suggestedFilename()).toMatch(/\.png$/i)
    expect(await download.failure()).toBeNull()
  })

  test("downloads a JPG export", async ({ page }) => {
    // Given
    await openEditor(page)
    await importBackground(page)
    await page.getByRole("combobox", { name: "导出图片格式" }).selectOption("jpeg")

    // When
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "导出 JPG", exact: true }).click(),
    ])

    // Then
    expect(download.suggestedFilename()).toMatch(/\.jpg$/i)
    expect(await download.failure()).toBeNull()
  })

  for (const viewport of VIEWPORTS) {
    test(`keeps critical operations reachable at ${viewport.name}`, async ({ page }) => {
      // Given
      await page.setViewportSize({ width: viewport.width, height: viewport.height })

      // When
      await openEditor(page)
      await importBackground(page)

      // Then
      const criticalControls = [
        page.getByRole("button", { name: "导入底图", exact: true }),
        page.getByTestId("asset-panel-toggle"),
        page.getByRole("button", { name: "导出 PNG", exact: true }),
        page.getByTestId("editor-canvas"),
      ]
      for (const control of criticalControls) {
        await expect(control).toBeVisible()
        await expect(control).toBeInViewport({ ratio: 0.5 })
      }
    })
  }

  test("keeps the desktop canvas visible while toggling the asset panel", async ({ page }) => {
    // Given
    await page.setViewportSize({ width: 1280, height: 800 })
    await openEditor(page)
    const assetPanel = page.locator(".side-panel-left")
    const toggle = page.getByTestId("asset-panel-toggle")
    const readLayout = () =>
      page.locator(".workspace").evaluate((workspace) => {
        const assets = workspace.querySelector(".side-panel-left")
        const canvas = workspace.querySelector(".canvas-column")
        const inspector = workspace.querySelector(".side-panel-right")
        if (
          !(assets instanceof HTMLElement) ||
          !(canvas instanceof HTMLElement) ||
          !(inspector instanceof HTMLElement)
        ) {
          throw new TypeError("desktop workspace panels must be HTML elements")
        }

        const canvasRect = canvas.getBoundingClientRect()
        const inspectorRect = inspector.getBoundingClientRect()
        return {
          assetDisplay: getComputedStyle(assets).display,
          canvasLeft: canvasRect.left,
          canvasRight: canvasRect.right,
          canvasWidth: canvasRect.width,
          inspectorLeft: inspectorRect.left,
          inspectorRight: inspectorRect.right,
        }
      })
    const openLayout = await readLayout()

    // When
    await toggle.click()
    await expect(assetPanel).toBeHidden()
    const closedLayout = await readLayout()
    await toggle.click()
    await expect(assetPanel).toBeVisible()
    const reopenedLayout = await readLayout()

    // Then
    expect(closedLayout.assetDisplay).toBe("none")
    expect(closedLayout.canvasLeft).toBeCloseTo(0, 5)
    expect(closedLayout.canvasWidth).toBeGreaterThan(openLayout.canvasWidth)
    expect(closedLayout.inspectorLeft).toBeCloseTo(closedLayout.canvasRight, 5)
    expect(closedLayout.inspectorRight).toBeCloseTo(1280, 5)
    expect(reopenedLayout).toEqual(openLayout)
  })

  test("has no critical or serious automated accessibility violations", async ({ page }) => {
    // Given
    await openEditor(page)
    await importBackground(page)
    await addFloralArch(page)

    // When
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze()

    // Then
    const blockingViolations = accessibility.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    )
    expect(blockingViolations).toEqual([])
  })
})
