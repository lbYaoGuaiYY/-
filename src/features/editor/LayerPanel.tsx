import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { DotsSixVertical, Image, Stack, X } from "@phosphor-icons/react"
import { MousePenPointerSensor } from "./editor-drag-sensors"
import type { ImageLayer, LayerId } from "./editor-model"
import { LayerIdSchema } from "./editor-model"
import { toLayerPanelOrder } from "./layer-order"

export type LayerPanelProps = {
  readonly layers: readonly ImageLayer[]
  readonly selectedLayerId: LayerId | null
  readonly onClose: () => void
  readonly onReorder: (activeId: LayerId, targetId: LayerId) => void
  readonly onSelect: (id: LayerId) => void
}

const LAYER_SORT_INSTRUCTIONS = {
  draggable:
    "焦点位于图层排序手柄时，按空格键或回车键拿起图层，使用上下方向键调整前后顺序，再次按空格键或回车键放下，按 Escape 键取消。",
}

export function LayerPanel({
  layers,
  selectedLayerId,
  onClose,
  onReorder,
  onSelect,
}: LayerPanelProps) {
  const layerById = new Map(layers.map((layer) => [layer.id, layer]))
  const displayLayers = toLayerPanelOrder(layers.map((layer) => layer.id)).flatMap((id) => {
    const layer = layerById.get(id)
    return layer === undefined ? [] : [layer]
  })
  const sensors = useSensors(
    useSensor(MousePenPointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent): void {
    const activeId = LayerIdSchema.safeParse(event.active.id)
    const targetId = LayerIdSchema.safeParse(event.over?.id)
    if (activeId.success && targetId.success) onReorder(activeId.data, targetId.data)
  }

  return (
    <section className="panel-section" aria-labelledby="layers-title">
      <header className="panel-header">
        <h2 className="panel-title" id="layers-title">
          图层 <span className="panel-count">{layers.length}</span>
        </h2>
        <button
          className="icon-button mobile-panel-close"
          type="button"
          aria-label="关闭图层面板"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      {displayLayers.length === 0 ? (
        <div className="empty-state layer-empty">
          <Stack size={28} weight="thin" aria-hidden="true" />
          <p>添加的素材会按前后顺序显示在这里</p>
        </div>
      ) : (
        <DndContext
          accessibility={{
            announcements: createLayerAnnouncements(displayLayers),
            screenReaderInstructions: LAYER_SORT_INSTRUCTIONS,
          }}
          collisionDetection={closestCenter}
          sensors={sensors}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={displayLayers.map((layer) => layer.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="layer-list" data-testid="layer-list" aria-label="素材图层">
              {displayLayers.map((layer, index) => (
                <SortableLayerRow
                  key={layer.id}
                  layer={layer}
                  position={index + 1}
                  selected={layer.id === selectedLayerId}
                  total={displayLayers.length}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </section>
  )
}

function SortableLayerRow({
  layer,
  position,
  selected,
  total,
  onSelect,
}: {
  readonly layer: ImageLayer
  readonly position: number
  readonly selected: boolean
  readonly total: number
  readonly onSelect: (id: LayerId) => void
}) {
  const sortable = useSortable({ id: layer.id })
  return (
    <li
      ref={sortable.setNodeRef}
      className={`layer-row${selected ? " is-selected" : ""}${sortable.isDragging ? " is-sorting" : ""}`}
      data-testid={layerTestId(layer)}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
    >
      <button
        ref={sortable.setActivatorNodeRef}
        className="layer-drag-handle"
        data-testid={layerHandleTestId(layer)}
        type="button"
        {...sortable.attributes}
        {...sortable.listeners}
        aria-label={`调整${layer.name}图层顺序，当前位置${position}，共${total}层`}
        onFocus={() => onSelect(layer.id)}
      >
        <DotsSixVertical size={18} aria-hidden="true" />
      </button>
      <Image size={16} aria-hidden="true" />
      <button
        className="layer-select"
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(layer.id)}
      >
        <span className="layer-name" title={layer.name}>
          {layer.name}
        </span>
      </button>
      <span className="layer-meta">图片</span>
    </li>
  )
}

function createLayerAnnouncements(layers: readonly ImageLayer[]): Announcements {
  function describe(id: string | number): string {
    const index = layers.findIndex((layer) => layer.id === id)
    const layer = layers.at(index)
    return layer === undefined
      ? "图层"
      : `${layer.name}，当前位置${index + 1}，共${layers.length}层`
  }
  return {
    onDragStart: ({ active }) => `已拿起${describe(active.id)}。`,
    onDragOver: ({ active, over }) =>
      over === null
        ? `${describe(active.id)}已离开图层列表。`
        : `${describe(active.id)}将移动到${describe(over.id)}。`,
    onDragEnd: ({ active, over }) =>
      over === null
        ? `${describe(active.id)}未移动。`
        : `${describe(active.id)}已移动到${describe(over.id)}。`,
    onDragCancel: ({ active }) => `已取消移动${describe(active.id)}。`,
  }
}

function layerTestId(layer: ImageLayer): string {
  return `layer-item-${layerAssetSuffix(layer)}`
}

function layerHandleTestId(layer: ImageLayer): string {
  return `layer-sort-handle-${layerAssetSuffix(layer)}`
}

function layerAssetSuffix(layer: ImageLayer): string {
  const assetId = String(layer.assetId)
  return assetId.startsWith("built-in:") ? assetId.slice("built-in:".length) : String(layer.id)
}
