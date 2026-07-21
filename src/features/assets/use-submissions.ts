import { useCallback, useEffect, useRef, useState } from "react"

import type { AssetCategory } from "./demo-assets"
import {
  createSubmission,
  getSubmissionStatus,
  type SubmissionMode,
  type SubmissionProgress,
  type SubmissionStatus,
} from "./submission-client"
import {
  readStoredSubmissions,
  type StoredSubmission,
  scrubTerminalStatusToken,
  writeStoredSubmissions,
} from "./submission-store"

export const SUBMISSION_POLL_INTERVAL_MS = 3000

const STATUS_ORDER: Record<SubmissionStatus, number> = {
  queued: 0,
  processing: 1,
  pending_review: 2,
  approved: 3,
  failed: 3,
}

/** Merge a status response without allowing an older response to regress state. */
export function mergeSubmissionStatus(
  current: SubmissionStatus,
  next: SubmissionStatus,
): SubmissionStatus {
  if (current === "approved" || current === "failed") return current
  return STATUS_ORDER[next] >= STATUS_ORDER[current] ? next : current
}

export type NewSubmissionInput = {
  readonly name: string
  readonly category?: AssetCategory
  readonly mode: SubmissionMode
  readonly idempotency_key?: string
}

export type SubmissionState = {
  readonly submissions: readonly StoredSubmission[]
  readonly isSubmitting: boolean
  readonly refresh: () => void
  readonly submit: (
    file: File,
    input: NewSubmissionInput,
    onProgress?: (progress: SubmissionProgress) => void,
  ) => Promise<StoredSubmission>
}

export function useSubmissions(onApproved?: () => void): SubmissionState {
  const [submissions, setSubmissions] = useState<readonly StoredSubmission[]>(readStoredSubmissions)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submissionsRef = useRef(submissions)
  const approvedNotifiedRef = useRef(new Set<string>())
  const approvedCallbackRef = useRef(onApproved)
  const pollNowRef = useRef<() => void>(() => undefined)
  approvedCallbackRef.current = onApproved
  submissionsRef.current = submissions

  const updateSubmissions = useCallback(
    (update: (current: readonly StoredSubmission[]) => readonly StoredSubmission[]) => {
      setSubmissions((current) => {
        const next = update(current)
        submissionsRef.current = next
        writeStoredSubmissions(next)
        return next
      })
    },
    [],
  )

  const submit = useCallback(
    async (
      file: File,
      input: NewSubmissionInput,
      onProgress?: (progress: SubmissionProgress) => void,
    ): Promise<StoredSubmission> => {
      setIsSubmitting(true)
      try {
        const receipt = await createSubmission(file, input, onProgress)
        const record = scrubTerminalStatusToken({
          submissionId: receipt.submission_id,
          status: receipt.status,
          statusToken: receipt.status_token ?? "",
          name: input.name,
          ...(input.category === undefined ? {} : { category: input.category }),
          mode: input.mode,
          fileName: file.name,
          createdAt: Date.now(),
          error: receipt.error ?? null,
          ...(receipt.asset_id === undefined ? {} : { assetId: receipt.asset_id }),
        })
        updateSubmissions((current) => [
          record,
          ...current.filter((item) => item.submissionId !== record.submissionId),
        ])
        if (record.status === "approved" && !approvedNotifiedRef.current.has(record.submissionId)) {
          approvedNotifiedRef.current.add(record.submissionId)
          approvedCallbackRef.current?.()
        }
        return record
      } finally {
        setIsSubmitting(false)
      }
    },
    [updateSubmissions],
  )

  useEffect(() => {
    let active = true
    let pollInFlight: Promise<void> | null = null
    let pollController: AbortController | null = null

    const poll = (): Promise<void> => {
      if (pollInFlight !== null) return pollInFlight
      pollController = new AbortController()
      const controller = pollController
      const request = (async (): Promise<void> => {
        const pending = submissionsRef.current.filter(
          (submission) =>
            submission.status !== "approved" &&
            submission.status !== "failed" &&
            submission.statusToken !== "",
        )
        // Serialize status reads so a manual refresh cannot race the interval
        // and so each response is merged against the latest state.
        for (const submission of pending) {
          if (!active || controller.signal.aborted) return
          try {
            const next = await getSubmissionStatus(
              submission.submissionId,
              submission.statusToken,
              { signal: controller.signal },
            )
            if (!active || controller.signal.aborted) return
            const currentItem = submissionsRef.current.find(
              (item) => item.submissionId === submission.submissionId,
            )
            const mergedStatus = mergeSubmissionStatus(
              currentItem?.status ?? submission.status,
              next.status,
            )
            updateSubmissions((current) =>
              current.map((item) => {
                if (item.submissionId !== submission.submissionId) return item
                return scrubTerminalStatusToken({
                  ...item,
                  status: mergedStatus,
                  ...(next.error === undefined ? {} : { error: next.error }),
                  ...(next.asset_id === undefined ? {} : { assetId: next.asset_id }),
                  ...(next.status_token === undefined ? {} : { statusToken: next.status_token }),
                })
              }),
            )
            if (
              mergedStatus === "approved" &&
              !approvedNotifiedRef.current.has(submission.submissionId)
            ) {
              approvedNotifiedRef.current.add(submission.submissionId)
              approvedCallbackRef.current?.()
            }
          } catch {
            if (controller.signal.aborted) return
            // A transient status read failure should not erase the persisted submission.
          }
        }
      })()
      pollInFlight = request
      request.then(
        () => {
          if (pollInFlight === request) {
            pollInFlight = null
            pollController = null
          }
        },
        () => {
          if (pollInFlight === request) {
            pollInFlight = null
            pollController = null
          }
        },
      )
      return request
    }
    pollNowRef.current = poll
    const timer = window.setInterval(() => void poll(), SUBMISSION_POLL_INTERVAL_MS)
    return () => {
      active = false
      window.clearInterval(timer)
      pollController?.abort()
      pollInFlight = null
      pollController = null
      pollNowRef.current = () => Promise.resolve()
    }
  }, [updateSubmissions])

  const refresh = useCallback(() => {
    void pollNowRef.current()
  }, [])

  return { isSubmitting, refresh, submit, submissions }
}

export type { SubmissionStatus }
