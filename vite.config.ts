import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
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
  },
  preview: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
  },
})
