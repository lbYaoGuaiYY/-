export type PixelBuffer = {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
}

export type PixelBounds = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const MIN_VISIBLE_ALPHA = 8

export function findVisiblePixelBounds({ data, width, height }: PixelBuffer): PixelBounds | null {
  if (width <= 0 || height <= 0) return null

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3] ?? 0
      if (alpha < MIN_VISIBLE_ALPHA) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  if (maxX < minX || maxY < minY) return null
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  }
}
