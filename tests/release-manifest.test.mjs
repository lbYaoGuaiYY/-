import { describe, expect, it } from "vitest"

import {
  formatReleaseArtifact,
  readBuildRevision,
  readReleaseManifest,
  validateReleaseTag,
} from "../scripts/release-manifest.mjs"

describe("release manifest", () => {
  it("is the single source for the editor version and platform artifact names", async () => {
    const manifest = await readReleaseManifest()

    expect(manifest.productName).toBe("轻设")
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(
      formatReleaseArtifact(manifest.artifacts.macos, {
        version: manifest.version,
        arch: "aarch64",
      }),
    ).toBe(`qingshe-macos-${manifest.version}-aarch64.dmg`)
    expect(
      formatReleaseArtifact(manifest.browserExtension.chrome, {
        version: "9.9.9",
      }),
    ).toBe("qingshe-image-archive-9.9.9-chrome.zip")
  })

  it("keeps CI provenance deterministic when a revision is supplied", () => {
    expect(readBuildRevision({ env: { QINGSHE_BUILD_REVISION: "a".repeat(64) } })).toBe(
      "a".repeat(40),
    )
  })

  it("requires an exact v-prefixed tag for a release", async () => {
    const manifest = await readReleaseManifest()

    expect(validateReleaseTag(`v${manifest.version}`, manifest.version)).toBe(
      `v${manifest.version}`,
    )
    expect(() => validateReleaseTag("v9.9.9", manifest.version)).toThrow(/must be/)
  })
})
