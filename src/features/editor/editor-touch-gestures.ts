export type TouchPoint = Readonly<{ x: number; y: number }>

export type TouchPanStart = Readonly<{
  left: number
  top: number
  x: number
  y: number
}>

export function getTouchPanScrollPosition(
  start: TouchPanStart,
  current: TouchPoint,
): Readonly<{ left: number; top: number }> {
  return {
    left: start.left + start.x - current.x,
    top: start.top + start.y - current.y,
  }
}

export function getPinchZoomPercent(
  startDistance: number,
  currentDistance: number,
  startZoomPercent: number,
): number {
  if (startDistance <= 0 || currentDistance <= 0) return startZoomPercent
  return Math.min(
    400,
    Math.max(25, Math.round(startZoomPercent * (currentDistance / startDistance))),
  )
}

export function distanceBetweenTouchPoints(first: TouchPoint, second: TouchPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y)
}
