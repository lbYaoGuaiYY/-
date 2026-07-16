import { access, copyFile, mkdir } from "node:fs/promises"
import { resolve } from "node:path"

const outputDirectory = resolve("dist-asset-admin")

await copyFile(resolve(outputDirectory, "asset-admin.html"), resolve(outputDirectory, "index.html"))
await mkdir(resolve(outputDirectory, "downloads"), { recursive: true })
await copyFile(
  resolve("browser-extension/qingshe-image-archive-0.2.0-chrome.zip"),
  resolve(outputDirectory, "downloads/qingshe-image-archive-0.2.0-chrome.zip"),
)
await copyFile(
  resolve("browser-extension/qingshe-image-archive-0.2.0-firefox.xpi"),
  resolve(outputDirectory, "downloads/qingshe-image-archive-0.2.0-firefox.xpi"),
)

const macDmg = resolve("dist-app/qingshe-macos-0.1.0-aarch64.dmg")
try {
  await access(macDmg)
  await copyFile(macDmg, resolve(outputDirectory, "downloads/qingshe-macos-0.1.0-aarch64.dmg"))
} catch {
  // The public page keeps the macOS card available only when a local bundle exists.
}

const processorDmg = resolve("dist-processing-agent/qingshe-processor-macos-aarch64.dmg")
try {
  await access(processorDmg)
  await copyFile(
    processorDmg,
    resolve(outputDirectory, "downloads/qingshe-processor-macos-aarch64.dmg"),
  )
} catch {
  // The processor download route returns 404 until a platform package is built.
}

const processorWindows = resolve("dist-processing-agent/qingshe-processor-windows-x64.exe")
try {
  await access(processorWindows)
  await copyFile(
    processorWindows,
    resolve(outputDirectory, "downloads/qingshe-processor-windows-x64.exe"),
  )
} catch {
  // Windows packages are produced on Windows and copied when available.
}
