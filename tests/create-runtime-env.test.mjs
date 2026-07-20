import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const shellExecutable = resolveShellExecutable()

function resolveShellExecutable() {
  if (process.platform !== "win32") return "sh"
  const candidates = [
    resolve(process.env.ProgramFiles ?? "C:/Program Files", "Git/bin/sh.exe"),
    resolve(process.env.LOCALAPPDATA ?? "", "Programs/Git/bin/sh.exe"),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? "sh"
}

describe("cloud editor runtime environment", () => {
  it("writes Vite-readable editor settings to the project root", async () => {
    const temporaryRoot = await mkdtemp(resolve(tmpdir(), "qingshe-runtime-env-"))
    const scriptSource = resolve(projectRoot, "deploy/asset-cloud/create-runtime-env.sh")
    const scriptPath = resolve(temporaryRoot, "deploy/asset-cloud/create-runtime-env.sh")

    try {
      await mkdir(dirname(scriptPath), { recursive: true })
      await cp(scriptSource, scriptPath)
      await writeFile(
        resolve(temporaryRoot, "deploy/asset-cloud/.env"),
        [
          "QINGSHE_EDITOR_TOKEN=editor-token",
          "QINGSHE_ADMIN_TOKEN=admin-token",
          "QINGSHE_ALLOWED_ORIGINS=http://127.0.0.1:4173",
          "",
        ].join("\n"),
        { mode: 0o600 },
      )

      await execFileAsync(shellExecutable, [scriptPath], { cwd: temporaryRoot })

      const editorEnv = await readFile(resolve(temporaryRoot, ".env.local"), "utf8")
      expect(editorEnv).toContain("VITE_ASSET_SERVICE_URL=https://assets.xiduoduo.top/api/v1")
      expect(editorEnv).not.toMatch(/191\.223\.220\.201/)
      expect(editorEnv).toContain("VITE_ASSET_EDITOR_TOKEN=editor-token")
      expect(editorEnv).toContain("VITE_ASSET_SERVICE_EVENTS=0")
      expect(editorEnv).not.toContain("VITE_ASSET_ADMIN_SERVICE_URL")
      expect(editorEnv).not.toContain("VITE_ASSET_CLOUD_ADMIN_TOKEN")
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it("includes the production asset-admin origin in a fresh cloud environment", async () => {
    const temporaryRoot = await mkdtemp(resolve(tmpdir(), "qingshe-runtime-origin-"))
    const scriptSource = resolve(projectRoot, "deploy/asset-cloud/create-runtime-env.sh")
    const scriptPath = resolve(temporaryRoot, "deploy/asset-cloud/create-runtime-env.sh")

    try {
      await mkdir(dirname(scriptPath), { recursive: true })
      await cp(scriptSource, scriptPath)
      await execFileAsync(shellExecutable, [scriptPath], { cwd: temporaryRoot })

      const cloudEnv = await readFile(resolve(temporaryRoot, "deploy/asset-cloud/.env"), "utf8")
      expect(cloudEnv).toContain("https://assets.xiduoduo.top")
      expect(cloudEnv).toContain("http://tauri.localhost")
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })
})
