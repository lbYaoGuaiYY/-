import { describe, expect, it } from "vitest"

import { checkProductBoundaries } from "../scripts/check-product-boundaries.mjs"

describe("product boundaries", () => {
  it("keeps one editor core and three deliberately separate delivery surfaces", async () => {
    await expect(checkProductBoundaries()).resolves.toBeUndefined()
  })
})
