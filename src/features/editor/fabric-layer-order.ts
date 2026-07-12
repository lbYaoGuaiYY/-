import type { Canvas, FabricImage, FabricObject } from "fabric"

import type { LayerId } from "./editor-model"

export type LayerDirection = "up" | "down" | "front" | "back"

class UnexpectedLayerDirectionError extends Error {
  readonly name = "UnexpectedLayerDirectionError"
}

export function moveFabricSelection(canvas: Canvas, direction: LayerDirection): boolean {
  const selectedObjects = canvas.getActiveObjects()
  if (selectedObjects.length === 0) return false
  const selected = new Set<FabricObject>(selectedObjects)
  const current = canvas.getObjects()
  let next: FabricObject[]
  switch (direction) {
    case "up":
      next = [...current]
      for (let index = next.length - 2; index >= 0; index -= 1) {
        const object = next[index]
        const following = next[index + 1]
        if (
          object !== undefined &&
          following !== undefined &&
          selected.has(object) &&
          !selected.has(following)
        ) {
          next[index] = following
          next[index + 1] = object
        }
      }
      break
    case "down":
      next = [...current]
      for (let index = 1; index < next.length; index += 1) {
        const object = next[index]
        const previous = next[index - 1]
        if (
          object !== undefined &&
          previous !== undefined &&
          selected.has(object) &&
          !selected.has(previous)
        ) {
          next[index] = previous
          next[index - 1] = object
        }
      }
      break
    case "front":
      next = [
        ...current.filter((object) => !selected.has(object)),
        ...current.filter((object) => selected.has(object)),
      ]
      break
    case "back":
      next = [
        ...current.filter((object) => selected.has(object)),
        ...current.filter((object) => !selected.has(object)),
      ]
      break
    default:
      throw new UnexpectedLayerDirectionError(`Unexpected layer direction: ${String(direction)}`)
  }
  if (current.every((object, index) => object === next[index])) return false
  next.forEach((object, index) => {
    canvas.moveObjectTo(object, index)
  })
  canvas.requestRenderAll()
  return true
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
