import type { Canvas } from "fabric"

export function applyFabricDisplaySize(
  canvas: Canvas,
  viewportWidth: number,
  viewportHeight: number,
): number {
  const width = canvas.getWidth()
  const height = canvas.getHeight()
  const scale = Math.min(
    Math.max(viewportWidth - 96, 160) / width,
    Math.max(viewportHeight - 64, 120) / height,
    1,
  )
  canvas.setDimensions(
    { width: `${Math.round(width * scale)}px`, height: `${Math.round(height * scale)}px` },
    { cssOnly: true },
  )
  canvas.calcOffset()
  return scale
}
