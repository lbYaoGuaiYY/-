import { spawn } from "node:child_process"
import { resolve } from "node:path"

const projectRoot = resolve(import.meta.dirname, "..")
const child = spawn(
  "uv",
  [
    "run",
    "--project",
    resolve(projectRoot, "deploy/asset-cloud"),
    "--with",
    "rembg[cpu]==2.0.75",
    "--with",
    "numba==0.62.1",
    "--with",
    "pillow==12.1.0",
    "--with",
    "httpx",
    "python",
    resolve(projectRoot, "scripts/verify-full-pipeline.py"),
  ],
  {
    cwd: projectRoot,
    env: { ...process.env, PYTHONPATH: projectRoot },
    stdio: "inherit",
    windowsHide: true,
  },
)

child.on("error", (error) => {
  process.stderr.write(`无法启动完整链路验收：${error.message}\n`)
  process.exitCode = 1
})
child.on("exit", (code, signal) => {
  if (signal) process.stderr.write(`完整链路验收被信号 ${signal} 中止\n`)
  process.exitCode = code ?? 1
})
