import type { Canvas } from "fabric"

export const MIN_DISPLAY_SCALE = 0.1
export const MAX_DISPLAY_SCALE = 4

export function clampDisplayScale(scale: number): number {
  return Math.min(MAX_DISPLAY_SCALE, Math.max(MIN_DISPLAY_SCALE, scale))
}

export function calculateFitDisplayScale(
  canvasWidth: number,
  canvasHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  return Math.min(
    Math.max(viewportWidth - 96, 160) / canvasWidth,
    Math.max(viewportHeight - 64, 120) / canvasHeight,
    1,
  )
}

export function applyFabricDisplaySize(
  canvas: Canvas,
  viewportWidth: number,
  viewportHeight: number,
  requestedScale?: number,
): number {
  const width = canvas.getWidth()
  const height = canvas.getHeight()
  const scale =
    requestedScale === undefined
      ? calculateFitDisplayScale(width, height, viewportWidth, viewportHeight)
      : clampDisplayScale(requestedScale)
  canvas.setDimensions(
    { width: `${Math.round(width * scale)}px`, height: `${Math.round(height * scale)}px` },
    { cssOnly: true },
  )
  canvas.calcOffset()
  return scale
}
