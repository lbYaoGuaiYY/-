import { type AssetId, AssetIdSchema, type CanvasSize } from "./editor-model"

export const EDITOR_CANVAS_DROP_ID = "editor-canvas-drop" as const

export type ClientPoint = {
  readonly x: number
  readonly y: number
}

export type CanvasDisplayRect = ClientPoint & {
  readonly width: number
  readonly height: number
}

export type AssetDisplaySize = {
  readonly width: number
  readonly height: number
}

export type AssetDragPayload = {
  readonly kind: "asset"
  readonly assetId: AssetId
}

export type LayerPlacementRequest = {
  readonly canvasSize: CanvasSize
  readonly center: ClientPoint | null
}

export type PlacementResult =
  | { readonly kind: "valid"; readonly point: ClientPoint }
  | {
      readonly kind: "invalid"
      readonly reason: "non_finite" | "invalid_size" | "outside_canvas"
    }

export function createAssetDragPayload(assetId: AssetId): AssetDragPayload {
  return { kind: "asset", assetId }
}

export function parseAssetDragPayload(value: unknown): AssetDragPayload | null {
  if (typeof value !== "object" || value === null || !("kind" in value) || !("assetId" in value)) {
    return null
  }
  if (value.kind !== "asset") return null
  const assetId = AssetIdSchema.safeParse(value.assetId)
  return assetId.success ? { kind: "asset", assetId: assetId.data } : null
}

export function clientPointToLogicalCanvasPoint(
  point: ClientPoint,
  displayRect: CanvasDisplayRect,
  canvasSize: CanvasSize,
): PlacementResult {
  const numericInputs = [
    point.x,
    point.y,
    displayRect.x,
    displayRect.y,
    displayRect.width,
    displayRect.height,
    canvasSize.width,
    canvasSize.height,
  ]
  if (!numericInputs.every(Number.isFinite)) {
    return { kind: "invalid", reason: "non_finite" }
  }
  if (
    displayRect.width <= 0 ||
    displayRect.height <= 0 ||
    canvasSize.width <= 0 ||
    canvasSize.height <= 0
  ) {
    return { kind: "invalid", reason: "invalid_size" }
  }
  if (
    point.x < displayRect.x ||
    point.x > displayRect.x + displayRect.width ||
    point.y < displayRect.y ||
    point.y > displayRect.y + displayRect.height
  ) {
    return { kind: "invalid", reason: "outside_canvas" }
  }
  return {
    kind: "valid",
    point: {
      x: ((point.x - displayRect.x) * canvasSize.width) / displayRect.width,
      y: ((point.y - displayRect.y) * canvasSize.height) / displayRect.height,
    },
  }
}

export function clampAssetCenter(
  point: ClientPoint,
  assetSize: AssetDisplaySize,
  canvasSize: CanvasSize,
): PlacementResult {
  const numericInputs = [
    point.x,
    point.y,
    assetSize.width,
    assetSize.height,
    canvasSize.width,
    canvasSize.height,
  ]
  if (!numericInputs.every(Number.isFinite)) {
    return { kind: "invalid", reason: "non_finite" }
  }
  if (
    assetSize.width <= 0 ||
    assetSize.height <= 0 ||
    canvasSize.width <= 0 ||
    canvasSize.height <= 0
  ) {
    return { kind: "invalid", reason: "invalid_size" }
  }
  return {
    kind: "valid",
    point: {
      x: clampAxis(point.x, assetSize.width, canvasSize.width),
      y: clampAxis(point.y, assetSize.height, canvasSize.height),
    },
  }
}

function clampAxis(center: number, assetLength: number, canvasLength: number): number {
  if (assetLength >= canvasLength) return canvasLength / 2
  const halfLength = assetLength / 2
  return Math.min(canvasLength - halfLength, Math.max(halfLength, center))
}
