import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { useBuiltInAssetFallback } from "./asset-service-fallback"

test.beforeEach(async ({ page }) => useBuiltInAssetFallback(page))

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

test("restores one complete active project after reload", async ({ page }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  await page.goto("/")

  await setImageInput(page, "background-file-input", "background.png")
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-background-loaded", "true")
  await page.getByTestId("asset-card-floral-arch").click()
  await page.getByRole("button", { name: "奶油花艺拱门", exact: true }).click()
  await page.getByLabel("旋转 (°)", { exact: true }).fill("37")
  await expect(page.getByLabel("旋转 (°)", { exact: true })).toHaveValue("37")
  await expect(page.getByRole("status", { name: "项目保存状态" })).toHaveText("保存中…")
  await expect(page.getByRole("status", { name: "项目保存状态" })).toHaveText("已自动保存")

  await page.reload()

  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-background-loaded", "true")
  await expect(page.getByTestId("layer-list")).toContainText("奶油花艺拱门")
  await page.getByRole("button", { name: "奶油花艺拱门", exact: true }).click()
  await expect(page.getByLabel("旋转 (°)", { exact: true })).toHaveValue("37")
  await expect(page.getByRole("button", { name: "撤销", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "重做", exact: true })).toBeDisabled()

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出 PNG", exact: true }).click(),
  ])
  expect(await download.failure()).toBeNull()
  expect(pageErrors).toEqual([])
})

test("uses editor copy commands and keeps the pasted layer after reload", async ({ page }) => {
  await page.goto("/")
  await setImageInput(page, "background-file-input", "background.png")
  await page.getByTestId("asset-card-floral-arch").click()

  await page.getByRole("button", { name: "奶油花艺拱门", exact: true }).click({
    button: "right",
  })
  await expect(page.getByTestId("layer-context-menu")).toBeVisible()
  await page.screenshot({ path: "test-results/layer-context-menu.png" })
  await page.getByRole("menuitem", { name: "复制", exact: true }).click()
  await page.keyboard.press("Control+V")

  await expect(page.getByRole("button", { name: "奶油花艺拱门 副本", exact: true })).toBeVisible()
  await expect(page.getByRole("status", { name: "项目保存状态" })).toHaveText("已自动保存")
  await page.reload()
  await expect(page.getByRole("button", { name: "奶油花艺拱门 副本", exact: true })).toBeVisible()
})

test("recovers from one transient IndexedDB project write failure", async ({ page }) => {
  // Given
  await page.addInitScript(() => {
    const originalPut = IDBObjectStore.prototype.put
    let failNextProjectWrite = true
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey): IDBRequest {
      if (this.name === "projects" && failNextProjectWrite) {
        failNextProjectWrite = false
        throw new DOMException("Transient IndexedDB write failure", "UnknownError")
      }
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key)
    }
  })
  await page.goto("/")

  // When
  await page.getByTestId("asset-card-floral-arch").click()

  // Then
  await expect(page.getByRole("status", { name: "项目保存状态" })).toHaveText("已自动保存")
  await page.reload()
  await expect(page.getByRole("button", { name: "奶油花艺拱门", exact: true })).toBeVisible()
})

async function setImageInput(page: Page, testId: string, name: string): Promise<void> {
  await page.getByTestId(testId).evaluate(
    (element, fileData) => {
      if (!(element instanceof HTMLInputElement))
        throw new TypeError("image input is not a file input")
      const binary = atob(fileData.base64)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], fileData.name, { type: "image/png" }))
      element.files = transfer.files
      element.dispatchEvent(new Event("change", { bubbles: true }))
    },
    { base64: PNG_BASE64, name },
  )
}

test("rejects a corrupt draft without partially restoring it", async ({ page }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  await page.goto("/")
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("qingshe-projects-v1")
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains("projects")) database.createObjectStore("projects")
        if (!database.objectStoreNames.contains("assets")) database.createObjectStore("assets")
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction(["projects", "assets"], "readwrite")
        transaction.onerror = () => reject(transaction.error)
        transaction.oncomplete = () => {
          database.close()
          resolve()
        }
        transaction.objectStore("projects").put(
          {
            schemaVersion: 1,
            updatedAt: 10,
            document: {
              canvasSize: { width: 1200, height: 800 },
              backgroundAssetId: "local:missing",
              layers: [],
            },
          },
          "active",
        )
      }
    })
  })

  await page.reload()

  await expect(page.getByRole("status", { name: "项目保存状态" })).toHaveText("恢复失败")
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-background-loaded", "false")
  await expect(page.getByTestId("layer-list")).toHaveCount(0)
  expect(pageErrors).toEqual([])
})
