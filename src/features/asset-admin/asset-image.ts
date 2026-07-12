export async function readImageSize(blob: Blob): Promise<{
  readonly width: number
  readonly height: number
}> {
  const image = await createImageBitmap(blob)
  try {
    return { width: image.width, height: image.height }
  } finally {
    image.close()
  }
}
