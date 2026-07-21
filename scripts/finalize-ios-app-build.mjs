import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { basename, resolve } from "node:path"

import {
  formatReleaseArtifact,
  readBuildRevision,
  readReleaseManifest,
} from "./release-manifest.mjs"

const root = resolve(".")
const buildRoot = resolve(root, "src-tauri/gen/apple/build")
const output = resolve(root, "dist-app/unsigned")
const releaseManifest = await readReleaseManifest(root)
const revision = readBuildRevision({ root })
const artifactArch = process.env.QINGSHE_ARTIFACT_ARCH?.trim() || "aarch64-sim"
const artifactName = formatReleaseArtifact(releaseManifest.artifacts.ios, {
  version: releaseManifest.version,
  arch: artifactArch,
  revision,
})

await rm(resolve(root, "dist-app"), { recursive: true, force: true })
await mkdir(output, { recursive: true })
const sourceApp = await findProductApp(buildRoot, releaseManifest.productName)
await cp(sourceApp, resolve(output, artifactName), { recursive: true })
await writeFile(
  resolve(output, "build-info.json"),
  `${JSON.stringify(
    {
      product: releaseManifest.productName,
      platform: "ipados",
      version: releaseManifest.version,
      revision,
      source: releaseManifest.source.entry,
      artifact: artifactName,
      artifactClass: "unsigned-simulator",
      signing: "unsigned",
      publishable: false,
    },
    null,
    2,
  )}\n`,
)

console.log(`Built versioned iPadOS simulator deliverable: ${resolve(output, artifactName)}`)

async function findProductApp(directory, productName) {
  const candidates = []
  await collectAppBundles(directory, candidates)
  const preferredNames = [`${productName}_iOS.app`, `${productName}.app`]
  for (const preferred of preferredNames) {
    const match = candidates.find((candidate) => basename(candidate) === preferred)
    if (match !== undefined) return match
  }
  throw new Error(
    `Expected ${preferredNames.join(" or ")} under ${directory}; found ${candidates.map((candidate) => basename(candidate)).join(", ") || "none"}`,
  )
}

async function collectAppBundles(directory, candidates) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = resolve(directory, entry.name)
    if (entry.name.endsWith(".app")) {
      candidates.push(path)
      continue
    }
    await collectAppBundles(path, candidates)
  }
}
