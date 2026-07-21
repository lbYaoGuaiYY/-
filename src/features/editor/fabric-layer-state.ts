import { ActiveSelection, type Canvas, type FabricImage, type FabricObject } from "fabric"

import type { ImageLayer, LayerId } from "./editor-model"
import { applyFabricLayerState } from "./fabric-image"

export type FabricLayerMeta = Pick<ImageLayer, "assetId" | "name" | "visible" | "locked">

export function updateFabricLayerState(
  canvas: Canvas,
  layerObjects: ReadonlyMap<LayerId, FabricImage>,
  layerMeta: Map<LayerId, FabricLayerMeta>,
  id: LayerId,
  changes: Partial<Pick<ImageLayer, "visible" | "locked">>,
): boolean {
  const object = layerObjects.get(id)
  const meta = layerMeta.get(id)
  if (object === undefined || meta === undefined) return false
  const next = { ...meta, ...changes }
  if (next.visible === meta.visible && next.locked === meta.locked) return false
  layerMeta.set(id, next)
  applyFabricLayerState(object, next)
  if (!next.visible || next.locked)
    removeFromActiveSelection(canvas, object, layerObjects, layerMeta)
  canvas.requestRenderAll()
  return true
}

function removeFromActiveSelection(
  canvas: Canvas,
  removed: FabricImage,
  layerObjects: ReadonlyMap<LayerId, FabricImage>,
  layerMeta: ReadonlyMap<LayerId, FabricLayerMeta>,
): void {
  const activeObjects = canvas.getActiveObjects()
  if (!activeObjects.includes(removed)) return

  const remaining = activeObjects.filter((candidate) => {
    if (candidate === removed) return false
    for (const [id, object] of layerObjects) {
      if (object !== candidate) continue
      const meta = layerMeta.get(id)
      return meta?.visible === true && meta.locked === false
    }
    return false
  })

  canvas.discardActiveObject()
  if (remaining.length === 1) {
    const object = remaining[0]
    if (object !== undefined) canvas.setActiveObject(object)
  } else if (remaining.length > 1) {
    canvas.setActiveObject(new ActiveSelection(remaining as FabricObject[], { canvas }))
  }
}
