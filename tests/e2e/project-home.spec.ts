import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { useBuiltInAssetFallback } from "./asset-service-fallback"

test.beforeEach(async ({ page }) => useBuiltInAssetFallback(page))

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

test("creates two independent local wedding projects and opens them again", async ({ page }) => {
  // Given
  await page.goto("/projects")

  // When
  await page.getByLabel("新项目名称").fill("林先生婚礼方案")
  await page.getByRole("button", { name: "新建项目" }).click()

  // Then
  await expect(page).toHaveURL(/\?project=/)
  await expect(page.getByLabel("项目名称")).toHaveValue("林先生婚礼方案")
  await setBackground(page)
  await page.getByTestId("asset-card-floral-arch").click()
  await expect(page.getByTestId("layer-item-floral-arch")).toHaveCount(1)
  await expect(page.getByRole("status", { name: "项目保存状态" })).toHaveText("已自动保存")

  await page.getByRole("button", { name: "项目列表" }).click()
  await page.getByLabel("新项目名称").fill("陈女士婚礼方案")
  await page.getByRole("button", { name: "新建项目" }).click()
  await expect(page.getByLabel("项目名称")).toHaveValue("陈女士婚礼方案")
  await expect(page.getByTestId("layer-list").locator(".layer-row")).toHaveCount(0)

  await page.getByRole("button", { name: "项目列表" }).click()
  await page.getByRole("button", { name: "打开林先生婚礼方案" }).click()
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-background-loaded", "true")
  await expect(page.getByTestId("layer-item-floral-arch")).toHaveCount(1)
})

test("renames duplicates and deletes a local project from the project list", async ({ page }) => {
  // Given
  await page.goto("/projects")
  await page.getByLabel("新项目名称").fill("待确认方案")
  await page.getByRole("button", { name: "新建项目" }).click()
  await page.getByRole("button", { name: "项目列表" }).click()

  // When
  await page.getByRole("button", { name: "重命名待确认方案" }).click()
  const nameInput = page.getByRole("textbox", { name: "重命名待确认方案" })
  await nameInput.fill("最终婚礼方案")
  await nameInput.press("Enter")

  // Then
  await expect(page.getByRole("button", { name: "打开最终婚礼方案" })).toBeVisible()
  await page.getByRole("button", { name: "复制最终婚礼方案" }).click()
  await expect(page.getByRole("button", { name: "打开最终婚礼方案 副本" })).toBeVisible()
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "删除最终婚礼方案 副本" }).click()
  await expect(page.getByRole("button", { name: "打开最终婚礼方案 副本" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "打开最终婚礼方案" })).toBeVisible()
})

async function setBackground(page: Page): Promise<void> {
  await page.getByTestId("background-file-input").evaluate((element, base64) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new TypeError("background input is not a file input")
    }
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], "venue.png", { type: "image/png" }))
    element.files = transfer.files
    element.dispatchEvent(new Event("change", { bubbles: true }))
  }, PNG_BASE64)
}
