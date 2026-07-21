import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const workflow = await readFile(resolve(process.cwd(), ".github/workflows/release.yml"), "utf8")

function jobBlock(jobId) {
  const startMarker = `\n  ${jobId}:\n`
  const start = workflow.indexOf(startMarker)
  if (start < 0) throw new Error(`Missing workflow job: ${jobId}`)
  const bodyStart = start + startMarker.length
  const nextJob = workflow.slice(bodyStart).search(/\n {2}[a-z][a-z0-9-]*:\n/)
  return workflow.slice(bodyStart, nextJob < 0 ? undefined : bodyStart + nextJob)
}

describe("release workflow credential boundary", () => {
  it("keeps validation and aggregate jobs secret-free", () => {
    const validation = jobBlock("validation")
    const aggregate = jobBlock("aggregate-validation")

    expect(validation).not.toContain("secrets.")
    expect(aggregate).not.toContain("secrets.")
    expect(validation).toContain("qingshe-macos-unsigned-validation-")
    expect(aggregate).toMatch(/name: qingshe-validation-\$\{\{ github\.sha \}\}/)
  })

  it("gates the only secret-bearing job to protected v-tag pushes", () => {
    const signing = jobBlock("macos-signing")

    expect(signing).toMatch(
      /if: github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/v'\)/,
    )
    expect(signing).toMatch(/environment:\s+name: release-signing/)
    expect(signing).toMatch(/ref: \$\{\{ github\.sha \}\}/)
    expect(signing).toContain("release-manifest.mjs --check-tag")
    expect(signing).toContain("APPLE_SIGNING_IDENTITY=$signing_identity")
    expect(signing).toContain("secrets.APPLE_CERTIFICATE")
  })

  it("does not label non-publishable artifacts as releases", () => {
    const unsigned = jobBlock("validation")
    const signing = jobBlock("macos-signing")

    expect(unsigned).not.toMatch(/name:\s+[^\n]*macos[^\n]*release/i)
    expect(signing).not.toMatch(/name:\s+[^\n]*nonpublishable[^\n]*release/i)
    expect(signing).toContain("Verify macOS signed or non-publishable status")
  })
})
