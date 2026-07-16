import { afterEach, describe, expect, it, vi } from "vitest"

import { shareOrDownloadImage } from "../src/features/editor/image-export"

afterEach(() => vi.unstubAllGlobals())

describe("iPad image export delivery", () => {
  it("uses the native share sheet when the generated image is ready", async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", {
      canShare: vi.fn(() => true),
      share,
    })

    const delivery = await shareOrDownloadImage(
      new Blob(["image"], { type: "image/png" }),
      "轻设设计.png",
    )

    expect(delivery).toBe("shared")
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ title: "轻设设计.png", files: expect.any(Array) }),
    )
  })
})
