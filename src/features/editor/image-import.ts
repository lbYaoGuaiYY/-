import { z } from "zod"

const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const
const ImageMimeSchema = z.enum(SUPPORTED_IMAGE_TYPES)

export type ImageFileResult =
  | { readonly kind: "valid"; readonly file: File }
  | { readonly kind: "empty"; readonly fileName: string }
  | { readonly kind: "unsupported_type"; readonly fileName: string }

export type Size = {
  readonly width: number
  readonly height: number
}

export type FittedSize = Size & {
  readonly scale: number
}

class UnexpectedImageResultError extends Error {
  readonly name = "UnexpectedImageResultError"
}

export function validateImageFile(file: File): ImageFileResult {
  if (!ImageMimeSchema.safeParse(file.type).success) {
    return { kind: "unsupported_type", fileName: file.name }
  }

  if (file.size === 0) {
    return { kind: "empty", fileName: file.name }
  }

  return { kind: "valid", file }
}

export function fitInside(source: Size, target: Size): FittedSize {
  const scale = Math.min(target.width / source.width, target.height / source.height, 1)

  return {
    width: Math.round(source.width * scale),
    height: Math.round(source.height * scale),
    scale,
  }
}

export function imageResultMessage(kind: ImageFileResult["kind"]): string {
  switch (kind) {
    case "valid":
      return ""
    case "empty":
      return "图片文件为空"
    case "unsupported_type":
      return "仅支持 PNG、JPEG 和 WebP 图片"
    default:
      throw new UnexpectedImageResultError(`Unexpected image result: ${String(kind)}`)
  }
}
