import { describe, expect, it } from "vitest"

import { IMAGE_FILE_FILTER } from "../src/features/projects/project-file-dialog"

describe("desktop image dialog", () => {
  it("offers JPEG, PNG and WebP image files", () => {
    expect(IMAGE_FILE_FILTER.extensions).toEqual(["jpg", "jpeg", "png", "webp"])
  })
})
