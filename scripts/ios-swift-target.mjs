import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from "node:fs"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"

const IOS_VERSION_PATTERN = /^\d+(?:\.\d+){1,2}$/

function isOutside(root, target) {
  const nested = relative(root, target)
  return nested === ".." || nested.startsWith(`..${sep}`) || isAbsolute(nested)
}

export function getIosSwiftTarget(rustTarget, minimumVersion) {
  const version = minimumVersion.trim()
  if (!IOS_VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid iOS minimum version: ${minimumVersion}`)
  }

  const target = {
    "aarch64-apple-ios": `arm64-apple-ios${version}`,
    "aarch64-apple-ios-sim": `arm64-apple-ios${version}-simulator`,
    "x86_64-apple-ios": `x86_64-apple-ios${version}-simulator`,
  }[rustTarget]

  if (!target) {
    throw new Error(`Unsupported iOS Rust target: ${rustTarget}`)
  }

  return target
}

export function getIosSwiftLinkSearchPath(swiftTarget, configuration) {
  const architecture = swiftTarget.startsWith("x86_64-") ? "x86_64" : "arm64"
  return `${architecture}-apple-macosx/${configuration}`
}

export function parseIosSwiftProductsPath(output) {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
  const productsPath = lines.at(-1)
  if (productsPath === undefined) throw new Error("SwiftPM did not report a products directory")
  if (!isAbsolute(productsPath)) {
    throw new Error(`SwiftPM reported a non-absolute products directory: ${productsPath}`)
  }
  return productsPath
}

export function prepareIosSwiftProductsLink(
  productsPath,
  linkPath,
  { allowedRoot, expectedArchive, stamp = `${Date.now()}-${process.pid}` },
) {
  const productsDirectory = realpathSync(resolve(productsPath))
  const allowedDirectory = realpathSync(resolve(allowedRoot))
  const linkDirectory = resolve(linkPath)
  if (isOutside(allowedDirectory, productsDirectory)) {
    throw new Error(`SwiftPM products directory is outside its build root: ${productsDirectory}`)
  }
  if (isOutside(allowedDirectory, linkDirectory)) {
    throw new Error(`SwiftPM link path is outside its build root: ${linkDirectory}`)
  }
  const linkParent = dirname(linkDirectory)
  mkdirSync(linkParent, { recursive: true })
  if (isOutside(allowedDirectory, realpathSync(linkParent))) {
    throw new Error(`SwiftPM link parent escapes its build root: ${linkParent}`)
  }
  let entries
  try {
    entries = readdirSync(productsDirectory, { withFileTypes: true })
  } catch (error) {
    throw new Error(`SwiftPM products directory is unavailable: ${productsDirectory}`, {
      cause: error,
    })
  }
  const archives = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".a"))
    .map((entry) => entry.name)
    .sort()
  if (archives.length === 0) {
    throw new Error(`SwiftPM products directory contains no static library: ${productsDirectory}`)
  }
  if (!archives.includes(expectedArchive)) {
    throw new Error(
      `SwiftPM products directory does not contain ${expectedArchive}: ${productsDirectory}`,
    )
  }

  let existingLinkResolvesToProducts = false
  try {
    existingLinkResolvesToProducts =
      lstatSync(linkDirectory).isSymbolicLink() && realpathSync(linkDirectory) === productsDirectory
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
  }
  if (productsDirectory === linkDirectory || existingLinkResolvesToProducts) {
    return {
      archives,
      linked: false,
      linkPath: linkDirectory,
      preservedPath: null,
      previousSymlinkTarget: null,
      productsPath: productsDirectory,
    }
  }

  let preservedPath = null
  let previousSymlinkTarget = null
  try {
    const existing = lstatSync(linkDirectory)
    if (existing.isSymbolicLink()) {
      previousSymlinkTarget = readlinkSync(linkDirectory)
      unlinkSync(linkDirectory)
    } else if (existing.isDirectory()) {
      preservedPath = `${linkDirectory}.qingshe-preserved-${stamp}`
      if (existsSync(preservedPath)) {
        throw new Error(`Preserved SwiftPM output already exists: ${preservedPath}`)
      }
      renameSync(linkDirectory, preservedPath)
    } else {
      throw new Error(`Refusing to replace non-directory SwiftPM link path: ${linkDirectory}`)
    }
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
  }

  try {
    symlinkSync(relative(dirname(linkDirectory), productsDirectory), linkDirectory, "dir")
  } catch (error) {
    if (!existsSync(linkDirectory)) {
      if (preservedPath !== null) renameSync(preservedPath, linkDirectory)
      else if (previousSymlinkTarget !== null) {
        symlinkSync(previousSymlinkTarget, linkDirectory, "dir")
      }
    }
    throw error
  }

  return {
    archives,
    linked: true,
    linkPath: linkDirectory,
    preservedPath,
    previousSymlinkTarget,
    productsPath: productsDirectory,
  }
}

export function rollbackIosSwiftProductsLink(state) {
  if (!state.linked) return false

  let existing = null
  try {
    existing = lstatSync(state.linkPath)
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
  }
  if (existing !== null) {
    if (!existing.isSymbolicLink()) {
      throw new Error(`Refusing to replace a changed SwiftPM link path: ${state.linkPath}`)
    }
    const currentTarget = resolve(dirname(state.linkPath), readlinkSync(state.linkPath))
    if (currentTarget !== state.productsPath) {
      throw new Error(`Refusing to replace a changed SwiftPM link target: ${state.linkPath}`)
    }
    unlinkSync(state.linkPath)
  }

  if (state.preservedPath !== null) renameSync(state.preservedPath, state.linkPath)
  else if (state.previousSymlinkTarget !== null) {
    symlinkSync(state.previousSymlinkTarget, state.linkPath, "dir")
  }
  return true
}

if (process.argv[1]?.endsWith("ios-swift-target.mjs")) {
  const [, , rustTarget, minimumVersion = "15.0"] = process.argv
  process.stdout.write(`${getIosSwiftTarget(rustTarget, minimumVersion)}\n`)
}
