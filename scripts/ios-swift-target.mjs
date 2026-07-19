import { posix } from "node:path"

const IOS_VERSION_PATTERN = /^\d+(?:\.\d+){1,2}$/

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

export function getIosSwiftProductsPath(buildPath, swiftTarget, configuration) {
  const productConfiguration = configuration === "release" ? "Release" : "Debug"
  const sdk = swiftTarget.endsWith("-simulator") ? "iphonesimulator" : "iphoneos"
  return posix.join(buildPath, "out", "Products", `${productConfiguration}-${sdk}`)
}

if (process.argv[1]?.endsWith("ios-swift-target.mjs")) {
  const [, , rustTarget, minimumVersion = "15.0"] = process.argv
  process.stdout.write(`${getIosSwiftTarget(rustTarget, minimumVersion)}\n`)
}
