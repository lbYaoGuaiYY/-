import { describe, expect, it } from "vitest"

import { qingsheBuildLabel } from "../src/platform/build-info"

describe("qingshe build identity", () => {
  it("shows the source version and revision in every editor runtime", () => {
    expect(
      qingsheBuildLabel({ revision: "abcdef123456", surface: "轻设 App", version: "0.1.0" }),
    ).toBe("v0.1.0 · abcdef123456")
  })
})
