import { describe, expect, it } from "vitest"

import { editorViewportForWidth } from "../src/features/editor/use-editor-panels"

describe("editor panel breakpoint", () => {
  it("keeps an iPad Pro landscape viewport in the full three-column layout", () => {
    expect(editorViewportForWidth(1179)).toBe("tablet")
    expect(editorViewportForWidth(1180)).toBe("desktop")
    expect(editorViewportForWidth(1194)).toBe("desktop")
  })

  it("keeps the existing phone boundary", () => {
    expect(editorViewportForWidth(699)).toBe("phone")
    expect(editorViewportForWidth(700)).toBe("tablet")
  })
})
