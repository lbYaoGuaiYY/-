import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { useBuiltInAssetFallback } from "./asset-service-fallback"

const TEST_ASSET_CARD = "asset-card-refresh-test"
const REFRESH_SERVICE_ASSET_ID = "00000000-0000-4000-8000-000000000999"

test("queries the local catalog by asset code from the editor", async ({ page }) => {
  // Given
  const requests: string[] = []
  await page.route("http://127.0.0.1:7000/assets?*", async (route) => {
    const url = new URL(route.request().url())
    const query = url.searchParams.get("query") ?? ""
    requests.push(query)
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        assets:
          query === "QS-000123"
            ? [serviceAsset("00000000-0000-4000-8000-000000000123", "编号命中素材", "花艺")]
            : [],
      }),
    })
  })
  await page.goto("/")

  // When
  await page.getByRole("searchbox", { name: "搜索素材" }).fill("QS-000123")

  // Then
  await expect(page.getByTestId("asset-card-00000000-0000-4000-8000-000000000123")).toBeVisible()
  expect(requests).toContain("QS-000123")
})

test("filters the local catalog by category from the editor", async ({ page }) => {
  // Given
  await page.route("http://127.0.0.1:7000/assets?*", async (route) => {
    const url = new URL(route.request().url())
    const category = url.searchParams.get("category") ?? ""
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        assets:
          category === "家具"
            ? [serviceAsset("00000000-0000-4000-8000-000000000456", "分类命中素材", "家具")]
            : [],
      }),
    })
  })
  await page.goto("/")

  // When
  await page.getByLabel("素材分类").selectOption("家具")

  // Then
  await expect(page.getByTestId("asset-card-00000000-0000-4000-8000-000000000456")).toBeVisible()
})

test("loads the next catalog page only after the user asks for more", async ({ page }) => {
  // Given
  const offsets: string[] = []
  await page.route("http://127.0.0.1:7000/assets?*", async (route) => {
    const url = new URL(route.request().url())
    const limit = Number(url.searchParams.get("limit") ?? "0")
    const offset = Number(url.searchParams.get("offset") ?? "0")
    offsets.push(String(offset))
    const count = offset === 0 ? limit : 1
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        assets: Array.from({ length: count }, (_value, index) =>
          serviceAsset(
            `00000000-0000-4000-8000-${String(offset + index + 1).padStart(12, "0")}`,
            `分页素材 ${offset + index + 1}`,
            "花艺",
          ),
        ),
      }),
    })
  })
  await page.goto("/")

  // When
  await page.getByRole("button", { name: "加载更多素材" }).click()

  // Then
  await expect(page.getByTestId("asset-card-00000000-0000-4000-8000-000000000121")).toBeVisible()
  expect(offsets).toEqual(["0", "120"])
})

test("refreshes newly managed assets without reloading the editor", async ({ page }) => {
  let assetReady = false
  await page.route("http://127.0.0.1:7000/assets?*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        assets: assetReady ? [serviceAsset(REFRESH_SERVICE_ASSET_ID, "刷新测试素材", "家具")] : [],
      }),
    })
  })
  await page.goto("/")
  assetReady = true

  await page.getByRole("button", { name: "刷新素材库", exact: true }).click()

  await expect(page.getByTestId(`asset-card-${REFRESH_SERVICE_ASSET_ID}`)).toBeVisible()
})

test("automatically shows a completed processing result while the editor stays open", async ({
  page,
}) => {
  await page.clock.install()
  let revision = 1
  let assetReady = false
  await page.route("http://127.0.0.1:7000/catalog/revision", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ revision }),
    })
  })
  await page.route("http://127.0.0.1:7000/assets?*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: { "X-Catalog-Revision": String(revision) },
      body: JSON.stringify({
        assets: assetReady ? [serviceAsset(REFRESH_SERVICE_ASSET_ID, "自动入库素材", "花艺")] : [],
      }),
    })
  })
  await page.goto("/")
  await expect(page.getByTestId(`asset-card-${REFRESH_SERVICE_ASSET_ID}`)).toBeHidden()

  revision = 2
  assetReady = true
  await page.clock.fastForward(5_100)

  await expect(page.getByTestId(`asset-card-${REFRESH_SERVICE_ASSET_ID}`)).toBeVisible()
  await expect(page.getByText("自动入库素材", { exact: true })).toBeVisible()
})

