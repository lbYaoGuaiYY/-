export type ImageExportDelivery = "shared" | "downloaded"

/**
 * This function is deliberately called from a second, direct touch action.
 * iPadOS otherwise rejects download clicks that happen after async canvas
 * rendering has completed.
 */
export async function shareOrDownloadImage(
  blob: Blob,
  filename: string,
): Promise<ImageExportDelivery> {
  const file = new File([blob], filename, { type: blob.type || "image/png" })
  const canShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    (typeof navigator.canShare !== "function" || navigator.canShare({ files: [file] }))
  if (canShare) {
    try {
      await navigator.share({ files: [file], title: filename })
      return "shared"
    } catch {
      // Cancellation and unavailable destinations fall through to a download.
    }
  }
  downloadImageBlob(blob, filename)
  return "downloaded"
}

export function downloadImageBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
