import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSubmissionStatus: vi.fn(),
  writeStoredSubmissions: vi.fn(),
}))

vi.mock("../src/features/assets/submission-client", () => ({
  createSubmission: vi.fn(),
  getSubmissionStatus: mocks.getSubmissionStatus,
}))

vi.mock("../src/features/assets/submission-store", () => ({
  readStoredSubmissions: () => [
    {
      submissionId: "submission-1",
      status: "queued",
      statusToken: "status-token",
      name: "测试素材",
      mode: "cutout",
      fileName: "material.png",
      createdAt: Date.now(),
      error: null,
    },
  ],
  scrubTerminalStatusToken: (submission: unknown) => submission,
  writeStoredSubmissions: mocks.writeStoredSubmissions,
}))

import { SUBMISSION_POLL_INTERVAL_MS, useSubmissions } from "../src/features/assets/use-submissions"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("useSubmissions visibility lifecycle", () => {
  it("does not poll while hidden and aborts the active cycle when hidden", async () => {
    vi.useFakeTimers()
    let visibility: DocumentVisibilityState = "hidden"
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility)
    const signals: AbortSignal[] = []
    mocks.getSubmissionStatus.mockImplementation(
      (_submissionId: string, _statusToken: string, options: { signal?: AbortSignal }) => {
        const signal = options.signal
        if (signal !== undefined) signals.push(signal)
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          )
        })
      },
    )

    const { unmount } = renderHook(() => useSubmissions())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUBMISSION_POLL_INTERVAL_MS * 3)
    })
    expect(mocks.getSubmissionStatus).not.toHaveBeenCalled()

    visibility = "visible"
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
      window.dispatchEvent(new Event("focus"))
      await Promise.resolve()
    })
    expect(mocks.getSubmissionStatus).toHaveBeenCalledTimes(1)
    expect(signals).toHaveLength(1)

    visibility = "hidden"
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
      await Promise.resolve()
    })
    expect(signals[0]?.aborted).toBe(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUBMISSION_POLL_INTERVAL_MS * 3)
    })
    expect(mocks.getSubmissionStatus).toHaveBeenCalledTimes(1)
    unmount()
  })

  it("starts one immediate poll when focus and visibility arrive together", async () => {
    vi.useFakeTimers()
    let visibility: DocumentVisibilityState = "hidden"
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility)
    mocks.getSubmissionStatus.mockResolvedValue({ status: "processing" })

    const { unmount } = renderHook(() => useSubmissions())
    visibility = "visible"
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
      window.dispatchEvent(new Event("focus"))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.getSubmissionStatus).toHaveBeenCalledTimes(1)
    unmount()
  })
})