test("keeps existing managed thumbnails stable while refreshing", async ({ page }) => {
  // Given
  await page.route("http://127.0.0.1:7000/assets?*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        assets: [serviceAsset(REFRESH_SERVICE_ASSET_ID, "刷新测试素材", "家具")],
      }),
    })
  })
  await page.goto("/")
  const refresh = page.getByTestId("asset-library-refresh")
  const image = page.getByTestId(`asset-card-${REFRESH_SERVICE_ASSET_ID}`).locator("img")
  await expect(image).toBeVisible()
  const sourceBeforeRefresh = await image.getAttribute("src")
  await refresh.evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) throw new TypeError("Expected refresh button")
    let sawDisabled = false
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.oldValue === null)) sawDisabled = true
      if (!sawDisabled || element.disabled) return
      const refreshedImage = document.querySelector<HTMLImageElement>(
        '[data-testid="asset-card-00000000-0000-4000-8000-000000000999"] img',
      )
      element.setAttribute("data-preview-source-after", refreshedImage?.src ?? "missing")
      element.setAttribute("data-refresh-cycle", "complete")
      observer.disconnect()
    })
    observer.observe(element, {
      attributeFilter: ["disabled"],
      attributeOldValue: true,
      attributes: true,
    })
    element.setAttribute("data-refresh-cycle", "watching")
  })

  // When
  await refresh.click()
  await expect(refresh).toHaveAttribute("data-refresh-cycle", "complete")

  // Then
  await expect(refresh).toHaveAttribute("data-preview-source-after", sourceBeforeRefresh ?? "")
})

test("labels the built-in fallback as a cloud service outage", async ({ page }) => {
  await useBuiltInAssetFallback(page)
  await page.goto("/")

  await expect(page.getByText("云端素材服务暂时不可用，已显示内置素材。")).toBeVisible()
})

test("shows a low-distraction cloud connection status", async ({ page }) => {
  await page.route("http://127.0.0.1:7000/health", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ status: "ready" }),
    })
  })
  await page.route("http://127.0.0.1:7000/assets?*", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ assets: [] }) })
  })

  await page.goto("/")

  await expect(page.getByText("云素材在线", { exact: true })).toBeVisible()
})

test("keeps a portrait asset fully inside the centered tile preview", async ({ page }) => {
  await useBuiltInAssetFallback(page)
  await page.goto("/")
  await seedPortraitAsset(page)
  await page.reload()
  const tile = page.getByTestId(TEST_ASSET_CARD)
  await expect(tile).toBeVisible()

  const geometry = await tile.locator(".asset-tile__preview img").evaluate((element) => {
    if (!(element instanceof HTMLImageElement)) throw new TypeError("Expected a tile image")
    const frame = element.parentElement
    if (!(frame instanceof HTMLSpanElement)) throw new TypeError("Expected a tile preview")
    const imageRect = element.getBoundingClientRect()
    const frameRect = frame.getBoundingClientRect()
    return {
      frameHeight: frameRect.height,
      frameWidth: frameRect.width,
      imageHeight: imageRect.height,
      imageWidth: imageRect.width,
      objectFit: getComputedStyle(element).objectFit,
    }
  })

  expect(geometry.objectFit).toBe("contain")
  expect(geometry.imageWidth).toBeLessThanOrEqual(geometry.frameWidth)
  expect(geometry.imageHeight).toBeLessThanOrEqual(geometry.frameHeight)
  await page.screenshot({ path: "test-results/asset-panel.png", fullPage: true })
})

async function seedPortraitAsset(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas")
    canvas.width = 400
    canvas.height = 800
    const context = canvas.getContext("2d")
    if (context === null) throw new TypeError("Expected a 2D canvas context")
    context.fillStyle = "#A11D33"
    context.fillRect(0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value === null) reject(new TypeError("Expected a PNG blob"))
        else resolve(value)
      }, "image/png")
    })

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("qingshe-managed-assets-v1")
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("assets")) {
          request.result.createObjectStore("assets")
        }
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction("assets", "readwrite")
        transaction.onerror = () => reject(transaction.error)
        transaction.oncomplete = () => {
          database.close()
          resolve()
        }
        transaction.objectStore("assets").put(
          {
            schemaVersion: 1,
            id: "local:catalog:refresh-test",
            name: "刷新测试竖图",
            category: "家具",
            mimeType: "image/png",
            blob,
            width: 400,
            height: 800,
            createdAt: 1,
          },
          "local:catalog:refresh-test",
        )
      }
    })
  })
}

function serviceAsset(id: string, name: string, category: string) {
  return {
    id,
    code: "QS-000123",
    name,
    category,
    status: "ready",
    mime_type: "image/png",
    width: 400,
    height: 300,
    version: 1,
    needs_review: false,
    favorite: false,
    dominant_color: null,
    tags: [category],
    usage_count: 0,
    created_at: "2026-07-11T00:00:00+00:00",
    updated_at: "2026-07-11T00:00:00+00:00",
  }
}
