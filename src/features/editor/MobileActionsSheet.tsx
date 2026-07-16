import { DownloadSimple, FileArrowDown, FileArrowUp, PencilSimple, X } from "@phosphor-icons/react"
import { useState } from "react"

import { qingsheBuildLabel } from "../../platform/build-info"
import type { ExportImageFormat } from "./fabric-runtime"

export type MobileActionsSheetProps = {
  readonly canExport: boolean
  readonly isBusy: boolean
  readonly projectName: string
  readonly onClose: () => void
  readonly onExport: (format: ExportImageFormat) => void
  readonly onExportProject: () => void
  readonly onImportProject: () => void
  readonly onRenameProject: (name: string) => void
}

export function MobileActionsSheet({
  canExport,
  isBusy,
  projectName,
  onClose,
  onExport,
  onExportProject,
  onImportProject,
  onRenameProject,
}: MobileActionsSheetProps) {
  const [draftName, setDraftName] = useState(projectName)

  function commitProjectName(): void {
    const normalized = draftName.trim()
    if (normalized.length === 0) {
      setDraftName(projectName)
      return
    }
    if (normalized !== projectName) onRenameProject(normalized)
  }

  return (
    <div
      className="mobile-actions-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-actions-title"
    >
      <button
        className="mobile-actions-sheet__backdrop"
        type="button"
        aria-label="关闭更多编辑操作"
        onClick={onClose}
      />
      <section className="mobile-actions-sheet__panel">
        <header className="panel-header">
          <h2 className="panel-title" id="mobile-actions-title">
            更多编辑操作
          </h2>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭更多编辑操作"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="mobile-actions-sheet__body">
          <label className="mobile-actions-sheet__name-field">
            <span className="field-label">项目名称</span>
            <span className="mobile-actions-sheet__name-control">
              <input
                className="search-field"
                aria-label="项目名称"
                value={draftName}
                maxLength={80}
                onChange={(event) => setDraftName(event.currentTarget.value)}
                onBlur={commitProjectName}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur()
                  if (event.key === "Escape") setDraftName(projectName)
                }}
              />
              <button
                className="icon-button"
                type="button"
                aria-label="保存项目名称"
                onClick={commitProjectName}
              >
                <PencilSimple size={18} aria-hidden="true" />
              </button>
            </span>
          </label>

          <div className="mobile-actions-sheet__group">
            <p className="mobile-actions-sheet__group-title">项目文件</p>
            <button
              className="text-button mobile-actions-sheet__action"
              type="button"
              disabled={isBusy}
              onClick={onImportProject}
            >
              <FileArrowUp size={18} aria-hidden="true" />
              导入可编辑项目
            </button>
            <button
              className="text-button mobile-actions-sheet__action"
              type="button"
              disabled={!canExport || isBusy}
              onClick={onExportProject}
            >
              <FileArrowDown size={18} aria-hidden="true" />
              备份可编辑项目
            </button>
          </div>

          <div className="mobile-actions-sheet__group">
            <p className="mobile-actions-sheet__group-title">导出图片</p>
            <div className="mobile-actions-sheet__export-grid">
              <button
                className="primary-button mobile-actions-sheet__action"
                type="button"
                aria-label="导出 PNG"
                disabled={!canExport || isBusy}
                onClick={() => onExport("png")}
              >
                <DownloadSimple size={18} weight="bold" aria-hidden="true" />
                导出 PNG
              </button>
              <button
                className="text-button mobile-actions-sheet__action"
                type="button"
                aria-label="导出 JPG"
                disabled={!canExport || isBusy}
                onClick={() => onExport("jpeg")}
              >
                <DownloadSimple size={18} aria-hidden="true" />
                导出 JPG
              </button>
            </div>
          </div>
          <p className="mobile-actions-sheet__build">轻设 {qingsheBuildLabel()}</p>
        </div>
      </section>
    </div>
  )
}
