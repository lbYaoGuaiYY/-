import type { Canvas, FabricImage } from "fabric"

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
  if (canvas.getActiveObject() === object && (!next.visible || next.locked)) {
    canvas.discardActiveObject()
  }
  canvas.requestRenderAll()
  return true
}
