import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { verifyReleaseArtifacts } from "../scripts/verify-release-artifacts.mjs"

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function temporaryRoot() {
  const directory = await mkdtemp(join(tmpdir(), "qingshe-release-artifacts-"))
  temporaryDirectories.push(directory)
  return directory
}

async function touch(path) {
  await mkdir(join(path, ".."), { recursive: true })
  await writeFile(path, "fixture")
}

async function writeJson(path, value) {
  await mkdir(join(path, ".."), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}

describe("release artifact verification", () => {
  it("requires the manifest version in the Windows installer name", async () => {
    const root = await temporaryRoot()
    await touch(join(root, "dist-app", "build-info.json"))
    await touch(join(root, "dist-app", "qingshe-windows-9.9.9-x64.exe"))

    await expect(verifyReleaseArtifacts({ artifactRoot: root, kind: "windows" })).rejects.toThrow(
      /Missing qingshe-windows/,
    )

    await touch(join(root, "dist-app", "qingshe-windows-0.1.0-x64.exe"))
    await expect(
      verifyReleaseArtifacts({ artifactRoot: root, kind: "windows" }),
    ).resolves.toBeUndefined()
  })

  it("requires an app bundle inside the iOS build directory", async () => {
    const root = await temporaryRoot()
    await touch(join(root, "dist-app", "unsigned", "build-info.json"))
    await touch(join(root, "dist-app", "unsigned", "qingshe-ios-0.1.0-aarch64-sim.app", "binary"))

    await expect(verifyReleaseArtifacts({ artifactRoot: root, kind: "ios" })).rejects.toThrow(
      /Missing qingshe-ios/,
    )

    await touch(
      join(root, "dist-app", "unsigned", "qingshe-ios-0.1.0-aarch64-sim.app", "Info.plist"),
    )
    await expect(
      verifyReleaseArtifacts({ artifactRoot: root, kind: "ios" }),
    ).resolves.toBeUndefined()
  })

  it.each([
    ["signed", "dist-app", true],
    ["unsigned", "dist-app/unsigned", false],
  ])("accepts one internally consistent macOS %s artifact", async (_label, directory, publishable) => {
    const root = await temporaryRoot()
    await writeJson(join(root, directory, "build-info.json"), { publishable })
    await touch(join(root, directory, "qingshe-macos-0.1.0-aarch64.dmg"))
    await touch(join(root, directory, "轻设.app", "Contents", "Info.plist"))

    await expect(
      verifyReleaseArtifacts({ artifactRoot: root, kind: "macos" }),
    ).resolves.toBeUndefined()
  })

  it("rejects ambiguous macOS signed and unsigned build metadata", async () => {
    const root = await temporaryRoot()
    await writeJson(join(root, "dist-app", "build-info.json"), { publishable: true })
    await writeJson(join(root, "dist-app", "unsigned", "build-info.json"), { publishable: false })
    await touch(join(root, "dist-app", "qingshe-macos-0.1.0-aarch64.dmg"))
    await touch(join(root, "dist-app", "轻设.app", "Contents", "Info.plist"))

    await expect(verifyReleaseArtifacts({ artifactRoot: root, kind: "macos" })).rejects.toThrow(
      /exactly one/,
    )
  })

  it("rejects an aggregate with an unrelated iOS app bundle", async () => {
    const root = await temporaryRoot()
    for (const path of [
      "quality/index.html",
      "quality/asset-admin.html",
      "quality/product.html",
      "quality/processor.html",
      "quality/build-info.json",
      "windows/qingshe-windows-0.1.0-x64.exe",
      "macos/qingshe-macos-0.1.0-aarch64.dmg",
      "ios-simulator/unrelated.app/Info.plist",
    ]) {
      await touch(join(root, path))
    }

    await expect(verifyReleaseArtifacts({ artifactRoot: root, kind: "aggregate" })).rejects.toThrow(
      /iOS simulator \.app/,
    )
  })
})
