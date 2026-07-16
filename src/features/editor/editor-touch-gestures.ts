export type TouchPoint = Readonly<{ x: number; y: number }>

export type TouchPanStart = Readonly<{
  left: number
  top: number
  x: number
  y: number
}>

export type TouchGestureMode = "fabric" | "pan" | "pinch"
export type PinchGestureTarget = "selection" | "viewport"

/**
 * A second finger always belongs to the canvas viewport. This prevents a
 * single-object transform from stealing a pinch that begins on a layer.
 */
export function getTouchGestureMode(
  touchCount: number,
  firstTouchStartedOnObject: boolean,
): TouchGestureMode {
  if (touchCount >= 2) return "pinch"
  return firstTouchStartedOnObject ? "fabric" : "pan"
}

export function getPinchGestureTarget(
  firstTouchStartedOnObject: boolean,
  canScaleSelection: boolean,
): PinchGestureTarget {
  return firstTouchStartedOnObject && canScaleSelection ? "selection" : "viewport"
}

export function getTouchPanScrollPosition(
  start: TouchPanStart,
  current: TouchPoint,
): Readonly<{ left: number; top: number }> {
  return {
    left: start.left + start.x - current.x,
    top: start.top + start.y - current.y,
  }
}

export function getPinchPanScrollPosition(
  start: TouchPanStart,
  currentCenter: TouchPoint,
): Readonly<{ left: number; top: number }> {
  return getTouchPanScrollPosition(start, currentCenter)
}

export function midpointBetweenTouchPoints(first: TouchPoint, second: TouchPoint): TouchPoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
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
