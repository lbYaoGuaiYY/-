import { execFileSync } from "node:child_process"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import productSurfaces from "./config/product-surfaces.json" with { type: "json" }
import packageMetadata from "./package.json" with { type: "json" }

export default defineConfig(({ mode }) => {
  const isAssetAdminBuild = mode === productSurfaces.assetPanel.mode
  const isProcessorBuild = mode === productSurfaces.processor.mode
  const activeSurface = isAssetAdminBuild
    ? productSurfaces.assetPanel
    : isProcessorBuild
      ? productSurfaces.processor
      : productSurfaces.editor
  const input = isAssetAdminBuild
    ? {
        assetAdmin: productSurfaces.assetPanel.html,
        manual: "manual.html",
        product: "product.html",
      }
    : activeSurface.html
  const revision = readBuildRevision()
  const { TAURI_DEV_HOST: tauriDevHost } = process.env

  return {
    plugins: [
      react(),
      {
        name: "qingshe-tauri-html-assets",
        transformIndexHtml(html) {
          return html.replaceAll(" crossorigin", "")
        },
      },
    ],
    // Tauri loads the packaged frontend from its custom protocol. Relative
    // asset URLs keep desktop, iOS, and browser preview builds portable.
    base: "./",
    define: {
      __QINGSHE_BUILD__: JSON.stringify({
        revision,
        surface: activeSurface.name,
        version: packageMetadata.version,
      }),
    },
    build: {
      modulePreload: false,
      outDir: activeSurface.outDir,
      rolldownOptions: {
        input,
        output: {
          codeSplitting: {
            groups: [
              {
                name: "fabric-vendor",
                test: /node_modules[\\/]fabric/,
                priority: 30,
                maxSize: 450_000,
              },
              {
                name: "react-vendor",
                test: /node_modules[\\/](react|react-dom|scheduler)/,
                priority: 20,
              },
              {
                name: "editor-vendor",
                test: /node_modules[\\/](@dnd-kit|@phosphor-icons|dexie|zod)/,
                priority: 15,
                maxSize: 450_000,
              },
              {
                name: "vendor",
                test: /node_modules/,
                priority: 10,
                maxSize: 450_000,
              },
            ],
          },
        },
      },
    },
    server: {
      // Tauri supplies a LAN address for iPad hardware. All editor runtimes
      // still load this exact Vite entry; only the transport address changes.
      host: tauriDevHost ?? "127.0.0.1",
      port: 4173,
      strictPort: true,
      proxy: {
        "/api/rembg": {
          target: "http://127.0.0.1:7000",
          rewrite: (path) => path.replace(/^\/api\/rembg/, ""),
        },
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 4174,
      strictPort: true,
    },
  }
})

function readBuildRevision(): string {
  const { GITHUB_SHA: githubRevision, QINGSHE_BUILD_REVISION: suppliedRevision } = process.env
  const supplied = suppliedRevision ?? githubRevision
  if (supplied?.trim()) return supplied.trim().slice(0, 12)
  try {
    const revision = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    return dirty ? `${revision}-dirty` : revision
  } catch {
    return "source"
  }
}
