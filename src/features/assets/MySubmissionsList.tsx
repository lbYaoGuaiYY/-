import { ArrowClockwise, CheckCircle, CircleNotch, WarningCircle } from "@phosphor-icons/react"

import type { StoredSubmission } from "./submission-store"

export type MySubmissionsListProps = {
  readonly submissions: readonly StoredSubmission[]
  readonly onRefresh: () => void
  readonly onOpenInLibrary?: (submission: StoredSubmission) => void
  readonly onRetry?: (submission: StoredSubmission) => void
}

const STATUS_LABELS: Record<StoredSubmission["status"], string> = {
  queued: "排队中",
  processing: "处理中",
  pending_review: "待审核",
  approved: "已通过",
  failed: "失败",
}

export function MySubmissionsList({
  submissions,
  onRefresh,
  onOpenInLibrary,
  onRetry,
}: MySubmissionsListProps) {
  return (
    <section className="asset-submissions" aria-labelledby="asset-submissions-title">
      <div className="asset-submissions__header">
        <div>
          <h3 id="asset-submissions-title">我的提交</h3>
          <p>投稿会在审核通过后自动进入素材库。</p>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="刷新投稿状态"
          title="刷新投稿状态"
          onClick={onRefresh}
        >
          <ArrowClockwise size={16} aria-hidden="true" />
        </button>
      </div>
      {submissions.length === 0 ? (
        <p className="asset-submissions__empty" role="status">
          还没有投稿记录
        </p>
      ) : (
        <ul className="asset-submissions__list" aria-live="polite">
          {submissions.map((submission) => (
            <li className="asset-submission" key={submission.submissionId}>
              <div className="asset-submission__icon" aria-hidden="true">
                {submission.status === "approved" ? (
                  <CheckCircle size={18} />
                ) : submission.status === "failed" ? (
                  <WarningCircle size={18} />
                ) : (
                  <CircleNotch className="is-spinning" size={18} />
                )}
              </div>
              <div className="asset-submission__details">
                <strong title={submission.name}>{submission.name}</strong>
                <span title={submission.fileName}>{submission.fileName}</span>
                {submission.error !== null && (
                  <span className="asset-submission__error">{submission.error}</span>
                )}
              </div>
              <span
                className={`asset-submission__status is-${submission.status}`}
                aria-live="polite"
              >
                {STATUS_LABELS[submission.status]}
              </span>
              {submission.status === "approved" && onOpenInLibrary !== undefined && (
                <button
                  className="text-button asset-submission__action"
                  type="button"
                  onClick={() => onOpenInLibrary(submission)}
                >
                  在素材库查看
                </button>
              )}
              {submission.status === "failed" && onRetry !== undefined && (
                <button
                  className="text-button asset-submission__action"
                  type="button"
                  onClick={() => onRetry(submission)}
                >
                  重新提交
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
