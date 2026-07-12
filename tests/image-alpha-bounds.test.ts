import { describe, expect, it } from "vitest"

import { findVisiblePixelBounds } from "../src/features/editor/image-alpha-bounds"

describe("visible pixel bounds", () => {
  it("fits the bounds to non-transparent pixels when the image has transparent padding", () => {
    // Given
    const width = 4
    const height = 3
    const data = new Uint8ClampedArray(width * height * 4)
    data[(1 * width + 1) * 4 + 3] = 255
    data[(1 * width + 2) * 4 + 3] = 128

    // When
    const bounds = findVisiblePixelBounds({ data, width, height })

    // Then
    expect(bounds).toEqual({ x: 1, y: 1, width: 2, height: 1 })
  })

  it("returns null when every pixel is transparent", () => {
    // Given
    const width = 2
    const height = 2
    const data = new Uint8ClampedArray(width * height * 4)

    // When
    const bounds = findVisiblePixelBounds({ data, width, height })

    // Then
    expect(bounds).toBeNull()
  })

  it("ignores nearly transparent edge noise", () => {
    // Given
    const width = 4
    const height = 3
    const data = new Uint8ClampedArray(width * height * 4)
    data[3] = 1
    data[(1 * width + 2) * 4 + 3] = 255

    // When
    const bounds = findVisiblePixelBounds({ data, width, height })

    // Then
    expect(bounds).toEqual({ x: 2, y: 1, width: 1, height: 1 })
  })
})
