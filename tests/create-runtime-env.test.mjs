import { execFile } from "node:child_process"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

describe("cloud editor runtime environment", () => {
  it("writes Vite-readable editor settings to the project root", async () => {
    const temporaryRoot = await mkdtemp(resolve(tmpdir(), "qingshe-runtime-env-"))
    const scriptSource = resolve(projectRoot, "scripts/create-runtime-env.mjs")
    const scriptPath = resolve(temporaryRoot, "scripts/create-runtime-env.mjs")

    try {
      await mkdir(dirname(scriptPath), { recursive: true })
      await mkdir(resolve(temporaryRoot, "deploy/asset-cloud"), { recursive: true })
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

      await execFileAsync(process.execPath, [scriptPath], { cwd: temporaryRoot })

      const editorEnv = await readFile(resolve(temporaryRoot, ".env.local"), "utf8")
      expect(editorEnv).toContain("VITE_ASSET_SERVICE_URL=https://assets.xiduoduo.top/api/v1")
      expect(editorEnv).not.toMatch(/191\.223\.220\.201/)
      expect(editorEnv).toContain("VITE_ASSET_EDITOR_TOKEN=editor-token")
      expect(editorEnv).toContain("VITE_ASSET_SERVICE_EVENTS=0")
      expect(editorEnv).not.toContain("VITE_ASSET_ADMIN_SERVICE_URL")
      expect(editorEnv).not.toContain("VITE_ASSET_CLOUD_ADMIN_TOKEN")

      const cloudEnv = await readFile(resolve(temporaryRoot, "deploy/asset-cloud/.env"), "utf8")
      expect(cloudEnv).toContain("QINGSHE_ADMIN_USERNAME=admin")
      expect(cloudEnv).toMatch(/QINGSHE_ADMIN_PASSWORD_HASH=[A-Za-z0-9_-]+/)
      expect(cloudEnv).toMatch(/QINGSHE_ADMIN_SESSION_SECRET=[a-f0-9]{64}/)
      const credentials = await readFile(
        resolve(temporaryRoot, "deploy/asset-cloud/.admin-credentials"),
        "utf8",
      )
      expect(credentials).toMatch(/password=[A-Za-z0-9_-]{24}/)
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it("includes the production asset-admin origin in a fresh cloud environment", async () => {
    const temporaryRoot = await mkdtemp(resolve(tmpdir(), "qingshe-runtime-origin-"))
    const scriptSource = resolve(projectRoot, "scripts/create-runtime-env.mjs")
    const scriptPath = resolve(temporaryRoot, "scripts/create-runtime-env.mjs")

    try {
      await mkdir(dirname(scriptPath), { recursive: true })
      await cp(scriptSource, scriptPath)
      await execFileAsync(process.execPath, [scriptPath], { cwd: temporaryRoot })

      const cloudEnv = await readFile(resolve(temporaryRoot, "deploy/asset-cloud/.env"), "utf8")
      expect(cloudEnv).toContain("https://assets.xiduoduo.top")
      expect(cloudEnv).toContain("http://tauri.localhost")
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })
})
