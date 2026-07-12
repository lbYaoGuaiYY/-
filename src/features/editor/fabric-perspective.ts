import type { FabricImage, FabricObject } from "fabric"

import { disposePerspectiveRenderer, renderPerspectiveImage } from "./perspective-warp"

const originalSources = new WeakMap<FabricImage, HTMLCanvasElement>()
const perspectiveAngles = new WeakMap<FabricObject, number>()

export function applyFabricPerspective(image: FabricImage, perspectiveX: number): void {
  applyFabricOrientation(image, perspectiveX)
}

export function applyFabricPerspectivePreview(image: FabricImage, perspectiveX: number): void {
  applyFabricOrientation(image, perspectiveX)
}

function applyFabricOrientation(image: FabricImage, perspectiveX: number): void {
  const source = getOriginalSource(image)
  perspectiveAngles.set(image, perspectiveX)
  image.set({ skewY: 0 })
  image.setElement(renderPerspectiveImage(source, perspectiveX))
}

export function readFabricPerspective(object: FabricObject): number {
  return perspectiveAngles.get(object) ?? 0
}

export function disposeFabricPerspective(image: FabricImage): void {
  const source = originalSources.get(image)
  if (source !== undefined) disposePerspectiveRenderer(source)
  originalSources.delete(image)
  perspectiveAngles.delete(image)
}

function copyFabricSource(image: FabricImage): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(image.width))
  canvas.height = Math.max(1, Math.round(image.height))
  const context = canvas.getContext("2d")
  if (context === null) throw new FabricPerspectiveContextUnavailableError()
  context.drawImage(image.getElement(), 0, 0, canvas.width, canvas.height)
  return canvas
}

function getOriginalSource(image: FabricImage): HTMLCanvasElement {
  const source = originalSources.get(image)
  if (source !== undefined) return source
  const copied = copyFabricSource(image)
  originalSources.set(image, copied)
  return copied
}

class FabricPerspectiveContextUnavailableError extends Error {
  readonly name = "FabricPerspectiveContextUnavailableError"
}
