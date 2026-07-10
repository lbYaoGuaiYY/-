import type { Canvas, FabricImage } from "fabric"

import type { LayerId } from "./editor-model"

export type LayerDirection = "up" | "down" | "front" | "back"

class UnexpectedLayerDirectionError extends Error {
  readonly name = "UnexpectedLayerDirectionError"
}

export function moveFabricSelection(canvas: Canvas, direction: LayerDirection): boolean {
  const object = canvas.getActiveObject()
  if (object === undefined) return false
  switch (direction) {
    case "up":
      return canvas.bringObjectForward(object)
    case "down":
      return canvas.sendObjectBackwards(object)
    case "front":
      return canvas.moveObjectTo(object, canvas.getObjects().length - 1)
    case "back":
      return canvas.moveObjectTo(object, 0)
    default:
      throw new UnexpectedLayerDirectionError(`Unexpected layer direction: ${String(direction)}`)
  }
}

export function reorderFabricLayers(
  canvas: Canvas,
  layerObjects: ReadonlyMap<LayerId, FabricImage>,
  order: readonly LayerId[],
): boolean {
  if (order.length !== canvas.getObjects().length) return false
  const nextObjects: FabricImage[] = []
  for (const id of order) {
    const object = layerObjects.get(id)
    if (object === undefined) return false
    nextObjects.push(object)
  }
  const currentObjects = canvas.getObjects()
  if (currentObjects.every((object, index) => object === nextObjects[index])) return false
  nextObjects.forEach((object, index) => {
    canvas.moveObjectTo(object, index)
  })
  canvas.requestRenderAll()
  return true
}
