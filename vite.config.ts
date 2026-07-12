import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig(({ mode }) => {
  const isAssetAdminBuild = mode === "asset-admin"
  const entryFile = isAssetAdminBuild ? "asset-admin.html" : "index.html"

  return {
    plugins: [react()],
    build: {
      outDir: isAssetAdminBuild ? "dist-asset-admin" : "dist",
      rolldownOptions: {
        input: entryFile,
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
      host: "127.0.0.1",
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
