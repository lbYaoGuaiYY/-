import { afterEach, describe, expect, it, vi } from "vitest"

import {
  getSubmissionStatus,
  SUBMISSION_STATUS_TIMEOUT_MS,
} from "../src/features/assets/submission-client"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("submission status client", () => {
  it("aborts a status read at the bounded timeout", async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    )

    const request = getSubmissionStatus("submission-1", "status-token")
    const assertion = expect(request).rejects.toThrow("素材投稿状态请求超时")
    await vi.advanceTimersByTimeAsync(SUBMISSION_STATUS_TIMEOUT_MS)
    await assertion
  })
})
