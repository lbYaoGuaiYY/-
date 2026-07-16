import { spawnSync } from "node:child_process"
import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises"
import { arch, platform } from "node:os"
import { resolve } from "node:path"

const root = resolve(".")
const output = resolve(root, "dist-app")
const bundleRoot = resolve(root, "src-tauri/target/release/bundle")
const packageMetadata = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"))
const distributionArch = arch() === "arm64" ? "aarch64" : "x64"

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

if (platform() === "darwin") {
  const outputApp = resolve(output, "轻设.app")
  await cp(resolve(bundleRoot, "macos/轻设.app"), outputApp, { recursive: true })
  const signed = spawnSync("codesign", ["--force", "--deep", "--sign", "-", outputApp], {
    cwd: root,
    stdio: "inherit",
  })
  if (signed.status !== 0) process.exit(signed.status ?? 1)
  const dmg = await findArtifact(resolve(bundleRoot, "dmg"), ".dmg")
  await cp(dmg, resolve(output, `qingshe-macos-${packageMetadata.version}-${distributionArch}.dmg`))
} else if (platform() === "win32") {
  const installer = await findArtifact(resolve(bundleRoot, "nsis"), ".exe")
  await cp(
    installer,
    resolve(output, `qingshe-windows-${packageMetadata.version}-${distributionArch}.exe`),
  )
} else {
  const appImage = await findArtifact(resolve(bundleRoot, "appimage"), ".AppImage")
  await cp(
    appImage,
    resolve(output, `qingshe-linux-${packageMetadata.version}-${distributionArch}.AppImage`),
  )
}

console.log(`Built isolated 轻设 App deliverables: ${output}`)

async function findArtifact(directory, extension) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      try {
        return await findArtifact(path, extension)
      } catch {
        // Keep searching sibling bundle directories.
      }
    } else if (entry.name.endsWith(extension)) {
      return path
    }
  }
  throw new Error(`Missing ${extension} 轻设 App bundle under ${directory}`)
}
