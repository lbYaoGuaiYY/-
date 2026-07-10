import { describe, expect, it } from "vitest"

import { fitInside, validateImageFile } from "../src/features/editor/image-import"

describe("validateImageFile", () => {
  it("accepts a supported image after successful decoding", async () => {
    // Given
    const file = new File([new Uint8Array([1, 2, 3])], "scene.png", { type: "image/png" })

    // When
    const result = await validateImageFile(file, async () => ({ width: 1200, height: 800 }))

    // Then
    expect(result).toEqual({ kind: "valid", file, size: { width: 1200, height: 800 } })
  })

  it("rejects a non-image file without changing editor state", async () => {
    // Given
    const file = new File(["notes"], "notes.txt", { type: "text/plain" })

    // When
    const result = await validateImageFile(file)

    // Then
    expect(result).toEqual({ kind: "unsupported_type", fileName: "notes.txt" })
  })

  it("rejects an empty image file", async () => {
    // Given
    const file = new File([], "broken.webp", { type: "image/webp" })

    // When
    const result = await validateImageFile(file)

    // Then
    expect(result).toEqual({ kind: "empty", fileName: "broken.webp" })
  })

  it("rejects corrupt and oversized decoded images", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "scene.png", { type: "image/png" })

    const corrupt = await validateImageFile(file, async () => {
      throw new DOMException("decode failed", "EncodingError")
    })
    const oversized = await validateImageFile(file, async () => ({ width: 10_001, height: 100 }))

    expect(corrupt.kind).toBe("decode_failed")
    expect(oversized.kind).toBe("dimensions_too_large")
  })
})

describe("fitInside", () => {
  it("keeps aspect ratio while fitting a landscape image inside the stage", () => {
    // Given
    const source = { width: 1600, height: 900 }
    const target = { width: 800, height: 600 }

    // When
    const result = fitInside(source, target)

    // Then
    expect(result).toEqual({ width: 800, height: 450, scale: 0.5 })
  })
})
