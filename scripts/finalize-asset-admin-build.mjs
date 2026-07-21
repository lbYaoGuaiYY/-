import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import {
  formatReleaseArtifact,
  readBuildRevision,
  readReleaseManifest,
} from "./release-manifest.mjs"

const root = resolve(".")
const outputDirectory = resolve(root, "dist-asset-admin")
const releaseManifest = await readReleaseManifest(root)
const revision = readBuildRevision({ root })
const extensionManifest = JSON.parse(
  await readFile(resolve(root, releaseManifest.browserExtension.manifest), "utf8"),
)
const extensionVersion = extensionManifest.version

const chromeArchive = formatReleaseArtifact(releaseManifest.browserExtension.chrome, {
  version: extensionVersion,
  revision,
})
const firefoxArchive = formatReleaseArtifact(releaseManifest.browserExtension.firefox, {
  version: extensionVersion,
  revision,
})

await Promise.all([
  requireFile(resolve(outputDirectory, "asset-admin.html")),
  requireFile(resolve(root, "browser-extension", chromeArchive)),
  requireFile(resolve(root, "browser-extension", firefoxArchive)),
])

await copyFile(resolve(outputDirectory, "asset-admin.html"), resolve(outputDirectory, "index.html"))
await mkdir(resolve(outputDirectory, "downloads"), { recursive: true })

await copyFile(
  resolve(root, "browser-extension", chromeArchive),
  resolve(outputDirectory, "downloads", chromeArchive),
)
await copyFile(
  resolve(root, "browser-extension", firefoxArchive),
  resolve(outputDirectory, "downloads", firefoxArchive),
)

await writeFile(
  resolve(outputDirectory, "build-info.json"),
  `${JSON.stringify(
    {
      product: releaseManifest.productName,
      surface: "asset-admin",
      version: releaseManifest.version,
      revision,
      extensionVersion,
      browserExtensionArchives: [chromeArchive, firefoxArchive],
    },
    null,
    2,
  )}\n`,
)

const macDmg = resolve(
  root,
  "dist-app",
  formatReleaseArtifact(releaseManifest.artifacts.macos, {
    version: releaseManifest.version,
    arch: releaseManifest.downloadArchitectures.macos,
    revision,
  }),
)
try {
  await access(macDmg)
  await copyFile(macDmg, resolve(outputDirectory, "downloads", macDmg.split(/[\\/]/).pop()))
} catch {
  // The public page keeps the macOS card available only when a local bundle exists.
}

async function requireFile(path) {
  await access(path)
}

const processorDmg = resolve(root, "dist-processing-agent/qingshe-processor-macos-aarch64.dmg")
try {
  await access(processorDmg)
  await copyFile(
    processorDmg,
    resolve(outputDirectory, "downloads/qingshe-processor-macos-aarch64.dmg"),
  )
} catch {
  // The processor download route returns 404 until a platform package is built.
}

const processorWindows = resolve(root, "dist-processing-agent/qingshe-processor-windows-x64.exe")
try {
  await access(processorWindows)
  await copyFile(
    processorWindows,
    resolve(outputDirectory, "downloads/qingshe-processor-windows-x64.exe"),
  )
} catch {
  // Windows packages are produced on Windows and copied when available.
}
