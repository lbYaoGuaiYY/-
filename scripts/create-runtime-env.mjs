import { pbkdf2Sync, randomBytes } from "node:crypto"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const DEFAULT_ALLOWED_ORIGINS = [
  "https://assets.xiduoduo.top",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "http://127.0.0.1:4174",
  "http://localhost:4174",
  "tauri://localhost",
  "http://tauri.localhost",
].join(",")

function parseEnv(content) {
  const values = new Map()
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    values.set(match[1], value)
  }
  return values
}

function serializeEnv(values) {
  return `${[...values].map(([key, value]) => `${key}=${value}`).join("\n")}\n`
}

function createAdminPassword() {
  return randomBytes(18).toString("base64url")
}

function createPasswordHash(password) {
  const salt = randomBytes(16)
  return {
    salt: salt.toString("base64url"),
    hash: pbkdf2Sync(password, salt, 120_000, 32, "sha256").toString("base64url"),
  }
}

async function readEnv(path) {
  return parseEnv(await readFile(path, "utf8").catch(() => ""))
}

async function writePrivateFile(path, content) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, { encoding: "utf8", mode: 0o600 })
  await chmod(path, 0o600).catch(() => undefined)
}

export async function createRuntimeEnvironment({ projectRoot } = {}) {
  const resolvedProjectRoot = resolve(
    projectRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  )
  const cloudDirectory = resolve(resolvedProjectRoot, "deploy/asset-cloud")
  const cloudEnvPath = resolve(cloudDirectory, ".env")
  const credentialPath = resolve(cloudDirectory, ".admin-credentials")
  const editorEnvPath = resolve(resolvedProjectRoot, ".env.local")
  const cloudEnv = await readEnv(cloudEnvPath)
  const existingEditorEnv = await readEnv(editorEnvPath)

  if (!cloudEnv.get("QINGSHE_EDITOR_TOKEN")) {
    cloudEnv.set(
      "QINGSHE_EDITOR_TOKEN",
      existingEditorEnv.get("VITE_ASSET_EDITOR_TOKEN") || randomBytes(32).toString("hex"),
    )
  }
  if (!cloudEnv.get("QINGSHE_ADMIN_TOKEN")) {
    cloudEnv.set(
      "QINGSHE_ADMIN_TOKEN",
      existingEditorEnv.get("VITE_ASSET_CLOUD_ADMIN_TOKEN") || randomBytes(32).toString("hex"),
    )
  }
  if (!cloudEnv.get("QINGSHE_ALLOWED_ORIGINS")) {
    cloudEnv.set("QINGSHE_ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS)
  }

  const adminKeys = [
    "QINGSHE_ADMIN_USERNAME",
    "QINGSHE_ADMIN_PASSWORD_SALT",
    "QINGSHE_ADMIN_PASSWORD_HASH",
    "QINGSHE_ADMIN_SESSION_SECRET",
  ]
  const generatedAdminCredentials = adminKeys.some((key) => !cloudEnv.get(key))
  if (generatedAdminCredentials) {
    const username = cloudEnv.get("QINGSHE_ADMIN_USERNAME") || "admin"
    const password = createAdminPassword()
    const passwordHash = createPasswordHash(password)
    cloudEnv.set("QINGSHE_ADMIN_USERNAME", username)
    cloudEnv.set("QINGSHE_ADMIN_PASSWORD_SALT", passwordHash.salt)
    cloudEnv.set("QINGSHE_ADMIN_PASSWORD_HASH", passwordHash.hash)
    cloudEnv.set("QINGSHE_ADMIN_SESSION_SECRET", randomBytes(32).toString("hex"))
    await writePrivateFile(
      credentialPath,
      [
        "轻设素材管理初始登录凭证（仅保存在部署主机）",
        `username=${username}`,
        `password=${password}`,
        "首次登录后请按运维流程轮换凭证。",
        "",
      ].join("\n"),
    )
  }

  await writePrivateFile(cloudEnvPath, serializeEnv(cloudEnv))
  await writePrivateFile(
    editorEnvPath,
    [
      "VITE_APP_ENV=production",
      "VITE_ASSET_SERVICE_URL=https://assets.xiduoduo.top/api/v1",
      `VITE_ASSET_EDITOR_TOKEN=${cloudEnv.get("QINGSHE_EDITOR_TOKEN")}`,
      "VITE_ASSET_SERVICE_EVENTS=0",
      "",
    ].join("\n"),
  )

  return { cloudEnvPath, credentialPath, editorEnvPath, generatedAdminCredentials }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await createRuntimeEnvironment()
  process.stdout.write(`已写入云端环境：${result.cloudEnvPath}\n`)
  process.stdout.write(`已写入编辑器环境：${result.editorEnvPath}\n`)
  if (result.generatedAdminCredentials) {
    process.stdout.write(`已生成初始管理登录凭证：${result.credentialPath}\n`)
  }
}
