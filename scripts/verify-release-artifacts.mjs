import { access, readdir, readFile } from "node:fs/promises"
import { basename, resolve } from "node:path"

import { readReleaseManifest } from "./release-manifest.mjs"

const root = resolve(process.cwd())

export async function assertFiles(rootDirectory, paths) {
  await Promise.all(
    paths.map(async (path) => {
      try {
        await access(resolve(rootDirectory, path))
      } catch {
        throw new Error(`Required release artifact is missing: ${path}`)
      }
    }),
  )
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(path)))
    else files.push(path)
  }
  return files
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function matchesArtifactTemplate(path, template, version) {
  const expected = template.replaceAll("{version}", version)
  const [prefix, suffix = ""] = expected.split("{arch}")
  const name = basename(path)
  return (
    name.startsWith(prefix) && name.endsWith(suffix) && name.length > prefix.length + suffix.length
  )
}

function containsAppBundle(files, predicate = () => true) {
  return files.some((path) => {
    const normalized = path.replaceAll("\\", "/")
    return predicate(normalized) && normalized.toLowerCase().includes(".app/")
  })
}

function containsArtifactBundle(files, template, version) {
  const expected = template.replaceAll("{version}", version)
  const [prefix, suffix = ""] = expected.split("{arch}")
  return files.some((path) => {
    const normalized = path.replaceAll("\\", "/")
    const segments = normalized.split("/")
    return segments.some(
      (segment, index) =>
        segment.startsWith(prefix) &&
        segment.endsWith(suffix) &&
        segment.length > prefix.length + suffix.length &&
        segments.slice(index + 1).includes("Info.plist"),
    )
  })
}

export async function verifyReleaseArtifacts({ artifactRoot = root, kind }) {
  const manifest = await readReleaseManifest(root)
  if (kind === "aggregate") {
    const files = (await listFiles(artifactRoot)).map((path) => path.replaceAll("\\", "/"))
    const requiredNames = ["index.html", "asset-admin.html", "product.html", "processor.html"]
    const missing = requiredNames.filter((name) => !files.some((path) => path.endsWith(`/${name}`)))
    if (!files.some((path) => path.endsWith("build-info.json"))) {
      missing.push("build-info.json")
    }
    if (
      !files.some((path) =>
        matchesArtifactTemplate(path, manifest.artifacts.macos, manifest.version),
      )
    ) {
      missing.push("macOS .dmg")
    }
    if (
      !files.some((path) =>
        matchesArtifactTemplate(path, manifest.artifacts.windows, manifest.version),
      )
    ) {
      missing.push("Windows .exe")
    }
    if (
      !containsArtifactBundle(
        files.filter((path) => path.toLowerCase().includes("ios-simulator")),
        manifest.artifacts.ios,
        manifest.version,
      )
    ) {
      missing.push("iOS simulator .app")
    }
    if (missing.length > 0) {
      throw new Error(`Aggregate release artifact is missing: ${missing.join(", ")}`)
    }
    return
  }
  const expected = {
    quality: [
      "dist/index.html",
      "dist-asset-admin/asset-admin.html",
      "dist-asset-admin/index.html",
      "dist-asset-admin/manual.html",
      "dist-asset-admin/product.html",
      "dist-asset-admin/build-info.json",
      "dist-asset-admin/downloads",
      "dist-processor/processor.html",
      "browser-extension/dist/chrome/manifest.json",
      "browser-extension/dist/firefox/manifest.json",
    ],
    windows: ["dist-app/build-info.json"],
    macos: [],
    ios: ["dist-app/unsigned/build-info.json"],
  }[kind]

  if (!expected) throw new Error(`Unknown release artifact kind: ${kind || "<missing>"}`)

  if (kind === "macos") {
    const files = await listFiles(artifactRoot)
    const buildInfoCandidates = [
      resolve(artifactRoot, "dist-app/build-info.json"),
      resolve(artifactRoot, "dist-app/unsigned/build-info.json"),
    ]
    const buildInfoPaths = (
      await Promise.all(
        buildInfoCandidates.map(async (path) => ((await pathExists(path)) ? path : null)),
      )
    ).filter(Boolean)
    if (buildInfoPaths.length !== 1) {
      throw new Error(
        "macOS artifact must include exactly one signed or explicitly unsigned build-info.json",
      )
    }
    const buildInfo = JSON.parse(await readFile(buildInfoPaths[0], "utf8"))
    const unsignedPath = buildInfoPaths[0].replaceAll("\\", "/").includes("/unsigned/")
    if (Boolean(buildInfo.publishable) === unsignedPath) {
      throw new Error("macOS build-info publishable status does not match its artifact directory")
    }
    if (
      !files.some((path) =>
        matchesArtifactTemplate(path, manifest.artifacts.macos, manifest.version),
      )
    ) {
      throw new Error(`Missing ${manifest.artifacts.macos} DMG under ${artifactRoot}`)
    }
    if (!containsAppBundle(files, (path) => path.includes(`${manifest.productName}.app/`))) {
      throw new Error(`Missing ${manifest.productName}.app bundle under ${artifactRoot}`)
    }
    return
  }

  if (kind === "ios") {
    await assertFiles(artifactRoot, expected)
    const files = await listFiles(resolve(artifactRoot, "dist-app/unsigned"))
    if (
      !containsAppBundle(files) ||
      !containsArtifactBundle(files, manifest.artifacts.ios, manifest.version)
    ) {
      throw new Error(`Missing ${manifest.artifacts.ios} bundle under the iOS build directory`)
    }
    return
  }

  await assertFiles(artifactRoot, expected)

  if (kind === "windows") {
    const files = await listFiles(resolve(artifactRoot, "dist-app"))
    if (
      !files.some((path) =>
        matchesArtifactTemplate(path, manifest.artifacts.windows, manifest.version),
      )
    ) {
      throw new Error(`Missing ${manifest.artifacts.windows} installer under dist-app`)
    }
  }
}

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

if (process.argv[1]?.endsWith("verify-release-artifacts.mjs")) {
  await verifyReleaseArtifacts({
    artifactRoot: resolve(option("--root") ?? root),
    kind: option("--kind"),
  })
  console.log(`Release artifacts verified: ${option("--kind")}`)
}
