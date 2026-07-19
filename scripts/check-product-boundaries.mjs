import { access, readFile } from "node:fs/promises"
import { resolve } from "node:path"

const root = resolve(process.cwd())

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"))
}

async function requireFile(path) {
  await access(resolve(root, path))
}

async function forbidFile(path, message) {
  try {
    await access(resolve(root, path))
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return
    throw error
  }
  throw new Error(message)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

export async function checkProductBoundaries({ artifacts = false } = {}) {
  const [manifest, packageJson, tauriConfig, processorConfig, processorCapability, cargo] =
    await Promise.all([
      readJson("config/product-surfaces.json"),
      readJson("package.json"),
      readJson("src-tauri/tauri.conf.json"),
      readJson("src-tauri/tauri.processor.conf.json"),
      readJson("src-tauri/capabilities/processor.json"),
      readFile(resolve(root, "src-tauri/Cargo.toml"), "utf8"),
    ])

  for (const surface of [manifest.editor, manifest.assetPanel, manifest.processor]) {
    await Promise.all([requireFile(surface.html), requireFile(surface.entry)])
  }
  await requireFile(manifest.browserExtension.root)

  assert(manifest.editor.entry === "src/main.tsx", "轻设 App 必须只有 src/main.tsx 一个业务入口")
  assert(
    JSON.stringify(manifest.editor.runtimes) ===
      JSON.stringify(["web", "windows", "macos", "ipados"]),
    "Web、Windows、macOS、iPadOS 必须共享轻设 App 入口",
  )
  assert(
    tauriConfig.build.frontendDist === `../${manifest.editor.outDir}`,
    "Tauri 未读取轻设 Web 构建",
  )
  assert(
    tauriConfig.build.beforeBuildCommand === "pnpm app:build",
    "Tauri 构建未统一调用 app:build",
  )
  assert(
    tauriConfig.build.beforeDevCommand === "pnpm app:dev:tauri",
    "Tauri 开发未统一调用 App 开发入口",
  )
  assert(packageJson.version === tauriConfig.version, "package.json 与轻设 Tauri 版本不一致")
  assert(
    packageJson.scripts["app:desktop:build"]?.includes("finalize-desktop-app-build.mjs"),
    "轻设桌面包未输出到独立 dist-app 目录",
  )
  assert(
    packageJson.scripts["app:windows:build"]?.includes("--bundles nsis"),
    "轻设 Windows 安装包缺少统一构建命令",
  )
  assert(
    !Object.keys(packageJson.scripts).some((name) => name.startsWith("qingsu:")),
    "禁止恢复轻素桌面壳",
  )
  try {
    await access(resolve(root, "src-tauri/tauri.qingsu.conf.json"))
    throw new Error("禁止恢复 src-tauri/tauri.qingsu.conf.json；素材面板只部署到服务器")
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("禁止恢复")) throw error
  }

  const processorWindow = processorConfig.app.windows[0]
  assert(
    processorConfig.build.frontendDist === `../${manifest.processor.outDir}`,
    "轻抠前端输出目录不一致",
  )
  assert(
    processorConfig.build.beforeBuildCommand === "pnpm processor:web:build",
    "轻抠原生构建未统一调用 processor:web:build",
  )
  assert(
    processorConfig.build.beforeDevCommand === "pnpm processor:web:dev",
    "轻抠原生开发未统一调用 processor:web:dev",
  )
  assert(processorWindow?.label === "processor", "轻抠必须使用独立窗口权限边界")
  assert(processorWindow?.url === manifest.processor.html, "轻抠未读取 processor.html")
  assert(processorCapability.windows?.length === 1, "轻抠能力不能绑定多个窗口")
  assert(processorCapability.windows[0] === "processor", "轻抠能力错误地暴露给轻设 App")
  assert(
    cargo.includes("processor = [") &&
      cargo.includes("tauri-plugin-shell") &&
      cargo.includes("tray-icon"),
    "轻抠原生能力必须由 Cargo feature 隔离",
  )

  if (artifacts) {
    await Promise.all([
      requireFile(`${manifest.editor.outDir}/index.html`),
      requireFile(`${manifest.assetPanel.outDir}/asset-admin.html`),
      requireFile(`${manifest.assetPanel.outDir}/manual.html`),
      requireFile(`${manifest.assetPanel.outDir}/product.html`),
      requireFile(`${manifest.processor.outDir}/processor.html`),
      requireFile(`${manifest.browserExtension.root}/dist/chrome/manifest.json`),
      requireFile(`${manifest.browserExtension.root}/dist/firefox/manifest.json`),
    ])
    for (const forbidden of ["asset-admin.html", "manual.html", "processor.html", "product.html"]) {
      await forbidFile(
        resolve(manifest.editor.outDir, forbidden),
        `轻设 App 构建混入了其他产品页面：${forbidden}`,
      )
    }
    for (const browser of ["chrome", "firefox"]) {
      const extensionDirectory = resolve(manifest.browserExtension.root, "dist", browser)
      await forbidFile(
        resolve(extensionDirectory, "preview-runtime.js"),
        `${browser} 正式扩展混入了开发预览运行时`,
      )
      await forbidFile(
        resolve(extensionDirectory, "scan-active-tab.d.ts"),
        `${browser} 正式扩展混入了 TypeScript 声明文件`,
      )
      const popupHtml = await readFile(resolve(root, extensionDirectory, "popup.html"), "utf8")
      assert(!popupHtml.includes("preview-runtime.js"), `${browser} 弹窗仍在加载开发预览运行时`)
    }
  }
}

const isMain = process.argv[1]?.endsWith("check-product-boundaries.mjs")
if (isMain) {
  await checkProductBoundaries({ artifacts: process.argv.includes("--artifacts") })
  console.log("产品边界检查通过：轻设 App（主） / 云素材面板 / 浏览器插件 / 轻抠")
}
