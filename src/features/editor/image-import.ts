import { z } from "zod"

const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const
const ImageMimeSchema = z.enum(SUPPORTED_IMAGE_TYPES)
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_IMAGE_PIXELS = 32_000_000
const MAX_IMAGE_SIDE = 10_000

export type Size = {
  readonly width: number
  readonly height: number
}

export type ImageDecoder = (file: File) => Promise<Size>

export type ImageFileResult =
  | { readonly kind: "valid"; readonly file: File; readonly size: Size }
  | { readonly kind: "empty"; readonly fileName: string }
  | { readonly kind: "unsupported_type"; readonly fileName: string }
  | { readonly kind: "file_too_large"; readonly fileName: string }
  | { readonly kind: "decode_failed"; readonly fileName: string }
  | { readonly kind: "dimensions_too_large"; readonly fileName: string }

export type FittedSize = Size & {
  readonly scale: number
}

class UnexpectedImageResultError extends Error {
  readonly name = "UnexpectedImageResultError"
}

export async function validateImageFile(
  file: File,
  decode: ImageDecoder = decodeImageFile,
): Promise<ImageFileResult> {
  if (!ImageMimeSchema.safeParse(file.type).success) {
    return { kind: "unsupported_type", fileName: file.name }
  }
  if (file.size === 0) return { kind: "empty", fileName: file.name }
  if (file.size > MAX_IMAGE_BYTES) return { kind: "file_too_large", fileName: file.name }

  let size: Size
  try {
    size = await decode(file)
  } catch {
    return { kind: "decode_failed", fileName: file.name }
  }
  if (!isValidSize(size)) return { kind: "decode_failed", fileName: file.name }
  if (
    size.width > MAX_IMAGE_SIDE ||
    size.height > MAX_IMAGE_SIDE ||
    size.width * size.height > MAX_IMAGE_PIXELS
  ) {
    return { kind: "dimensions_too_large", fileName: file.name }
  }
  return { kind: "valid", file, size }
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
    case "file_too_large":
      return "图片不能超过 25 MiB"
    case "decode_failed":
      return "图片已损坏或无法读取"
    case "dimensions_too_large":
      return "图片尺寸过大，请使用 3200 万像素以内且单边不超过 10000 像素的图片"
    default:
      throw new UnexpectedImageResultError(`Unexpected image result: ${String(kind)}`)
  }
}

async function decodeImageFile(file: File): Promise<Size> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file)
    try {
      return { width: bitmap.width, height: bitmap.height }
    } finally {
      bitmap.close()
    }
  }
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.src = url
  try {
    await image.decode()
    return { width: image.naturalWidth, height: image.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function isValidSize(size: Size): boolean {
  return (
    Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
  )
}
