import { useDraggable } from "@dnd-kit/core"
import { Plus } from "@phosphor-icons/react"

import { createAssetDragPayload } from "../editor/drag-placement"
import type { LibraryAsset } from "./asset-library"

export type DraggableAssetTileProps = {
  readonly asset: LibraryAsset
  readonly onAdd: (asset: LibraryAsset) => void
}

export function DraggableAssetTile({ asset, onAdd }: DraggableAssetTileProps) {
  const draggable = useDraggable({
    id: `asset:${asset.id}`,
    data: createAssetDragPayload(asset.assetId),
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

export function AssetDragOverlay({ asset }: { readonly asset: LibraryAsset }) {
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
  readonly asset: LibraryAsset
  readonly showAddIcon: boolean
}) {
  return (
    <>
      <span className="asset-tile__preview">
        <img
          src={asset.thumbnailSrc ?? asset.src}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
        />
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
