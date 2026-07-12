export type GeometryRect = {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export type AlignmentMode = "left" | "center-x" | "right" | "top" | "center-y" | "bottom"

export type DistributionMode = "horizontal" | "vertical"

export type PositionDelta = {
  readonly index: number
  readonly deltaX: number
  readonly deltaY: number
}

export type SnapGuide = {
  readonly axis: "x" | "y"
  readonly position: number
  readonly start: number
  readonly end: number
}

export type SnapResult = {
  readonly deltaX: number
  readonly deltaY: number
  readonly guides: readonly SnapGuide[]
}

type AxisCandidate = {
  readonly distance: number
  readonly delta: number
  readonly guide: SnapGuide
}

type SnapReference = {
  readonly kind: "canvas" | "object"
  readonly rect: GeometryRect
}

export function calculateSnap(
  moving: GeometryRect,
  objects: readonly GeometryRect[],
  canvas: GeometryRect,
  threshold: number,
): SnapResult {
  const references: readonly SnapReference[] = [
    { kind: "canvas", rect: canvas },
    ...objects.map((rect) => ({ kind: "object" as const, rect })),
  ]
  const horizontal = nearestCandidate(moving, references, "x", threshold)
  const vertical = nearestCandidate(moving, references, "y", threshold)
  return {
    deltaX: horizontal?.delta ?? 0,
    deltaY: vertical?.delta ?? 0,
    guides: [horizontal?.guide, vertical?.guide].flatMap((guide) =>
      guide === undefined ? [] : [guide],
    ),
  }
}

export function calculateAlignment(
  rectangles: readonly GeometryRect[],
  mode: AlignmentMode,
): readonly PositionDelta[] {
  const bounds = enclosingRect(rectangles)
  if (bounds === null) return []
  return rectangles.map((rect, index) => {
    switch (mode) {
      case "left":
        return { index, deltaX: bounds.left - rect.left, deltaY: 0 }
      case "center-x":
        return { index, deltaX: centerX(bounds) - centerX(rect), deltaY: 0 }
      case "right":
        return { index, deltaX: right(bounds) - right(rect), deltaY: 0 }
      case "top":
        return { index, deltaX: 0, deltaY: bounds.top - rect.top }
      case "center-y":
        return { index, deltaX: 0, deltaY: centerY(bounds) - centerY(rect) }
      case "bottom":
        return { index, deltaX: 0, deltaY: bottom(bounds) - bottom(rect) }
    }
    const unreachable: never = mode
    return unreachable
  })
}

export function calculateDistribution(
  rectangles: readonly GeometryRect[],
  mode: DistributionMode,
): readonly PositionDelta[] {
  const deltas = rectangles.map((_rect, index) => ({ index, deltaX: 0, deltaY: 0 }))
  if (rectangles.length < 3) return deltas
  const order = rectangles
    .map((_rect, index) => index)
    .sort(
      (leftIndex, rightIndex) =>
        axisStart(rectangles[leftIndex], mode) - axisStart(rectangles[rightIndex], mode),
    )
  const firstIndex = order[0]
  const lastIndex = order.at(-1)
  if (firstIndex === undefined || lastIndex === undefined) return deltas
  const first = rectangles[firstIndex]
  const last = rectangles[lastIndex]
  if (first === undefined || last === undefined) return deltas
  const span = axisEnd(last, mode) - axisStart(first, mode)
  const occupied = rectangles.reduce((total, rect) => total + axisSize(rect, mode), 0)
  const gap = (span - occupied) / (rectangles.length - 1)
  let cursor = axisEnd(first, mode) + gap
  for (const index of order.slice(1, -1)) {
    const rect = rectangles[index]
    if (rect === undefined) continue
    const delta = cursor - axisStart(rect, mode)
    deltas[index] = {
      index,
      deltaX: mode === "horizontal" ? delta : 0,
      deltaY: mode === "vertical" ? delta : 0,
    }
    cursor += axisSize(rect, mode) + gap
  }
  return deltas
}

function nearestCandidate(
  moving: GeometryRect,
  references: readonly SnapReference[],
  axis: "x" | "y",
  threshold: number,
): AxisCandidate | null {
  let nearest: AxisCandidate | null = null
  const movingAnchors = anchors(moving, axis)
  for (const reference of references) {
    for (const referencePosition of anchors(reference.rect, axis)) {
      for (const movingPosition of movingAnchors) {
        const delta = referencePosition - movingPosition
        const distance = Math.abs(delta)
        if (distance > threshold || (nearest !== null && distance >= nearest.distance)) continue
        nearest = {
          distance,
          delta,
          guide: createGuide(axis, referencePosition, moving, reference),
        }
      }
    }
  }
  return nearest
}

function createGuide(
  axis: "x" | "y",
  position: number,
  moving: GeometryRect,
  reference: SnapReference,
): SnapGuide {
  if (axis === "x") {
    return {
      axis,
      position,
      start:
        reference.kind === "canvas" ? reference.rect.top : Math.min(moving.top, reference.rect.top),
      end:
        reference.kind === "canvas"
          ? bottom(reference.rect)
          : Math.max(bottom(moving), bottom(reference.rect)),
    }
  }
  return {
    axis,
    position,
    start:
      reference.kind === "canvas"
        ? reference.rect.left
        : Math.min(moving.left, reference.rect.left),
    end:
      reference.kind === "canvas"
        ? right(reference.rect)
        : Math.max(right(moving), right(reference.rect)),
  }
}

function enclosingRect(rectangles: readonly GeometryRect[]): GeometryRect | null {
  const first = rectangles[0]
  if (first === undefined) return null
  const left = Math.min(...rectangles.map((rect) => rect.left))
  const top = Math.min(...rectangles.map((rect) => rect.top))
  const farRight = Math.max(...rectangles.map(right))
  const farBottom = Math.max(...rectangles.map(bottom))
  return { left, top, width: farRight - left, height: farBottom - top }
}

function anchors(rect: GeometryRect, axis: "x" | "y"): readonly number[] {
  return axis === "x"
    ? [rect.left, centerX(rect), right(rect)]
    : [rect.top, centerY(rect), bottom(rect)]
}

function axisStart(rect: GeometryRect | undefined, mode: DistributionMode): number {
  if (rect === undefined) return 0
  return mode === "horizontal" ? rect.left : rect.top
}

function axisSize(rect: GeometryRect, mode: DistributionMode): number {
  return mode === "horizontal" ? rect.width : rect.height
}

function axisEnd(rect: GeometryRect, mode: DistributionMode): number {
  return axisStart(rect, mode) + axisSize(rect, mode)
}

const centerX = (rect: GeometryRect): number => rect.left + rect.width / 2
const centerY = (rect: GeometryRect): number => rect.top + rect.height / 2
const right = (rect: GeometryRect): number => rect.left + rect.width
const bottom = (rect: GeometryRect): number => rect.top + rect.height
