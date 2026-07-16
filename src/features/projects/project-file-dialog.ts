import { open, save } from "@tauri-apps/plugin-dialog"
import { readFile, writeFile } from "@tauri-apps/plugin-fs"

import { isDesktopRuntime } from "../../platform/runtime"
import { projectPackageFilename } from "./project-package"

const PROJECT_PACKAGE_FILTER = [{ name: "轻设可编辑项目", extensions: ["qingshe"] }]
export const IMAGE_FILE_FILTER = {
  name: "图片",
  extensions: ["jpg", "jpeg", "png", "webp"],
}

export type SaveProjectPackageResult = "saved" | "cancelled"

export async function openProjectPackageFile(): Promise<File | null> {
  if (!isDesktopRuntime()) return null
  const selectedPath = await open({
    multiple: false,
    directory: false,
    filters: PROJECT_PACKAGE_FILTER,
  })
  if (typeof selectedPath !== "string") return null
  const bytes = await readFile(selectedPath)
  return new File([bytes], filenameFromPath(selectedPath), { type: "application/zip" })
}

export async function openBackgroundImageFile(): Promise<File | null> {
  if (!isDesktopRuntime()) return null
  const selectedPath = await open({
    multiple: false,
    directory: false,
    filters: [IMAGE_FILE_FILTER],
  })
  if (typeof selectedPath !== "string") return null
  const bytes = await readFile(selectedPath)
  return new File([bytes], filenameFromPath(selectedPath), { type: mimeTypeForPath(selectedPath) })
}

export async function saveProjectPackageFile(
  packageBlob: Blob,
  projectName: string,
): Promise<SaveProjectPackageResult> {
  if (!isDesktopRuntime()) return "cancelled"
  const selectedPath = await save({
    defaultPath: projectPackageFilename(projectName),
    filters: PROJECT_PACKAGE_FILTER,
  })
  if (selectedPath === null) return "cancelled"
  await writeFile(selectedPath, new Uint8Array(await packageBlob.arrayBuffer()))
  return "saved"
}

function filenameFromPath(path: string): string {
  const segments = path.split(/[\\/]/)
  return segments.at(-1) ?? "轻设项目.qingshe"
}

function mimeTypeForPath(path: string): "image/jpeg" | "image/png" | "image/webp" {
  const extension = filenameFromPath(path).split(".").at(-1)?.toLocaleLowerCase("en-US")
  if (extension === "png") return "image/png"
  if (extension === "webp") return "image/webp"
  return "image/jpeg"
}
