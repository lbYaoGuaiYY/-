import { spawnSync } from "node:child_process"
import { access, chmod, cp, mkdir, readdir, rm } from "node:fs/promises"
import { arch, platform } from "node:os"
import { resolve } from "node:path"

const root = resolve(".")
const output = resolve(root, "dist-processing-agent")
const work = resolve(root, ".processing-agent-build")
const sidecarDist = resolve(work, "sidecar-dist")
const localPython = resolve(root, ".processing-node-py312-venv/bin/python")
let python = process.env.QINGSHE_PROCESSOR_PYTHON || "python3"
const distributionArch = arch() === "arm64" ? "aarch64" : "x64"
try {
  await access(localPython)
  python = process.env.QINGSHE_PROCESSOR_PYTHON || localPython
} catch {
  // Fall back to the current platform's Python command.
}

await rm(output, { recursive: true, force: true })
await rm(work, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await mkdir(sidecarDist, { recursive: true })

const builtSidecar = spawnSync(
  python,
  [
    "-m",
    "PyInstaller",
    "--noconfirm",
    "--clean",
    "--distpath",
    sidecarDist,
    "--workpath",
    resolve(work, "pyinstaller"),
    resolve(root, "tools/asset_admin/qingshe_processor.spec"),
  ],
  { cwd: root, stdio: "inherit" },
)
if (builtSidecar.status !== 0) process.exit(builtSidecar.status ?? 1)

const targetTriple =
  platform() === "darwin"
    ? `${arch() === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`
    : platform() === "win32"
      ? `${arch() === "arm64" ? "aarch64" : "x86_64"}-pc-windows-msvc`
      : `${arch() === "arm64" ? "aarch64" : "x86_64"}-unknown-linux-gnu`
const sidecarName =
  platform() === "win32" ? "qingshe-processing-agent.exe" : "qingshe-processing-agent"
const bundledSidecar = resolve(
  root,
  "src-tauri/binaries",
  `qingshe-processing-agent-${targetTriple}${platform() === "win32" ? ".exe" : ""}`,
)
await mkdir(resolve(root, "src-tauri/binaries"), { recursive: true })
await cp(resolve(sidecarDist, sidecarName), bundledSidecar)
await chmod(bundledSidecar, 0o755)

const bundleType =
  platform() === "darwin" ? "app,dmg" : platform() === "win32" ? "nsis" : "appimage"

const tauriBuild = spawnSync(
  "pnpm",
  [
    "exec",
    "tauri",
    "build",
    "--config",
    "src-tauri/tauri.processor.conf.json",
    "--features",
    "processor",
    "--bundles",
    bundleType,
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      CARGO_BUILD_JOBS: "1",
      CARGO_PROFILE_RELEASE_STRIP: "none",
      CARGO_PROFILE_RELEASE_LTO: "false",
    },
  },
)
if (tauriBuild.status !== 0) process.exit(tauriBuild.status ?? 1)

const bundleRoot = resolve(root, "src-tauri/target/release/bundle")
if (platform() === "win32") {
  const installer = await findArtifact(resolve(bundleRoot, "nsis"), ".exe")
  const packagedInstaller = resolve(output, `qingshe-processor-windows-${distributionArch}.exe`)
  await cp(installer, packagedInstaller)
  console.log(`Built local processor app: ${packagedInstaller}`)
  process.exit(0)
}
if (platform() === "linux") {
  const appImage = await findArtifact(resolve(bundleRoot, "appimage"), ".AppImage")
  const packagedAppImage = resolve(output, `qingshe-processor-linux-${distributionArch}.AppImage`)
  await cp(appImage, packagedAppImage)
  await chmod(packagedAppImage, 0o755)
  console.log(`Built local processor app: ${packagedAppImage}`)
  process.exit(0)
}

const appSource = resolve(bundleRoot, "macos/轻抠.app")
const outputApp = resolve(output, "轻抠.app")
const outputDmg = resolve(output, `qingshe-processor-macos-${distributionArch}.dmg`)
await cp(appSource, outputApp, { recursive: true })
const signed = spawnSync("codesign", ["--force", "--deep", "--sign", "-", outputApp], {
  cwd: root,
  stdio: "inherit",
})
if (signed.status !== 0) process.exit(signed.status ?? 1)
const packaged = spawnSync(
  "hdiutil",
  ["create", "-volname", "轻抠", "-srcfolder", outputApp, "-ov", "-format", "UDZO", outputDmg],
  { cwd: root, stdio: "inherit" },
)
if (packaged.status !== 0) process.exit(packaged.status ?? 1)
console.log(`Built local processor app: ${resolve(output, "轻抠.app")}`)
console.log(`Built local processor package: ${outputDmg}`)

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
  throw new Error(`Missing ${extension} processor bundle under ${directory}`)
}
