import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import type { ReactNode } from "react"
import { useState } from "react"

import { AssetDragOverlay } from "../assets/DraggableAssetTile"
import { DEMO_ASSETS, type DemoAsset } from "../assets/demo-assets"
import {
  clientPointToLogicalCanvasPoint,
  EDITOR_CANVAS_DROP_ID,
  parseAssetDragPayload,
} from "./drag-placement"
import type { EditorController } from "./editor-controller"
import type { CanvasSize } from "./editor-model"

export type EditorDragContextProps = {
  readonly backgroundLoaded: boolean
  readonly canvasSize: CanvasSize
  readonly children: ReactNode
  readonly controller: EditorController | null
  readonly onRequestBackground: () => void
}

export function EditorDragContext({
  backgroundLoaded,
  canvasSize,
  children,
  controller,
  onRequestBackground,
}: EditorDragContextProps) {
  const [activeAsset, setActiveAsset] = useState<DemoAsset | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  function handleDragStart(event: DragStartEvent): void {
    setActiveAsset(findDemoAsset(event.active.data.current))
  }

  function handleDragEnd(event: DragEndEvent): void {
    const asset = findDemoAsset(event.active.data.current)
    setActiveAsset(null)
    if (asset === null) return
    if (!backgroundLoaded) {
      onRequestBackground()
      return
    }
    const translated = event.active.rect.current.translated
    if (event.over?.id !== EDITOR_CANVAS_DROP_ID || translated === null) return
    const result = clientPointToLogicalCanvasPoint(
      { x: translated.left + translated.width / 2, y: translated.top + translated.height / 2 },
      {
        x: event.over.rect.left,
        y: event.over.rect.top,
        width: event.over.rect.width,
        height: event.over.rect.height,
      },
      canvasSize,
    )
    if (result.kind === "valid") void controller?.addBuiltInAsset(asset, result.point)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragCancel={() => setActiveAsset(null)}
      onDragEnd={handleDragEnd}
    >
      {children}
      <DragOverlay>
        {activeAsset === null ? null : <AssetDragOverlay asset={activeAsset} />}
      </DragOverlay>
    </DndContext>
  )
}

function findDemoAsset(value: unknown): DemoAsset | null {
  const payload = parseAssetDragPayload(value)
  if (payload === null) return null
  const assetId = String(payload.assetId)
  if (!assetId.startsWith("built-in:")) return null
  return DEMO_ASSETS.find((asset) => asset.id === assetId.slice("built-in:".length)) ?? null
}
