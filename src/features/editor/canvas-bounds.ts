export type CanvasObjectBounds = Readonly<{
  left: number
  top: number
  width: number
  height: number
}>

export type CanvasBounds = Readonly<{
  width: number
  height: number
}>

/**
 * Returns the smallest translation that keeps a transformed layer reachable
 * inside the logical canvas. Oversized layers stay centered so their controls
 * cannot be dragged permanently offscreen.
 */
export function getCanvasBoundsTranslation(
  bounds: CanvasObjectBounds,
  canvas: CanvasBounds,
): Readonly<{ x: number; y: number }> {
  return {
    x: getAxisTranslation(bounds.left, bounds.width, canvas.width),
    y: getAxisTranslation(bounds.top, bounds.height, canvas.height),
  }
}

function getAxisTranslation(start: number, length: number, containerLength: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(length) || !Number.isFinite(containerLength))
    return 0
  if (length <= 0 || containerLength <= 0) return 0
  if (length >= containerLength) return containerLength / 2 - (start + length / 2)
  if (start < 0) return -start
  if (start + length > containerLength) return containerLength - (start + length)
  return 0
}
