import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { arch, platform } from "node:os"
import { resolve } from "node:path"

import {
  formatReleaseArtifact,
  readBuildRevision,
  readReleaseManifest,
} from "./release-manifest.mjs"

const root = resolve(".")
const output = resolve(root, "dist-app")
const bundleRoot = resolve(root, "src-tauri/target/release/bundle")
const releaseManifest = await readReleaseManifest(root)
const distributionArch =
  process.env.QINGSHE_ARTIFACT_ARCH ?? (arch() === "arm64" ? "aarch64" : "x64")
const revision = readBuildRevision({ root })
const appVersion = releaseManifest.version
const macSigning =
  platform() === "darwin"
    ? getMacSigningStatus(process.env)
    : { status: "unsigned", publishable: false }

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

if (platform() === "darwin") {
  // A CI build without Apple's credentials is useful for validation only. Keep
  // it in a visibly unsigned directory so it cannot be mistaken for a release
  // download. Tauri performs the actual Developer ID signing/notarization when
  // the standard APPLE_* environment is configured; this script never applies
  // an ad-hoc signature itself.
  const artifactDirectory = macSigning.publishable ? output : resolve(output, "unsigned")
  await mkdir(artifactDirectory, { recursive: true })
  const outputApp = resolve(artifactDirectory, `${releaseManifest.productName}.app`)
  await cp(resolve(bundleRoot, `macos/${releaseManifest.productName}.app`), outputApp, {
    recursive: true,
  })
  const dmg = await findArtifact(resolve(bundleRoot, "dmg"), ".dmg")
  await cp(
    dmg,
    resolve(
      artifactDirectory,
      formatReleaseArtifact(releaseManifest.artifacts.macos, {
        version: appVersion,
        arch: distributionArch,
        revision,
      }),
    ),
  )
} else if (platform() === "win32") {
  const installer = await findArtifact(resolve(bundleRoot, "nsis"), ".exe")
  await cp(
    installer,
    resolve(
      output,
      formatReleaseArtifact(releaseManifest.artifacts.windows, {
        version: appVersion,
        arch: distributionArch,
        revision,
      }),
    ),
  )
} else {
  const appImage = await findArtifact(resolve(bundleRoot, "appimage"), ".AppImage")
  await cp(
    appImage,
    resolve(
      output,
      formatReleaseArtifact(releaseManifest.artifacts.linux, {
        version: appVersion,
        arch: distributionArch,
        revision,
      }),
    ),
  )
}

const buildInfoDirectory =
  platform() === "darwin" && !macSigning.publishable ? resolve(output, "unsigned") : output
await writeFile(
  resolve(buildInfoDirectory, "build-info.json"),
  `${JSON.stringify(
    {
      product: releaseManifest.productName,
      version: appVersion,
      revision,
      source: releaseManifest.source.entry,
      artifactClass: platform() === "darwin" && !macSigning.publishable ? "unsigned" : "ci",
      signing: platform() === "darwin" ? macSigning.status : "unsigned",
      publishable: platform() === "darwin" && macSigning.publishable,
    },
    null,
    2,
  )}\n`,
)

console.log(`Built isolated ${releaseManifest.productName} App deliverables: ${output}`)

function getMacSigningStatus(env) {
  const identity = env.APPLE_SIGNING_IDENTITY?.trim()
  if (identity === "-") {
    throw new Error(
      "Ad-hoc macOS signing is validation-only and is not accepted by the release pipeline",
    )
  }
  if (!identity) {
    return { status: "unsigned", publishable: false }
  }

  const appStoreCredentials =
    Boolean(env.APPLE_API_ISSUER?.trim()) &&
    Boolean(env.APPLE_API_KEY?.trim()) &&
    Boolean(env.APPLE_API_KEY_PATH?.trim())
  const appleIdCredentials =
    Boolean(env.APPLE_ID?.trim()) &&
    Boolean(env.APPLE_PASSWORD?.trim()) &&
    Boolean(env.APPLE_TEAM_ID?.trim())
  const notarizationConfigured = appStoreCredentials || appleIdCredentials
  if (!notarizationConfigured) {
    return { status: "signed-not-notarized", publishable: false }
  }
  return { status: "signed-and-notarized", publishable: true }
}

async function findArtifact(directory, extension) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      try {
        return await findArtifact(path, extension)
      } catch {
        // Keep searching sibling bundle directories.
      }
    } else if (entry.name.endsWith(extension)) {
      return path
    }
  }
  throw new Error(
    `Missing ${extension} ${releaseManifest.productName} App bundle under ${directory}`,
  )
}
