import { afterEach, describe, expect, it, vi } from "vitest"

import {
  IMAGE_FILE_FILTER,
  openBackgroundImageFile,
  openProjectPackageFile,
} from "../src/features/projects/project-file-dialog"

const { openDialog } = vi.hoisted(() => ({ openDialog: vi.fn() }))

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openDialog,
  save: vi.fn(),
}))

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

afterEach(() => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  openDialog.mockReset()
})

describe("desktop image dialog", () => {
  it("offers JPEG, PNG and WebP image files", () => {
    expect(IMAGE_FILE_FILTER.extensions).toEqual(["jpg", "jpeg", "png", "webp"])
  })

  it("does not invoke the Tauri dialog when running outside the desktop runtime", async () => {
    expect(await openBackgroundImageFile()).toBeNull()
    expect(await openProjectPackageFile()).toBeNull()
    expect(openDialog).not.toHaveBeenCalled()
  })
})
