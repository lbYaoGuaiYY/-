import { FabricImage, type FabricObject } from "fabric"

import type { AssetRecord } from "./asset-registry"
import type { ImageLayer, LayerTransform } from "./editor-model"
import { applyFabricPerspective, readFabricPerspective } from "./fabric-perspective"
import { findVisiblePixelBounds } from "./image-alpha-bounds"

export type FabricLayerState = Pick<ImageLayer, "visible" | "locked">

export type LoadedFabricLayerImage = {
  readonly image: FabricImage
  readonly sourceWidth: number
  readonly sourceHeight: number
}

export async function loadFabricImage(record: AssetRecord): Promise<FabricImage> {
  return FabricImage.fromURL(record.src, { crossOrigin: "anonymous" })
}

export async function loadFabricLayerImage(record: AssetRecord): Promise<LoadedFabricLayerImage> {
  const image = await loadFabricImage(record)
  const sourceWidth = Math.round(image.width)
  const sourceHeight = Math.round(image.height)
  const loaded = { image, sourceWidth, sourceHeight }
  if (sourceWidth <= 0 || sourceHeight <= 0) return loaded

  const canvas = document.createElement("canvas")
  canvas.width = sourceWidth
  canvas.height = sourceHeight
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (context === null) return loaded
  context.drawImage(image.getElement(), 0, 0, sourceWidth, sourceHeight)
  const bounds = findVisiblePixelBounds({
    data: context.getImageData(0, 0, sourceWidth, sourceHeight).data,
    width: sourceWidth,
    height: sourceHeight,
  })
  if (
    bounds === null ||
    (bounds.x === 0 &&
      bounds.y === 0 &&
      bounds.width === sourceWidth &&
      bounds.height === sourceHeight)
  ) {
    return loaded
  }

  const croppedCanvas = document.createElement("canvas")
  croppedCanvas.width = bounds.width
  croppedCanvas.height = bounds.height
  const croppedContext = croppedCanvas.getContext("2d")
  if (croppedContext === null) return loaded
  croppedContext.drawImage(
    canvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height,
  )
  return { image: new FabricImage(croppedCanvas), sourceWidth, sourceHeight }
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
    skewX: transform.skewX ?? 0,
    skewY: transform.skewY ?? 0,
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
    minScaleLimit: 0.01,
    transparentCorners: false,
  })
  applyFabricPerspective(image, transform.perspectiveX ?? 0)
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
  const scaling = object.getObjectScaling()
  return {
    x: finiteOr(center.x, 0),
    y: finiteOr(center.y, 0),
    scaleX: positiveOr(scaling.x, 1),
    scaleY: positiveOr(scaling.y, 1),
    skewX: finiteOr(object.skewX, 0),
    skewY: finiteOr(object.skewY, 0),
    perspectiveX: readFabricPerspective(object),
    angle: finiteOr(object.getTotalAngle(), 0),
    flipX: object.flipX,
    flipY: object.flipY,
    opacity: Math.min(1, Math.max(0, finiteOr(object.opacity, 1))),
  }
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function positiveOr(value: number, fallback: number): number {
  const normalized = Math.abs(finiteOr(value, fallback))
  return normalized > 0 ? normalized : fallback
}
