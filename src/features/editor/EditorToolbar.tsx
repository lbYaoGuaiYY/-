import {
  ArrowDown,
  ArrowLineDown,
  ArrowLineUp,
  ArrowUp,
  SidebarSimple,
  Trash,
} from "@phosphor-icons/react"

import type { LayerDirection } from "./fabric-runtime"

export type EditorToolbarProps = {
  readonly hasSelection: boolean
  readonly onDelete: () => void
  readonly onMoveLayer: (direction: LayerDirection) => void
  readonly onToggleAssets: () => void
}

export function EditorToolbar({
  hasSelection,
  onDelete,
  onMoveLayer,
  onToggleAssets,
}: EditorToolbarProps) {
  return (
    <nav className="context-toolbar" aria-label="画布工具">
      <div className="toolbar-group">
        <button
          className="icon-button"
          data-testid="asset-panel-toggle"
          type="button"
          aria-label="素材面板"
          onClick={onToggleAssets}
        >
          <SidebarSimple size={17} aria-hidden="true" />
        </button>
        <span className="toolbar-label">排列</span>
        <button
          className="icon-button"
          type="button"
          aria-label="上移一层"
          disabled={!hasSelection}
          onClick={() => onMoveLayer("up")}
        >
          <ArrowUp size={16} aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="下移一层"
          disabled={!hasSelection}
          onClick={() => onMoveLayer("down")}
        >
          <ArrowDown size={16} aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="置于顶层"
          disabled={!hasSelection}
          onClick={() => onMoveLayer("front")}
        >
          <ArrowLineUp size={16} aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="置于底层"
          disabled={!hasSelection}
          onClick={() => onMoveLayer("back")}
        >
          <ArrowLineDown size={16} aria-hidden="true" />
        </button>
      </div>
      <button
        className="icon-button danger-button"
        type="button"
        aria-label="删除所选素材"
        disabled={!hasSelection}
        onClick={onDelete}
      >
        <Trash size={16} aria-hidden="true" />
      </button>
    </nav>
  )
}
