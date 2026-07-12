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
import { useMemo, useState } from "react"
import type { LibraryAsset } from "../assets/asset-library"
import { AssetDragOverlay } from "../assets/DraggableAssetTile"
import { clientPointToLogicalCanvasPoint, EDITOR_CANVAS_DROP_ID } from "./drag-placement"
import {
  createEditorDragAnnouncements,
  EDITOR_SCREEN_READER_INSTRUCTIONS,
  findLibraryAssetFromDragData,
} from "./editor-drag-accessibility"
import { editorKeyboardCoordinates, MousePenPointerSensor } from "./editor-drag-sensors"
import type { CanvasSize } from "./editor-model"

const MOUSE_SENSOR_OPTIONS = { activationConstraint: { distance: 8 } } as const
const TOUCH_SENSOR_OPTIONS = { activationConstraint: { delay: 180, tolerance: 8 } } as const
const KEYBOARD_SENSOR_OPTIONS = { coordinateGetter: editorKeyboardCoordinates } as const

export type EditorDragContextProps = {
  readonly assets: readonly LibraryAsset[]
  readonly backgroundLoaded: boolean
  readonly canvasSize: CanvasSize
  readonly children: ReactNode
  readonly onAssetDragStart: (() => void) | undefined
  readonly onPlaceAsset: (
    asset: LibraryAsset,
    center: { readonly x: number; readonly y: number },
  ) => void
  readonly onRequestBackground: () => void
}

export function EditorDragContext({
  assets,
  backgroundLoaded,
  canvasSize,
  children,
  onAssetDragStart,
  onPlaceAsset,
  onRequestBackground,
}: EditorDragContextProps) {
  const [activeAsset, setActiveAsset] = useState<LibraryAsset | null>(null)
  const announcements = useMemo(() => createEditorDragAnnouncements(assets), [assets])
  const sensors = useSensors(
    useSensor(MousePenPointerSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(TouchSensor, TOUCH_SENSOR_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS),
  )

  function handleDragStart(event: DragStartEvent): void {
    const asset = findLibraryAssetFromDragData(event.active.data.current, assets)
    setActiveAsset(asset)
    if (asset !== null) onAssetDragStart?.()
  }

  function handleDragEnd(event: DragEndEvent): void {
    const asset = findLibraryAssetFromDragData(event.active.data.current, assets)
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
    if (result.kind === "valid") onPlaceAsset(asset, result.point)
  }

  return (
    <DndContext
      accessibility={{
        announcements,
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
