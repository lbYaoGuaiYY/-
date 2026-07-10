import { z } from "zod"

export const AssetIdSchema = z.string().trim().min(1).brand("AssetId")
export const LayerIdSchema = z.string().trim().min(1).brand("LayerId")

export type AssetId = z.infer<typeof AssetIdSchema>
export type LayerId = z.infer<typeof LayerIdSchema>

export type CanvasSize = {
  readonly width: number
  readonly height: number
}

export type LayerTransform = {
  readonly x: number
  readonly y: number
  readonly scaleX: number
  readonly scaleY: number
  readonly angle: number
  readonly flipX: boolean
  readonly flipY: boolean
  readonly opacity: number
}

export type ImageLayer = {
  readonly id: LayerId
  readonly assetId: AssetId
  readonly name: string
  readonly transform: LayerTransform
}

export type EditorDocument = {
  readonly canvasSize: CanvasSize
  readonly backgroundAssetId: AssetId | null
  readonly layers: readonly ImageLayer[]
}

const FiniteNumberSchema = z.number().finite()

export const CanvasSizeSchema = z.object({
  width: FiniteNumberSchema.int().positive(),
  height: FiniteNumberSchema.int().positive(),
})

export const LayerTransformSchema = z.object({
  x: FiniteNumberSchema,
  y: FiniteNumberSchema,
  scaleX: FiniteNumberSchema.positive(),
  scaleY: FiniteNumberSchema.positive(),
  angle: FiniteNumberSchema,
  flipX: z.boolean(),
  flipY: z.boolean(),
  opacity: FiniteNumberSchema.min(0).max(1),
})

export const ImageLayerSchema = z.object({
  id: LayerIdSchema,
  assetId: AssetIdSchema,
  name: z.string().trim().min(1),
  transform: LayerTransformSchema,
})

export const EditorDocumentSchema = z.object({
  canvasSize: CanvasSizeSchema,
  backgroundAssetId: AssetIdSchema.nullable(),
  layers: z.array(ImageLayerSchema),
})

export const DEFAULT_LAYER_TRANSFORM = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  flipX: false,
  flipY: false,
  opacity: 1,
} as const satisfies LayerTransform

export const INITIAL_EDITOR_DOCUMENT = {
  canvasSize: { width: 1200, height: 800 },
  backgroundAssetId: null,
  layers: [],
} as const satisfies EditorDocument

export function createAssetId(value: string): AssetId {
  return AssetIdSchema.parse(value)
}

export function createLayerId(value: string): LayerId {
  return LayerIdSchema.parse(value)
}
