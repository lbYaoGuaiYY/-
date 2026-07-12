import {
  ArrowClockwise,
  ArrowCounterClockwise,
  DownloadSimple,
  FileArrowDown,
  FileArrowUp,
  FolderSimple,
  ImageSquare,
} from "@phosphor-icons/react"
import { useEffect, useState } from "react"
import type { ProjectSessionStatus } from "../projects/use-project-session"
import type { ExportImageFormat } from "./fabric-runtime"

export type AppHeaderProps = {
  readonly canRedo: boolean
  readonly canUndo: boolean
  readonly canExport: boolean
  readonly isBusy: boolean
  readonly projectName: string
  readonly projectStatus: ProjectSessionStatus
  readonly onExport: (format: ExportImageFormat) => void
  readonly onExportProject: () => void
  readonly onImportProject: () => void
  readonly onOpenProjects: () => void
  readonly onRenameProject: (name: string) => void
  readonly onRequestBackground: () => void
  readonly onRedo: () => void
  readonly onUndo: () => void
}

export function AppHeader({
  canRedo,
  canUndo,
  canExport,
  isBusy,
  projectName,
  projectStatus,
  onExport,
  onExportProject,
  onImportProject,
  onOpenProjects,
  onRenameProject,
  onRequestBackground,
  onRedo,
  onUndo,
}: AppHeaderProps) {
  const [exportFormat, setExportFormat] = useState<ExportImageFormat>("png")

  return (
    <header className="app-header">
      <div className="brand-block">
        <span className="brand-mark" aria-hidden="true">
          轻
        </span>
        <h1 className="brand-name">轻设</h1>
        <button
          className="icon-button"
          type="button"
          aria-label="项目列表"
          onClick={onOpenProjects}
        >
          <FolderSimple size={16} aria-hidden="true" />
        </button>
        <ProjectNameField name={projectName} onCommit={onRenameProject} />
        <span
          className="project-save-status"
          data-kind={projectStatus.kind}
          role="status"
          aria-label="项目保存状态"
          aria-live="polite"
          aria-atomic="true"
        >
          {projectStatusLabel(projectStatus)}
        </span>
        {projectStatus.kind === "saved" && projectStatus.durability !== "persistent" && (
          <span className="project-durability-warning" role="note">
            {projectStatus.durability === "best_effort"
              ? "浏览器可能清理本地数据"
              : "当前浏览器不支持持久存储"}
          </span>
        )}
      </div>
      <div className="header-actions">
        <button
          className="text-button"
          type="button"
          aria-label="导入底图"
          onClick={onRequestBackground}
        >
          <ImageSquare size={16} aria-hidden="true" />
          <span className="desktop-only">导入底图</span>
        </button>
        <span className="header-divider" aria-hidden="true" />
        <button
          className="icon-button"
          type="button"
          aria-label="撤销"
          disabled={!canUndo || isBusy}
          onClick={onUndo}
        >
          <ArrowCounterClockwise size={17} aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="重做"
          disabled={!canRedo || isBusy}
          onClick={onRedo}
        >
          <ArrowClockwise size={17} aria-hidden="true" />
        </button>
        <button
          className="icon-button desktop-only"
          type="button"
          aria-label="导入可编辑项目"
          disabled={isBusy}
          onClick={onImportProject}
        >
          <FileArrowUp size={17} aria-hidden="true" />
        </button>
        <button
          className="icon-button desktop-only"
          type="button"
          aria-label="备份可编辑项目"
          disabled={!canExport || isBusy}
          onClick={onExportProject}
        >
          <FileArrowDown size={17} aria-hidden="true" />
        </button>
        <select
          className="export-format-select desktop-only"
          aria-label="导出图片格式"
          value={exportFormat}
          onChange={(event) => setExportFormat(event.currentTarget.value as ExportImageFormat)}
        >
          <option value="png">PNG</option>
          <option value="jpeg">JPG</option>
        </select>
        <button
          className="primary-button"
          type="button"
          aria-label={`导出 ${exportFormat === "jpeg" ? "JPG" : "PNG"}`}
          disabled={!canExport || isBusy}
          onClick={() => onExport(exportFormat)}
        >
          <DownloadSimple size={16} weight="bold" aria-hidden="true" />
          <span>导出 {exportFormat === "jpeg" ? "JPG" : "PNG"}</span>
        </button>
      </div>
    </header>
  )
}

function ProjectNameField({
  name,
  onCommit,
}: {
  readonly name: string
  readonly onCommit: (name: string) => void
}) {
  const [draft, setDraft] = useState(name)

  useEffect(() => setDraft(name), [name])

  function commit(): void {
    const normalized = draft.trim()
    if (normalized.length === 0) setDraft(name)
    else if (normalized !== name) onCommit(normalized)
  }

  return (
    <input
      className="document-name-input desktop-only"
      aria-label="项目名称"
      value={draft}
      maxLength={80}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
        if (event.key === "Escape") {
          setDraft(name)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function projectStatusLabel(status: ProjectSessionStatus): string {
  switch (status.kind) {
    case "idle":
      return ""
    case "saving":
      return "保存中…"
    case "saved":
      return "已自动保存"
    case "save_failed":
      return status.reason === "quota_exceeded" ? "本地空间不足" : "保存失败"
    case "storage_blocked":
      return "保存被其他窗口阻止"
    case "reload_required":
      return "请刷新后继续保存"
    case "restore_failed":
      return "恢复失败"
  }
}
