import { X } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"
import { useModalFocus } from "../editor/use-modal-focus"
import type { AssetCategory } from "./demo-assets"
import { ASSET_CATEGORIES } from "./demo-assets"
import {
  SUBMISSION_ACCEPTED_MIME_TYPES,
  SUBMISSION_MAX_BYTES,
  type SubmissionMode,
  type SubmissionProgress,
  type SubmissionStatus,
} from "./submission-client"
import type { NewSubmissionInput } from "./use-submissions"

export type SubmissionDialogResult = {
  readonly submissionId: string
  readonly status: SubmissionStatus
  readonly error?: string | null
}

export type SubmissionDialogInitialValues = {
  readonly name: string
  readonly category?: AssetCategory
  readonly mode: SubmissionMode
}

export type SubmissionDialogProps = {
  readonly open: boolean
  readonly isSubmitting: boolean
  readonly initialValues?: SubmissionDialogInitialValues
  readonly onCancelSubmit: () => void
  readonly onClose: () => void
  readonly onSubmit: (
    file: File,
    input: NewSubmissionInput,
    onProgress: (progress: SubmissionProgress) => void,
  ) => Promise<SubmissionDialogResult>
}

export function SubmissionDialog({
  open,
  isSubmitting,
  initialValues,
  onCancelSubmit,
  onClose,
  onSubmit,
}: SubmissionDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [category, setCategory] = useState("")
  const [mode, setMode] = useState<SubmissionMode>("cutout")
  const [progress, setProgress] = useState<SubmissionProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SubmissionDialogResult | null>(null)
  const initialName = initialValues?.name ?? ""
  const initialCategory = initialValues?.category ?? ""
  const initialMode = initialValues?.mode ?? "cutout"

  useEffect(() => {
    if (!open) return
    setFile(null)
    setPreviewUrl(null)
    setName(initialName)
    setCategory(initialCategory)
    setMode(initialMode)
    setProgress(null)
    setError(null)
    setResult(null)
  }, [open, initialCategory, initialMode, initialName])

  useModalFocus(dialogRef, () => {
    if (!isSubmitting) onClose()
  })

  useEffect(() => {
    if (file === null) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  if (!open) return null

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const nextFile = event.currentTarget.files?.item(0) ?? null
    event.currentTarget.value = ""
    setError(null)
    setResult(null)
    setProgress(null)
    if (nextFile === null) return
    if (!isAcceptedImage(nextFile)) {
      setFile(null)
      setError("请选择 JPEG、PNG 或 WebP 图片。")
      return
    }
    if (nextFile.size > SUBMISSION_MAX_BYTES) {
      setFile(null)
      setError("图片不能超过 25MB。")
      return
    }
    setFile(nextFile)
    if (name.trim() === "") setName(nextFile.name.replace(/\.[^.]+$/, "") || nextFile.name)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (file === null) {
      setError("请选择要提交的图片。")
      fileInputRef.current?.focus()
      return
    }
    const trimmedName = name.trim()
    if (trimmedName === "") {
      setError("请填写素材名称。")
      nameRef.current?.focus()
      return
    }
    setError(null)
    setProgress({ loaded: 0, total: file.size, percent: 0 })
    try {
      const input: NewSubmissionInput =
        category === ""
          ? { name: trimmedName, mode }
          : { name: trimmedName, category: category as AssetCategory, mode }
      const submitted = await onSubmit(file, input, setProgress)
      if (submitted.status === "failed") {
        setError(submitted.error ?? "素材处理失败，服务器已返回失败凭据。")
        setResult(submitted)
      } else {
        setResult(submitted)
      }
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : "素材提交失败，请重试。",
      )
    }
  }

  return (
    <div className="submission-dialog__backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="submission-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="submission-dialog-title"
        tabIndex={-1}
      >
        <header className="submission-dialog__header">
          <div>
            <h2 id="submission-dialog-title">提交素材</h2>
            <p>支持 JPEG、PNG、WebP，单张不超过 25MB。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭提交素材对话框"
            data-dialog-initial-focus="true"
            disabled={isSubmitting}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <form className="submission-dialog__form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="submission-dialog__file-row">
            <div className="submission-dialog__preview" aria-live="polite">
              {previewUrl === null ? (
                <span>选择图片预览</span>
              ) : (
                <img src={previewUrl} alt="素材预览" />
              )}
            </div>
            <div className="submission-dialog__file-control">
              <input
                ref={fileInputRef}
                id="submission-original"
                className="sr-only"
                type="file"
                accept={SUBMISSION_ACCEPTED_MIME_TYPES.join(",")}
                onChange={handleFileChange}
              />
              <label
                className="text-button submission-dialog__choose"
                htmlFor="submission-original"
              >
                选择图片
              </label>
              <span className="submission-dialog__file-name">{file?.name ?? "尚未选择文件"}</span>
              {file !== null && (
                <span className="submission-dialog__file-info">
                  格式：{file.type || extensionMimeType(file.name)} · 大小：
                  {formatFileSize(file.size)}
                </span>
              )}
            </div>
          </div>
          <label className="submission-dialog__field" htmlFor="submission-name">
            <span>名称</span>
            <input
              ref={nameRef}
              id="submission-name"
              type="text"
              value={name}
              maxLength={120}
              placeholder="给素材起个名字"
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <label className="submission-dialog__field" htmlFor="submission-category">
            <span>分类（可选）</span>
            <select
              id="submission-category"
              value={category}
              onChange={(event) => setCategory(event.currentTarget.value)}
            >
              <option value="">不指定分类</option>
              {ASSET_CATEGORIES.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="submission-dialog__mode">
            <legend>处理模式</legend>
            <label>
              <input
                type="radio"
                name="submission-mode"
                value="cutout"
                checked={mode === "cutout"}
                onChange={() => setMode("cutout")}
              />
              <span>智能抠图后审核</span>
            </label>
            <label>
              <input
                type="radio"
                name="submission-mode"
                value="review"
                checked={mode === "review"}
                onChange={() => setMode("review")}
              />
              <span>保留原图仅审核</span>
            </label>
          </fieldset>
          {progress !== null && isSubmitting && (
            <div className="submission-dialog__progress" role="status" aria-live="polite">
              <span>上传中 {progress.percent}%</span>
              <progress max={100} value={progress.percent} />
            </div>
          )}
          {result !== null && result.status !== "failed" && (
            <p className="submission-dialog__success" role="status">
              已提交，当前状态会在“我的提交”中更新。
            </p>
          )}
          {result !== null && result.status === "failed" && (
            <p className="submission-dialog__error" role="status">
              服务器已记录这次投稿（{result.submissionId}
              ），请在“我的提交”查看原因后重新选择文件提交。
            </p>
          )}
          {error !== null && (
            <p className="submission-dialog__error" role="alert">
              {error}
            </p>
          )}
          <footer className="submission-dialog__actions">
            <button
              className="text-button"
              type="button"
              onClick={isSubmitting ? onCancelSubmit : onClose}
            >
              {isSubmitting ? "取消上传" : result === null ? "取消" : "完成"}
            </button>
            {result === null && (
              <button className="primary-button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "上传中…" : "提交素材"}
              </button>
            )}
          </footer>
        </form>
      </div>
    </div>
  )
}

function isAcceptedImage(file: File): boolean {
  if (
    SUBMISSION_ACCEPTED_MIME_TYPES.includes(
      file.type as (typeof SUBMISSION_ACCEPTED_MIME_TYPES)[number],
    )
  )
    return true
  // Browsers can omit a type for local files; only then trust the extension.
  return file.type === "" && /\.(?:jpe?g|png|webp)$/i.test(file.name)
}

function extensionMimeType(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase()
  return extension === "jpg" || extension === "jpeg"
    ? "image/jpeg"
    : extension === "png"
      ? "image/png"
      : extension === "webp"
        ? "image/webp"
        : "未知格式"
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
