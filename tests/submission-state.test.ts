import { describe, expect, it } from "vitest"

import { mergeSubmissionStatus } from "../src/features/assets/use-submissions"

describe("submission status ordering", () => {
  it("does not allow an older response to regress a terminal status", () => {
    expect(mergeSubmissionStatus("approved", "processing")).toBe("approved")
    expect(mergeSubmissionStatus("failed", "queued")).toBe("failed")
  })

  it("keeps progress monotonic while allowing terminal completion", () => {
    expect(mergeSubmissionStatus("pending_review", "processing")).toBe("pending_review")
    expect(mergeSubmissionStatus("processing", "approved")).toBe("approved")
  })
})
