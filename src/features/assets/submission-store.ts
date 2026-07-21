import type { AssetCategory } from "./demo-assets"
import type { SubmissionMode, SubmissionStatus } from "./submission-client"

export const SUBMISSION_STORAGE_KEY = "qingshe-submissions-v1"
export const SUBMISSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export type StoredSubmission = {
  readonly submissionId: string
  readonly status: SubmissionStatus
  readonly statusToken: string
  readonly name: string
  readonly category?: AssetCategory
  readonly mode: SubmissionMode
  readonly fileName: string
  readonly createdAt: number
  readonly error: string | null
  readonly assetId?: string | null
}

export function readStoredSubmissions(): readonly StoredSubmission[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(SUBMISSION_STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const cutoff = Date.now() - SUBMISSION_RETENTION_MS
    const retained = parsed
      .filter(isStoredSubmission)
      .filter((item) => item.createdAt >= cutoff)
      .slice(0, 100)
      .map(scrubTerminalStatusToken)
    // Older versions persisted status bearer tokens after terminal states.
    // Repair that data on read without making storage availability a blocker.
    if (JSON.stringify(retained) !== raw) {
      try {
        writeStoredSubmissions(retained)
      } catch {
        // localStorage can be unavailable or quota constrained.
      }
    }
    return retained
  } catch {
    return []
  }
}

export function writeStoredSubmissions(submissions: readonly StoredSubmission[]): void {
  if (typeof window === "undefined") return
  try {
    const cutoff = Date.now() - SUBMISSION_RETENTION_MS
    const retained = submissions
      .filter((submission) => submission.createdAt >= cutoff)
      .slice(0, 100)
      .map(scrubTerminalStatusToken)
    window.localStorage.setItem(SUBMISSION_STORAGE_KEY, JSON.stringify(retained))
  } catch {
    // Storage may be unavailable (private browsing or quota); the in-memory state still works.
  }
}

export function scrubTerminalStatusToken(submission: StoredSubmission): StoredSubmission {
  const normalized = { ...submission, error: submission.error ?? null }
  return normalized.status === "approved" || normalized.status === "failed"
    ? { ...normalized, statusToken: "" }
    : normalized
}

function isStoredSubmission(value: unknown): value is StoredSubmission {
  if (typeof value !== "object" || value === null) return false
  const item = value as {
    readonly submissionId?: unknown
    readonly statusToken?: unknown
    readonly name?: unknown
    readonly fileName?: unknown
    readonly createdAt?: unknown
    readonly status?: unknown
    readonly mode?: unknown
    readonly category?: unknown
    readonly error?: unknown
    readonly [key: string]: unknown
  }
  return (
    typeof item.submissionId === "string" &&
    typeof item.statusToken === "string" &&
    typeof item.name === "string" &&
    typeof item.fileName === "string" &&
    typeof item.createdAt === "number" &&
    (item.status === "queued" ||
      item.status === "processing" ||
      item.status === "pending_review" ||
      item.status === "approved" ||
      item.status === "failed") &&
    (item.mode === "cutout" || item.mode === "review") &&
    (item.category === undefined || typeof item.category === "string") &&
    (item.error === null || item.error === undefined || typeof item.error === "string")
  )
}
