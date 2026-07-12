import {
  AlignBottomSimple,
  AlignCenterHorizontalSimple,
  AlignCenterVerticalSimple,
  AlignLeftSimple,
  AlignRightSimple,
  AlignTopSimple,
  ArrowDown,
  ArrowLineDown,
  ArrowLineUp,
  ArrowsOutLineHorizontal,
  ArrowsOutLineVertical,
  ArrowUp,
  SidebarSimple,
  Trash,
} from "@phosphor-icons/react"

import type { AlignmentMode, DistributionMode, LayerDirection } from "./fabric-runtime"

export type EditorToolbarProps = {
  readonly canArrange: boolean
  readonly canAlign: boolean
  readonly canDelete: boolean
  readonly canDistribute: boolean
  readonly onAlign: (mode: AlignmentMode) => void
  readonly onDelete: () => void
  readonly onDistribute: (mode: DistributionMode) => void
  readonly onMoveLayer: (direction: LayerDirection) => void
  readonly onToggleAssets: () => void
}

export function EditorToolbar({
  canArrange,
  canAlign,
  canDelete,
  canDistribute,
  onAlign,
  onDelete,
  onDistribute,
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
        <span className="toolbar-label">层级</span>
        <button
          className="icon-button"
          type="button"
          aria-label="上移一层"
          disabled={!canArrange}
          onClick={() => onMoveLayer("up")}
        >
          <ArrowUp size={16} aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="下移一层"
          disabled={!canArrange}
          onClick={() => onMoveLayer("down")}
        >
          <ArrowDown size={16} aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="置于顶层"
          disabled={!canArrange}
          onClick={() => onMoveLayer("front")}
        >
          <ArrowLineUp size={16} aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="置于底层"
          disabled={!canArrange}
          onClick={() => onMoveLayer("back")}
        >
          <ArrowLineDown size={16} aria-hidden="true" />
        </button>
        <span className="toolbar-divider" aria-hidden="true" />
        <span className="toolbar-label">对齐</span>
        <AlignmentButton label="左对齐" mode="left" disabled={!canAlign} onAlign={onAlign}>
          <AlignLeftSimple size={16} aria-hidden="true" />
        </AlignmentButton>
        <AlignmentButton label="水平居中" mode="center-x" disabled={!canAlign} onAlign={onAlign}>
          <AlignCenterHorizontalSimple size={16} aria-hidden="true" />
        </AlignmentButton>
        <AlignmentButton label="右对齐" mode="right" disabled={!canAlign} onAlign={onAlign}>
          <AlignRightSimple size={16} aria-hidden="true" />
        </AlignmentButton>
        <AlignmentButton label="顶对齐" mode="top" disabled={!canAlign} onAlign={onAlign}>
          <AlignTopSimple size={16} aria-hidden="true" />
        </AlignmentButton>
        <AlignmentButton label="垂直居中" mode="center-y" disabled={!canAlign} onAlign={onAlign}>
          <AlignCenterVerticalSimple size={16} aria-hidden="true" />
        </AlignmentButton>
        <AlignmentButton label="底对齐" mode="bottom" disabled={!canAlign} onAlign={onAlign}>
          <AlignBottomSimple size={16} aria-hidden="true" />
        </AlignmentButton>
        <span className="toolbar-divider" aria-hidden="true" />
        <span className="toolbar-label">分布</span>
        <button
          className="icon-button"
          type="button"
          title="水平等距分布"
          aria-label="水平等距分布"
          disabled={!canDistribute}
          onClick={() => onDistribute("horizontal")}
        >
          <ArrowsOutLineHorizontal size={16} aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          type="button"
          title="垂直等距分布"
          aria-label="垂直等距分布"
          disabled={!canDistribute}
          onClick={() => onDistribute("vertical")}
        >
          <ArrowsOutLineVertical size={16} aria-hidden="true" />
        </button>
      </div>
      <button
        className="icon-button danger-button"
        type="button"
        aria-label="删除所选素材"
        disabled={!canDelete}
        onClick={onDelete}
      >
        <Trash size={16} aria-hidden="true" />
      </button>
    </nav>
  )
}

function AlignmentButton({
  children,
  disabled,
  label,
  mode,
  onAlign,
}: {
  readonly children: React.ReactNode
  readonly disabled: boolean
  readonly label: string
  readonly mode: AlignmentMode
  readonly onAlign: (mode: AlignmentMode) => void
}) {
  return (
    <button
      className="icon-button"
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={() => onAlign(mode)}
    >
      {children}
    </button>
  )
}
