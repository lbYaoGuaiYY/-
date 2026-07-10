import { FabricImage, type FabricObject } from "fabric"

import type { AssetRecord } from "./asset-registry"
import type { ImageLayer, LayerTransform } from "./editor-model"

export type FabricLayerState = Pick<ImageLayer, "visible" | "locked">

export async function loadFabricImage(record: AssetRecord): Promise<FabricImage> {
  return FabricImage.fromURL(record.src, { crossOrigin: "anonymous" })
}

export function configureFabricImage(
  image: FabricImage,
  transform: LayerTransform,
  accentColor: string,
  state: FabricLayerState,
): void {
  image.set({
    left: transform.x,
    top: transform.y,
    originX: "center",
    originY: "center",
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    angle: transform.angle,
    flipX: transform.flipX,
    flipY: transform.flipY,
    opacity: transform.opacity,
    borderColor: accentColor,
    cornerColor: accentColor,
    cornerStrokeColor: accentColor,
    cornerStyle: "circle",
    cornerSize: 12,
    touchCornerSize: 44,
    transparentCorners: false,
  })
  applyFabricLayerState(image, state)
  image.setCoords()
}

export function applyFabricLayerState(image: FabricImage, state: FabricLayerState): void {
  const interactive = state.visible && !state.locked
  image.set({
    visible: state.visible,
    selectable: interactive,
    evented: interactive,
  })
}

export function readFabricTransform(object: FabricObject): LayerTransform {
  const center = object.getCenterPoint()
  return {
    x: center.x,
    y: center.y,
    scaleX: object.scaleX,
    scaleY: object.scaleY,
    angle: object.angle,
    flipX: object.flipX,
    flipY: object.flipY,
    opacity: object.opacity,
  }
}
