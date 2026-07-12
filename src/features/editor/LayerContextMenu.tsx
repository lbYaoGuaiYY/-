import { ArrowDown, ArrowUp, Copy, CopySimple, Scissors, Trash } from "@phosphor-icons/react"
import { type ReactNode, useEffect, useRef } from "react"
import { createPortal } from "react-dom"

import type { ImageLayer, LayerId } from "./editor-model"
import type { LayerDirection } from "./fabric-runtime"

export type LayerContextMenuProps = {
  readonly canPaste: boolean
  readonly editable?: boolean
  readonly layer: ImageLayer
  readonly menuLabel?: string
  readonly x: number
  readonly y: number
  readonly onClose: () => void
  readonly onCopy: (id: LayerId) => void
  readonly onCut: (id: LayerId) => void
  readonly onDelete: (id: LayerId) => void
  readonly onDuplicate: (id: LayerId) => void
  readonly onMove: (id: LayerId, direction: LayerDirection) => void
  readonly onPaste: () => void
}

export function LayerContextMenu({
  canPaste,
  editable: editableOverride,
  layer,
  menuLabel,
  x,
  y,
  onClose,
  onCopy,
  onCut,
  onDelete,
  onDuplicate,
  onMove,
  onPaste,
}: LayerContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const editable = editableOverride ?? (layer.visible && !layer.locked)

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus()
    function handlePointerDown(event: PointerEvent): void {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      onClose()
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    window.addEventListener("blur", onClose)
    window.addEventListener("resize", onClose)
    window.addEventListener("scroll", onClose, true)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("blur", onClose)
      window.removeEventListener("resize", onClose)
      window.removeEventListener("scroll", onClose, true)
    }
  }, [onClose])

  function run(action: () => void): void {
    action()
    onClose()
  }

  return createPortal(
    <div
      ref={menuRef}
      className="layer-context-menu"
      data-testid="layer-context-menu"
      role="menu"
      aria-label={menuLabel ?? `${layer.name}图层操作`}
      style={{ left: x, top: y }}
    >
      <MenuItem
        label="剪切"
        shortcut="Ctrl+X"
        disabled={!editable}
        onClick={() => run(() => onCut(layer.id))}
      >
        <Scissors size={16} aria-hidden="true" />
      </MenuItem>
      <MenuItem label="复制" shortcut="Ctrl+C" onClick={() => run(() => onCopy(layer.id))}>
        <Copy size={16} aria-hidden="true" />
      </MenuItem>
      <MenuItem label="粘贴" shortcut="Ctrl+V" disabled={!canPaste} onClick={() => run(onPaste)}>
        <CopySimple size={16} aria-hidden="true" />
      </MenuItem>
      <MenuItem
        label="创建副本"
        shortcut="Ctrl+D"
        disabled={!editable}
        onClick={() => run(() => onDuplicate(layer.id))}
      >
        <CopySimple size={16} weight="fill" aria-hidden="true" />
      </MenuItem>
      <hr className="layer-context-menu__separator" />
      <MenuItem
        label="置于顶层"
        disabled={!editable}
        onClick={() => run(() => onMove(layer.id, "front"))}
      >
        <ArrowUp size={16} aria-hidden="true" />
      </MenuItem>
      <MenuItem
        label="置于底层"
        disabled={!editable}
        onClick={() => run(() => onMove(layer.id, "back"))}
      >
        <ArrowDown size={16} aria-hidden="true" />
      </MenuItem>
      <hr className="layer-context-menu__separator" />
      <MenuItem
        label="删除"
        shortcut="Delete"
        danger
        disabled={!editable}
        onClick={() => run(() => onDelete(layer.id))}
      >
        <Trash size={16} aria-hidden="true" />
      </MenuItem>
    </div>,
    document.body,
  )
}

function MenuItem({
  children,
  danger = false,
  disabled = false,
  label,
  shortcut,
  onClick,
}: {
  readonly children: ReactNode
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly label: string
  readonly shortcut?: string
  readonly onClick: () => void
}) {
  return (
    <button
      className={`layer-context-menu__item${danger ? " is-danger" : ""}`}
      type="button"
      role="menuitem"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
      {shortcut !== undefined && <kbd>{shortcut}</kbd>}
    </button>
  )
}
