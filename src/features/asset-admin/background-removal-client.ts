import ky from "ky"

const BACKGROUND_REMOVAL_TIMEOUT_MS = 5 * 60 * 1000

export async function removeImageBackground(file: File): Promise<Blob> {
  const result = await ky
    .post("/api/rembg/remove-background", {
      body: file,
      headers: { "content-type": file.type },
      retry: 0,
      timeout: BACKGROUND_REMOVAL_TIMEOUT_MS,
    })
    .blob()
  if (result.type !== "image/png") throw new UnexpectedBackgroundRemovalResultError(result.type)
  return result
}

class UnexpectedBackgroundRemovalResultError extends Error {
  readonly name = "UnexpectedBackgroundRemovalResultError"

  constructor(readonly mimeType: string) {
    super(`Expected image/png, received ${mimeType || "unknown"}`)
  }
}
