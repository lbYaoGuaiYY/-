import { describe, expect, it } from "vitest"

import {
  getIosSwiftLinkSearchPath,
  getIosSwiftProductsPath,
  getIosSwiftTarget,
} from "../scripts/ios-swift-target.mjs"

describe("iOS SwiftPM target mapping", () => {
  it("maps the Apple Silicon simulator Rust target to an iOS simulator triple", () => {
    expect(getIosSwiftTarget("aarch64-apple-ios-sim", "15.0")).toBe("arm64-apple-ios15.0-simulator")
  })

  it("maps the device Rust target to an iOS device triple", () => {
    expect(getIosSwiftTarget("aarch64-apple-ios", "15.0")).toBe("arm64-apple-ios15.0")
  })

  it("rejects unknown Apple targets instead of silently building for macOS", () => {
    expect(() => getIosSwiftTarget("aarch64-apple-darwin", "15.0")).toThrow(
      "Unsupported iOS Rust target",
    )
  })

  it("keeps swift-rs link lookup compatible with SwiftPM iOS output", () => {
    expect(getIosSwiftLinkSearchPath("arm64-apple-ios15.0-simulator", "debug")).toBe(
      "arm64-apple-macosx/debug",
    )
  })

  it("resolves the Xcode 27 SwiftPM products directory", () => {
    expect(
      getIosSwiftProductsPath("/tmp/swift-package", "arm64-apple-ios15.0-simulator", "debug"),
    ).toBe("/tmp/swift-package/out/Products/Debug-iphonesimulator")
  })
})
