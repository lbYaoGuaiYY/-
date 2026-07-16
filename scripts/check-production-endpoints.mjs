import { readdir, readFile } from "node:fs/promises"
import { extname, resolve } from "node:path"

const projectRoot = resolve(import.meta.dirname, "..")
const scanRoots = [
  "dist",
  "dist-asset-admin",
  "src-tauri/tauri.conf.json",
  "src-tauri/tauri.ios.conf.json",
  "src-tauri/tauri.macos.conf.json",
]
const textExtensions = new Set(["", ".css", ".html", ".js", ".json", ".map", ".txt", ".xml"])
const forbiddenEndpoint =
  /(?:https?:\/\/)?(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/qingshe-assets)?\/api\/v1/gi
const allowedProductionEndpoint = "https://assets.xiduoduo.top/api/v1"
const findings = []

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  if (entries.length === 0) {
    await inspect(path)
    return
  }
  for (const entry of entries) {
    const child = resolve(path, entry.name)
    if (entry.isDirectory()) await walk(child)
    else await inspect(child)
  }
}

async function inspect(path) {
  if (!textExtensions.has(extname(path))) return
  const content = await readFile(path, "utf8").catch(() => null)
  if (content === null) return
  const endpointMatches = content.match(forbiddenEndpoint) ?? []
  for (const endpoint of endpointMatches) findings.push(`${path}: ${endpoint}`)
  if (/VITE_ASSET_SERVICE_URL=/.test(content) && !content.includes(allowedProductionEndpoint)) {
    findings.push(`${path}: production asset endpoint is not ${allowedProductionEndpoint}`)
  }
}

for (const root of scanRoots) await walk(resolve(projectRoot, root))

if (findings.length > 0) {
  process.stderr.write(`Production endpoint scan failed:\n${findings.join("\n")}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`Production endpoint scan passed: ${allowedProductionEndpoint}\n`)
}
