import { describe, expect, it } from "vitest"

import { fitInside, validateImageFile } from "../src/features/editor/image-import"

describe("validateImageFile", () => {
  it("accepts a supported non-empty image when its MIME type is allowed", () => {
    // Given
    const file = new File([new Uint8Array([1, 2, 3])], "scene.png", { type: "image/png" })

    // When
    const result = validateImageFile(file)

    // Then
    expect(result).toEqual({ kind: "valid", file })
  })

  it("rejects a non-image file without changing editor state", () => {
    // Given
    const file = new File(["notes"], "notes.txt", { type: "text/plain" })

    // When
    const result = validateImageFile(file)

    // Then
    expect(result).toEqual({ kind: "unsupported_type", fileName: "notes.txt" })
  })

  it("rejects an empty image file", () => {
    // Given
    const file = new File([], "broken.webp", { type: "image/webp" })

    // When
    const result = validateImageFile(file)

    // Then
    expect(result).toEqual({ kind: "empty", fileName: "broken.webp" })
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
