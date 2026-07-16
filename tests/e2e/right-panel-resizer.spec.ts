import { expect, test } from "@playwright/test"

import { useBuiltInAssetFallback } from "./asset-service-fallback"

test("renders the right panel resize area as a subtle grip instead of a solid bar", async ({
  page,
}) => {
  await useBuiltInAssetFallback(page)
  await page.goto("/")

  const handle = page.getByRole("separator", { name: "调整属性与图层面板高度" })
  await expect(handle).toBeVisible()

  const visual = await handle.evaluate((element) => {
    const handleStyle = getComputedStyle(element)
    const lineStyle = getComputedStyle(element, "::before")
    const gripStyle = getComputedStyle(element, "::after")
    return {
      background: handleStyle.backgroundColor,
      cursor: handleStyle.cursor,
      gripContent: gripStyle.content,
      gripHeight: gripStyle.height,
      lineHeight: lineStyle.height,
    }
  })

  expect(visual.background).toBe("rgba(0, 0, 0, 0)")
  expect(visual.cursor).toBe("ns-resize")
  expect(visual.lineHeight).toBe("1px")
  expect(visual.gripContent).toBe('""')
  expect(visual.gripHeight).toBe("3px")
})
