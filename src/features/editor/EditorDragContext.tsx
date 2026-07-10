import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import type { ReactNode } from "react"
import { useState } from "react"

import { AssetDragOverlay } from "../assets/DraggableAssetTile"
import type { DemoAsset } from "../assets/demo-assets"
import { clientPointToLogicalCanvasPoint, EDITOR_CANVAS_DROP_ID } from "./drag-placement"
import type { EditorController } from "./editor-controller"
import {
  EDITOR_DRAG_ANNOUNCEMENTS,
  EDITOR_SCREEN_READER_INSTRUCTIONS,
  findDemoAssetFromDragData,
} from "./editor-drag-accessibility"
import { editorKeyboardCoordinates, MousePenPointerSensor } from "./editor-drag-sensors"
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
    useSensor(MousePenPointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: editorKeyboardCoordinates }),
  )

  function handleDragStart(event: DragStartEvent): void {
    setActiveAsset(findDemoAssetFromDragData(event.active.data.current))
  }

  function handleDragEnd(event: DragEndEvent): void {
    const asset = findDemoAssetFromDragData(event.active.data.current)
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
      accessibility={{
        announcements: EDITOR_DRAG_ANNOUNCEMENTS,
        screenReaderInstructions: EDITOR_SCREEN_READER_INSTRUCTIONS,
      }}
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
