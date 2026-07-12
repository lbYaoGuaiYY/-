import { Copy, FolderOpen, ImageSquare, PencilSimple, Plus, Trash } from "@phosphor-icons/react"
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useObjectUrl } from "../asset-admin/use-object-url"
import type { ProjectSummary } from "./project-catalog"
import type { ProjectId } from "./project-format"
import { createProjectCatalog } from "./project-storage"

type HomeState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly projects: readonly ProjectSummary[] }
  | { readonly kind: "error" }

export function ProjectHome() {
  const catalog = useMemo(createProjectCatalog, [])
  const [state, setState] = useState<HomeState>({ kind: "loading" })
  const [newProjectName, setNewProjectName] = useState("")
  const [busy, setBusy] = useState(false)

  const loadProjects = useCallback(async (): Promise<void> => {
    const result = await catalog.listProjects()
    setState(
      result.kind === "loaded" ? { kind: "ready", projects: result.projects } : { kind: "error" },
    )
  }, [catalog])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  async function createProject(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const name = newProjectName.trim() || "未命名婚礼方案"
    setBusy(true)
    const result = await catalog.createProject(name)
    if (result.kind === "saved") openProject(result.projectId)
    else {
      setState({ kind: "error" })
      setBusy(false)
    }
  }

  async function duplicateProject(id: ProjectId): Promise<void> {
    setBusy(true)
    const result = await catalog.duplicateProject(id)
    if (result.kind === "saved") await loadProjects()
    else setState({ kind: "error" })
    setBusy(false)
  }

  async function renameProject(id: ProjectId, name: string): Promise<void> {
    setBusy(true)
    const result = await catalog.renameProject(id, name)
    if (result.kind === "saved") await loadProjects()
    else setState({ kind: "error" })
    setBusy(false)
  }

  async function deleteProject(project: ProjectSummary): Promise<void> {
    if (!window.confirm(`确定删除“${project.name}”吗？此操作无法撤销。`)) return
    setBusy(true)
    const result = await catalog.deleteProject(project.id)
    if (result.kind === "saved") await loadProjects()
    else setState({ kind: "error" })
    setBusy(false)
  }

  return (
    <main className="project-home-shell">
      <header className="project-home-header">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            轻
          </span>
          <h1 className="brand-name">轻设</h1>
          <span className="project-home-location">本地项目</span>
        </div>
      </header>

      <section className="project-home-content" aria-labelledby="project-home-title">
        <div className="project-home-intro">
          <div>
            <h2 id="project-home-title">婚礼项目</h2>
            <p>所有方案、图片和素材引用仅保存在当前设备。</p>
          </div>
          <form className="project-create-form" onSubmit={(event) => void createProject(event)}>
            <label className="sr-only" htmlFor="new-project-name">
              新项目名称
            </label>
            <input
              id="new-project-name"
              className="search-field"
              aria-label="新项目名称"
              value={newProjectName}
              maxLength={80}
              placeholder="例如：林先生婚礼方案"
              disabled={busy}
              onChange={(event) => setNewProjectName(event.currentTarget.value)}
            />
            <button className="primary-button" type="submit" disabled={busy}>
              <Plus size={16} weight="bold" aria-hidden="true" />
              新建项目
            </button>
          </form>
        </div>

        {state.kind === "loading" && <p className="project-home-message">正在读取本地项目…</p>}
        {state.kind === "error" && (
          <p className="project-home-message notice-error" role="alert">
            本地项目读取失败，请刷新后重试。
          </p>
        )}
        {state.kind === "ready" && state.projects.length === 0 && (
          <div className="project-home-empty">
            <FolderOpen size={32} weight="thin" aria-hidden="true" />
            <p>还没有项目，在上方输入名称即可开始。</p>
          </div>
        )}
        {state.kind === "ready" && state.projects.length > 0 && (
          <ul className="project-grid" aria-label="项目列表">
            {state.projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                disabled={busy}
                onDelete={() => void deleteProject(project)}
                onDuplicate={() => void duplicateProject(project.id)}
                onOpen={() => openProject(project.id)}
                onRename={(name) => void renameProject(project.id, name)}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function ProjectCard({
  project,
  disabled,
  onDelete,
  onDuplicate,
  onOpen,
  onRename,
}: {
  readonly project: ProjectSummary
  readonly disabled: boolean
  readonly onDelete: () => void
  readonly onDuplicate: () => void
  readonly onOpen: () => void
  readonly onRename: (name: string) => void
}) {
  const coverUrl = useObjectUrl(project.coverBlob)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(project.name)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) nameInputRef.current?.focus()
  }, [editing])

  function commitName(): void {
    const normalized = draftName.trim()
    setEditing(false)
    if (normalized.length === 0) setDraftName(project.name)
    else if (normalized !== project.name) onRename(normalized)
  }

  return (
    <li className="project-card">
      <button
        className="project-card__open"
        type="button"
        aria-label={`打开${project.name}`}
        disabled={disabled}
        onClick={onOpen}
      >
        <span className="project-card__preview">
          {coverUrl === null ? (
            <ImageSquare size={32} weight="thin" aria-hidden="true" />
          ) : (
            <img src={coverUrl} alt="" />
          )}
        </span>
      </button>
      <div className="project-card__details">
        {editing ? (
          <input
            ref={nameInputRef}
            className="project-card__name-input"
            aria-label={`重命名${project.name}`}
            value={draftName}
            maxLength={80}
            onChange={(event) => setDraftName(event.currentTarget.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur()
              if (event.key === "Escape") {
                setDraftName(project.name)
                setEditing(false)
              }
            }}
          />
        ) : (
          <strong title={project.name}>{project.name}</strong>
        )}
        <time dateTime={new Date(project.updatedAt).toISOString()}>
          {formatUpdatedAt(project.updatedAt)}
        </time>
      </div>
      <div className="project-card__actions">
        <button
          className="icon-button"
          type="button"
          aria-label={`重命名${project.name}`}
          disabled={disabled}
          onClick={() => setEditing(true)}
        >
          <PencilSimple size={15} aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label={`复制${project.name}`}
          disabled={disabled}
          onClick={onDuplicate}
        >
          <Copy size={15} aria-hidden="true" />
        </button>
        <button
          className="icon-button danger-button"
          type="button"
          aria-label={`删除${project.name}`}
          disabled={disabled}
          onClick={onDelete}
        >
          <Trash size={15} aria-hidden="true" />
        </button>
      </div>
    </li>
  )
}

function openProject(id: ProjectId): void {
  window.location.assign(`/?project=${encodeURIComponent(id)}`)
}

function formatUpdatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp)
}
