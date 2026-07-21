import { describe, expect, it } from "vitest"

import {
  mergeSubmissionStatus,
  runWithConcurrency,
  SUBMISSION_POLL_CONCURRENCY,
} from "../src/features/assets/use-submissions"

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

describe("submission polling helpers", () => {
  it("keeps status reads bounded while draining the pending queue", async () => {
    const releases: Array<() => void> = []
    let active = 0
    let maxActive = 0

    const running = runWithConcurrency(
      Array.from({ length: SUBMISSION_POLL_CONCURRENCY + 3 }, (_, index) => index),
      SUBMISSION_POLL_CONCURRENCY,
      async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise<void>((resolve) => {
          releases.push(() => {
            active -= 1
            resolve()
          })
        })
      },
    )

    await Promise.resolve()
    expect(active).toBe(SUBMISSION_POLL_CONCURRENCY)

    while (releases.length > 0) {
      releases.shift()?.()
      await Promise.resolve()
    }

    await running
    expect(maxActive).toBe(SUBMISSION_POLL_CONCURRENCY)
    expect(active).toBe(0)
  })
})
