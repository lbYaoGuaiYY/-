import {
  type Activators,
  type KeyboardCoordinateGetter,
  PointerSensor,
  type PointerSensorOptions,
} from "@dnd-kit/core"

import { EDITOR_CANVAS_DROP_ID } from "./drag-placement"

const KEYBOARD_STEP = 16

export const editorKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context, currentCoordinates },
) => {
  const canvasRect = context.droppableRects.get(EDITOR_CANVAS_DROP_ID)
  const activeRect = context.collisionRect
  if (canvasRect === undefined || activeRect === null) return undefined

  const currentCenter = {
    x: currentCoordinates.x + activeRect.width / 2,
    y: currentCoordinates.y + activeRect.height / 2,
  }
  const isInsideCanvas =
    currentCenter.x >= canvasRect.left &&
    currentCenter.x <= canvasRect.right &&
    currentCenter.y >= canvasRect.top &&
    currentCenter.y <= canvasRect.bottom
  if (!isInsideCanvas) {
    return {
      x: canvasRect.left + (canvasRect.width - activeRect.width) / 2,
      y: canvasRect.top + (canvasRect.height - activeRect.height) / 2,
    }
  }

  const step = event.shiftKey ? KEYBOARD_STEP * 5 : KEYBOARD_STEP
  switch (event.code) {
    case "ArrowRight":
      return { ...currentCoordinates, x: currentCoordinates.x + step }
    case "ArrowLeft":
      return { ...currentCoordinates, x: currentCoordinates.x - step }
    case "ArrowDown":
      return { ...currentCoordinates, y: currentCoordinates.y + step }
    case "ArrowUp":
      return { ...currentCoordinates, y: currentCoordinates.y - step }
    default:
      return undefined
  }
}

export class MousePenPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: event }, { onActivation }) => {
        if (!event.isPrimary || event.button !== 0 || event.pointerType === "touch") return false
        onActivation?.({ event })
        return true
      },
    },
  ] satisfies Activators<PointerSensorOptions>
}
