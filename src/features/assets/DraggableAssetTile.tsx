import { useDraggable } from "@dnd-kit/core"
import { Plus } from "@phosphor-icons/react"

import { createAssetDragPayload } from "../editor/drag-placement"
import { createAssetId } from "../editor/editor-model"
import type { DemoAsset } from "./demo-assets"

export type DraggableAssetTileProps = {
  readonly asset: DemoAsset
  readonly onAdd: (asset: DemoAsset) => void
}

export function DraggableAssetTile({ asset, onAdd }: DraggableAssetTileProps) {
  const draggable = useDraggable({
    id: `asset:${asset.id}`,
    data: createAssetDragPayload(createAssetId(`built-in:${asset.id}`)),
  })
  return (
    <button
      ref={draggable.setNodeRef}
      className={`asset-tile${draggable.isDragging ? " is-dragging" : ""}`}
      data-testid={`asset-card-${asset.id}`}
      type="button"
      title={`拖拽或点击添加${asset.name}`}
      aria-label={`添加素材：${asset.name}`}
      onClick={() => onAdd(asset)}
      {...draggable.attributes}
      {...draggable.listeners}
    >
      <AssetTileContent asset={asset} showAddIcon />
    </button>
  )
}

export function AssetDragOverlay({ asset }: { readonly asset: DemoAsset }) {
  return (
    <div className="asset-drag-overlay" data-testid="asset-drag-overlay">
      <AssetTileContent asset={asset} showAddIcon={false} />
    </div>
  )
}

function AssetTileContent({
  asset,
  showAddIcon,
}: {
  readonly asset: DemoAsset
  readonly showAddIcon: boolean
}) {
  return (
    <>
      <span className="asset-tile__preview">
        <img src={asset.src} alt="" draggable={false} />
      </span>
      <span className="asset-tile__details">
        <span className="asset-tile__name">{asset.name}</span>
        <span className="asset-tile__category">{asset.category}</span>
      </span>
      {showAddIcon && (
        <Plus className="asset-tile__add-icon" aria-hidden="true" size={16} weight="bold" />
      )}
    </>
  )
}
