import { afterEach, describe, expect, it, vi } from "vitest"

import {
  readStoredSubmissions,
  type StoredSubmission,
  SUBMISSION_RETENTION_MS,
  SUBMISSION_STORAGE_KEY,
  writeStoredSubmissions,
} from "../src/features/assets/submission-store"

afterEach(() => {
  window.localStorage.removeItem(SUBMISSION_STORAGE_KEY)
  vi.useRealTimers()
})

function submission(overrides: Partial<StoredSubmission> = {}): StoredSubmission {
  return {
    submissionId: "submission-1",
    status: "queued",
    statusToken: "status-secret",
    name: "测试素材",
    mode: "cutout",
    fileName: "material.png",
    createdAt: Date.now(),
    error: null,
    ...overrides,
  }
}

describe("submission status storage", () => {
  it("removes bearer tokens after a submission reaches a terminal state", () => {
    writeStoredSubmissions([submission({ status: "approved" })])

    expect(readStoredSubmissions()).toEqual([
      expect.objectContaining({ status: "approved", statusToken: "" }),
    ])
    expect(window.localStorage.getItem(SUBMISSION_STORAGE_KEY)).not.toContain("status-secret")
  })

  it("drops stale submission records after the retention window", () => {
    const now = new Date("2026-07-21T00:00:00Z")
    vi.useFakeTimers()
    vi.setSystemTime(now)
    window.localStorage.setItem(
      SUBMISSION_STORAGE_KEY,
      JSON.stringify([
        submission({ createdAt: now.getTime() - SUBMISSION_RETENTION_MS - 1 }),
        submission({ submissionId: "current", createdAt: now.getTime() }),
      ]),
    )

    expect(readStoredSubmissions().map((item) => item.submissionId)).toEqual(["current"])
  })

  it("scrubs tokens from legacy terminal records and repairs local storage", () => {
    const legacy = submission({ status: "failed", error: "server rejected" })
    window.localStorage.setItem(SUBMISSION_STORAGE_KEY, JSON.stringify([legacy]))

    expect(readStoredSubmissions()).toEqual([
      expect.objectContaining({ status: "failed", statusToken: "" }),
    ])
    expect(window.localStorage.getItem(SUBMISSION_STORAGE_KEY)).not.toContain("status-secret")
  })
})
