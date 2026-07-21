import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

export const RELEASE_MANIFEST_PATH = "config/release-manifest.json"
export const RELEASE_PRODUCT_NAME = "轻设"

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export async function readReleaseManifest(root = process.cwd()) {
  const manifest = JSON.parse(await readFile(resolve(root, RELEASE_MANIFEST_PATH), "utf8"))
  validateReleaseManifest(manifest)
  return manifest
}

export function validateReleaseManifest(manifest) {
  if (manifest === null || typeof manifest !== "object") {
    throw new Error("Release manifest must be a JSON object")
  }
  if (manifest.schemaVersion !== 1) {
    throw new Error("Unsupported release manifest schema version")
  }
  if (typeof manifest.version !== "string" || !SEMVER_PATTERN.test(manifest.version)) {
    throw new Error("Release manifest version must be a semantic version")
  }
  if (manifest.productName !== RELEASE_PRODUCT_NAME) {
    throw new Error(`Release manifest productName must be ${RELEASE_PRODUCT_NAME}`)
  }
  if (
    manifest.source === null ||
    typeof manifest.source !== "object" ||
    typeof manifest.source.entry !== "string" ||
    !Array.isArray(manifest.source.runtimes) ||
    manifest.source.runtimes.length === 0
  ) {
    throw new Error("Release manifest source entry and runtimes are required")
  }
  if (manifest.source.revisionEnv !== "QINGSHE_BUILD_REVISION") {
    throw new Error("Release manifest must use QINGSHE_BUILD_REVISION for provenance")
  }
  for (const platform of ["windows", "macos", "linux", "ios"]) {
    const template = manifest.artifacts?.[platform]
    if (
      typeof template !== "string" ||
      !template.includes("{version}") ||
      !template.includes("{arch}")
    ) {
      throw new Error(`Release manifest artifact template is invalid: ${platform}`)
    }
  }
  for (const kind of ["chrome", "firefox"]) {
    const template = manifest.browserExtension?.[kind]
    if (typeof template !== "string" || !template.includes("{version}")) {
      throw new Error(`Release manifest browser extension template is invalid: ${kind}`)
    }
  }
  return manifest
}

export function validateReleaseTag(tag, version) {
  const normalizedTag = typeof tag === "string" ? tag.replace(/^refs\/tags\//, "") : ""
  if (!normalizedTag.startsWith("v") || normalizedTag.slice(1) !== version) {
    throw new Error(`Release tag must be v${version}; received ${normalizedTag || "<missing>"}`)
  }
  return normalizedTag
}

export function formatReleaseArtifact(template, values) {
  return template
    .replaceAll("{version}", values.version)
    .replaceAll("{arch}", values.arch ?? "unknown")
    .replaceAll("{revision}", values.revision ?? "source")
}

export function readBuildRevision({ env = process.env, root = process.cwd() } = {}) {
  const supplied = env.QINGSHE_BUILD_REVISION ?? env.GITHUB_SHA
  if (typeof supplied === "string" && supplied.trim()) return supplied.trim().slice(0, 40)
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return "source"
  }
}

export function cargoPackageVersion(cargoToml) {
  const match = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)
  if (!match) throw new Error("Cargo.toml package version is missing")
  return match[1]
}

if (process.argv[1]?.endsWith("release-manifest.mjs") && process.argv.includes("--check-tag")) {
  const manifest = await readReleaseManifest()
  const tag = process.env.GITHUB_REF_NAME ?? process.env.GITHUB_REF
  validateReleaseTag(tag, manifest.version)
  console.log(`Release tag ${tag.replace(/^refs\/tags\//, "")} matches ${manifest.version}`)
}
