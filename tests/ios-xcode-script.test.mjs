import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { describe, it } from "vitest"

const testDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(testDirectory, "..")
const execFileAsync = promisify(execFile)

describe("Xcode iOS Rust build phase", () => {
  it("starts the Tauri iOS development bridge with the iOS Swift wrapper", async () => {
    const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"))
    const command = packageJson.scripts["app:ios:dev"]

    assert.match(command, /PATH="\$PWD\/scripts:\$PATH"/)
    assert.match(command, /QINGSHE_IOS_MIN_VERSION=15\.0/)
    assert.match(command, /tauri ios dev --open/)
  })

  it("uses a repository-owned wrapper instead of relying on Xcode's interactive PATH", async () => {
    const script = await readFile(resolve(projectRoot, "scripts/xcode-ios-rust-build.sh"), "utf8")
    const projectYml = await readFile(
      resolve(projectRoot, "src-tauri/gen/apple/project.yml"),
      "utf8",
    )
    const projectFile = await readFile(
      resolve(projectRoot, "src-tauri/gen/apple/qingshe-desktop.xcodeproj/project.pbxproj"),
      "utf8",
    )
    const projectYmlScriptLine = projectYml
      .split("\n")
      .find((line) => line.includes("xcode-ios-rust-build.sh"))
    const projectFileScriptLine = projectFile
      .split("\n")
      .find((line) => line.includes("xcode-ios-rust-build.sh"))

    assert.match(script, /\/usr\/local\/bin/)
    assert.match(script, /corepack/)
    assert.match(script, /tauri ios xcode-script/)
    assert.match(script, /PATH=.*repoRoot.*scripts/)
    assert.match(script, /QINGSHE_IOS_MIN_VERSION=.*15\.0/)
    assert.match(projectYml, /scripts\/xcode-ios-rust-build\.sh/)
    assert.match(projectFile, /scripts\/xcode-ios-rust-build\.sh/)
    assert.match(
      projectFile,
      /\/\* assets \*\/ = \{isa = PBXFileReference; lastKnownFileType = folder; path = assets; sourceTree = SOURCE_ROOT; \};/,
    )
    assert.doesNotMatch(projectFile, /\.\.\/\.\.\/src\/assets/)
    assert.match(projectYml, /"\$SRCROOT\/\.\.\/\.\.\/\.\.\/scripts\/xcode-ios-rust-build\.sh"/)
    assert.match(
      projectFile,
      /\\"\$SRCROOT\/\.\.\/\.\.\/\.\.\/scripts\/xcode-ios-rust-build\.sh\\"/,
    )
    assert.doesNotMatch(projectYmlScriptLine ?? "", /\$\(SRCROOT\)/)
    assert.doesNotMatch(projectFileScriptLine ?? "", /\$\(SRCROOT\)/)
  })

  it("prepares the generated project when the repository path contains non-ASCII characters", async () => {
    await execFileAsync(
      process.execPath,
      [resolve(projectRoot, "scripts/prepare-ios-project.mjs")],
      {
        cwd: projectRoot,
      },
    )
  })
})
