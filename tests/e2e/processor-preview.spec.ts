import { expect, test } from "@playwright/test"

test("renders the modern local processor window without legacy Tk controls", async ({ page }) => {
  await page.goto("/processor.html")

  await expect(page.getByRole("heading", { name: "轻抠" })).toBeVisible()
  await expect(page.getByText("保持运行，自动完成素材抠图")).toBeVisible()
  await expect(page.getByRole("button", { name: "打开素材面板" })).toBeVisible()
  await expect(page.getByRole("button", { name: "最小化" })).toBeVisible()
  await expect(page.getByRole("button", { name: "退出抠图器" })).toBeVisible()

  const visualRules = await page.locator(".processor-shell").evaluate((element) => {
    const shell = getComputedStyle(element)
    const card = getComputedStyle(document.querySelector(".processor-card") as HTMLElement)
    return {
      background: shell.backgroundImage,
      shadow: card.boxShadow,
      radius: card.borderRadius,
      border: card.borderTopWidth,
    }
  })
  expect(visualRules).toEqual({ background: "none", shadow: "none", radius: "4px", border: "1px" })
})
