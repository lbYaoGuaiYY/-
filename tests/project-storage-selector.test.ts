import { describe, expect, it } from "vitest"

import { isDesktopRuntime } from "../src/features/projects/project-storage"

describe("project storage platform", () => {
  it("uses browser storage when the Tauri runtime is unavailable", () => {
    // Given the Vitest browser-like environment without the Tauri bridge
    // When the platform is resolved
    const desktopRuntime = isDesktopRuntime()

    // Then browser persistence remains the safe fallback
    expect(desktopRuntime).toBe(false)
  })
})
