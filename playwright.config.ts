import { defineConfig } from "@playwright/test"

const appUrl = "http://127.0.0.1:4173"

export default defineConfig({
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  outputDir: "test-results/playwright",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  retries: 0,
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: appUrl,
    browserName: "chromium",
    colorScheme: "dark",
    locale: "zh-CN",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: "corepack pnpm dev --host 127.0.0.1 --port 4173",
    reuseExistingServer: true,
    timeout: 120_000,
    url: appUrl,
  },
})
