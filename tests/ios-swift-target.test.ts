import { execFileSync } from "node:child_process"
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { describe, expect, it } from "vitest"

import {
  getIosSwiftLinkSearchPath,
  getIosSwiftTarget,
  parseIosSwiftProductsPath,
  prepareIosSwiftProductsLink,
  rollbackIosSwiftProductsLink,
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

  it("uses the final non-empty line reported by SwiftPM", () => {
    expect(parseIosSwiftProductsPath("warning text\n/tmp/swift-products\n")).toBe(
      "/tmp/swift-products",
    )
  })

  it("keeps the reported swift-rs products directory in place", () => {
    const root = mkdtempSync(join(tmpdir(), "qingshe-swift-products-"))
    try {
      const products = join(root, "arm64-apple-macosx", "debug")
      mkdirSync(products, { recursive: true })
      writeFileSync(join(products, "libTauri.a"), "archive")
      expect(
        prepareIosSwiftProductsLink(products, products, {
          allowedRoot: root,
          expectedArchive: "libTauri.a",
          stamp: "same-layout",
        }),
      ).toEqual({
        archives: ["libTauri.a"],
        linked: false,
        linkPath: products,
        preservedPath: null,
        previousSymlinkTarget: null,
        productsPath: products,
      })
      expect(readFileSync(join(products, "libTauri.a"), "utf8")).toBe("archive")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === "win32")(
    "preserves a real legacy directory before linking the reported products",
    () => {
      const root = mkdtempSync(join(tmpdir(), "qingshe-swift-products-"))
      try {
        const products = join(root, "reported", "debug")
        const link = join(root, "arm64-apple-macosx", "debug")
        mkdirSync(products, { recursive: true })
        mkdirSync(link, { recursive: true })
        writeFileSync(join(products, "libTauri.a"), "current")
        writeFileSync(join(link, "legacy-marker.txt"), "preserved")

        const result = prepareIosSwiftProductsLink(products, link, {
          allowedRoot: root,
          expectedArchive: "libTauri.a",
          stamp: "test-layout",
        })
        expect(result.linked).toBe(true)
        expect(result.preservedPath).toBe(`${link}.qingshe-preserved-test-layout`)
        expect(lstatSync(link).isSymbolicLink()).toBe(true)
        expect(realpathSync(link)).toBe(realpathSync(products))
        expect(readFileSync(join(result.preservedPath ?? "", "legacy-marker.txt"), "utf8")).toBe(
          "preserved",
        )
        expect(rollbackIosSwiftProductsLink(result)).toBe(true)
        expect(lstatSync(link).isDirectory()).toBe(true)
        expect(readFileSync(join(link, "legacy-marker.txt"), "utf8")).toBe("preserved")
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )

  it.skipIf(process.platform === "win32")(
    "uses the real SwiftPM bin path with the same transformed build arguments",
    () => {
      const root = mkdtempSync(join(tmpdir(), "qingshe-swift-wrapper-"))
      try {
        const fakeSwift = join(root, "fake-swift")
        const logPath = join(root, "invocations.jsonl")
        const buildPath = join(root, "Tauri")
        writeFileSync(fakeSwift, fakeSwiftSource())
        chmodSync(fakeSwift, 0o755)

        execFileSync(
          process.execPath,
          [
            join(process.cwd(), "scripts", "swift"),
            "build",
            "-c",
            "debug",
            "--arch",
            "arm64",
            "--build-path",
            buildPath,
          ],
          {
            env: iosSwiftWrapperEnvironment(fakeSwift, logPath),
            stdio: "pipe",
          },
        )

        const invocations = readFileSync(logPath, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as string[])
        expect(invocations).toHaveLength(2)
        expect(invocations[0]).toContain("--triple")
        expect(invocations[0]).not.toContain("--arch")
        expect(invocations[1]).toContain("--show-bin-path")
        expect(invocations[1]?.filter((argument) => argument === "--build-path")).toHaveLength(1)

        const products = join(buildPath, "out", "reported", "debug")
        const link = join(buildPath, "arm64-apple-macosx", "debug")
        expect(realpathSync(link)).toBe(realpathSync(products))
        expect(readFileSync(join(products, "libTauri.a"))).toBeDefined()
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )

  it.skipIf(process.platform === "win32")(
    "restores a preserved SwiftPM directory when archive globalization fails",
    () => {
      const root = mkdtempSync(join(tmpdir(), "qingshe-swift-wrapper-"))
      try {
        const fakeSwift = join(root, "fake-swift")
        const logPath = join(root, "invocations.jsonl")
        const buildPath = join(root, "Tauri")
        const link = join(buildPath, "arm64-apple-macosx", "debug")
        mkdirSync(link, { recursive: true })
        writeFileSync(join(link, "legacy-marker.txt"), "preserved")
        writeFileSync(fakeSwift, fakeSwiftSource())
        chmodSync(fakeSwift, 0o755)

        expect(() =>
          execFileSync(
            process.execPath,
            [
              join(process.cwd(), "scripts", "swift"),
              "build",
              "-c",
              "debug",
              "--arch",
              "arm64",
              "--build-path",
              buildPath,
            ],
            {
              env: {
                ...iosSwiftWrapperEnvironment(fakeSwift, logPath),
                FAKE_SWIFT_INVALID_ARCHIVE: "1",
              },
              stdio: "pipe",
            },
          ),
        ).toThrow()
        expect(lstatSync(link).isDirectory()).toBe(true)
        expect(readFileSync(join(link, "legacy-marker.txt"), "utf8")).toBe("preserved")
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )

  it("rejects a reported directory that contains no static library", () => {
    const root = mkdtempSync(join(tmpdir(), "qingshe-swift-products-"))
    try {
      expect(() =>
        prepareIosSwiftProductsLink(root, join(root, "link"), {
          allowedRoot: root,
          expectedArchive: "libTauri.a",
          stamp: "empty",
        }),
      ).toThrow("contains no static library")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("rejects a reported products directory outside the SwiftPM build root", () => {
    const root = mkdtempSync(join(tmpdir(), "qingshe-swift-products-"))
    const outside = mkdtempSync(join(tmpdir(), "qingshe-swift-outside-"))
    try {
      writeFileSync(join(outside, "libTauri.a"), "archive")
      expect(() =>
        prepareIosSwiftProductsLink(outside, join(root, "link"), {
          allowedRoot: root,
          expectedArchive: "libTauri.a",
        }),
      ).toThrow("outside its build root")
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("rejects a compatibility link path outside the SwiftPM build root", () => {
    const root = mkdtempSync(join(tmpdir(), "qingshe-swift-products-"))
    const outside = mkdtempSync(join(tmpdir(), "qingshe-swift-link-outside-"))
    try {
      const products = join(root, "products")
      mkdirSync(products)
      writeFileSync(join(products, "libTauri.a"), "archive")
      expect(() =>
        prepareIosSwiftProductsLink(products, join(outside, "link"), {
          allowedRoot: root,
          expectedArchive: "libTauri.a",
        }),
      ).toThrow("link path is outside its build root")
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === "win32")(
    "keeps an existing correct compatibility symlink without replacing it",
    () => {
      const root = mkdtempSync(join(tmpdir(), "qingshe-swift-products-"))
      try {
        const products = join(root, "reported", "debug")
        const link = join(root, "arm64-apple-macosx", "debug")
        mkdirSync(products, { recursive: true })
        mkdirSync(join(root, "arm64-apple-macosx"), { recursive: true })
        writeFileSync(join(products, "libTauri.a"), "current")
        symlinkSync(relative(dirname(link), products), link, "dir")
        const beforeTarget = readlinkSync(link)

        const result = prepareIosSwiftProductsLink(products, link, {
          allowedRoot: root,
          expectedArchive: "libTauri.a",
        })
        expect(result.linked).toBe(false)
        expect(readlinkSync(link)).toBe(beforeTarget)
        expect(realpathSync(link)).toBe(realpathSync(products))
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
})

function iosSwiftWrapperEnvironment(fakeSwift: string, logPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CARGO_CFG_TARGET_OS: "ios",
    FAKE_SWIFT_LOG: logPath,
    QINGSHE_IOS_MIN_VERSION: "15.0",
    QINGSHE_REAL_SWIFT: fakeSwift,
    TARGET: "aarch64-apple-ios-sim",
  }
}

function fakeSwiftSource(): string {
  return String.raw`#!/usr/bin/env node
const { appendFileSync, mkdirSync, writeFileSync } = require("node:fs")
const { execFileSync } = require("node:child_process")
const { basename, join } = require("node:path")

const args = process.argv.slice(2)
appendFileSync(process.env.FAKE_SWIFT_LOG, JSON.stringify(args) + "\n")
const buildPathIndex = args.indexOf("--build-path")
if (buildPathIndex === -1) throw new Error("missing --build-path")
const buildPath = args[buildPathIndex + 1]
const productsPath = join(buildPath, "out", "reported", "debug")
if (args.includes("--show-bin-path")) {
  process.stdout.write(productsPath + "\n")
  process.exit(0)
}
mkdirSync(productsPath, { recursive: true })
const archivePath = join(productsPath, "lib" + basename(buildPath) + ".a")
if (process.env.FAKE_SWIFT_INVALID_ARCHIVE === "1") writeFileSync(archivePath, "invalid")
else execFileSync("ar", ["rc", archivePath])
`
}
