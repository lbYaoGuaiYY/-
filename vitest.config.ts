import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    clearMocks: true,
    environment: "jsdom",
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    mockReset: true,
    passWithNoTests: false,
    restoreMocks: true,
    testTimeout: 5_000,
    unstubEnvs: true,
    unstubGlobals: true,
  },
})
