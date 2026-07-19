import assert from "node:assert/strict"
import { readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { chromium } from "@playwright/test"

const localApiUrl = requiredEnvironment("QINGSHE_VERIFY_API_URL").replace(/\/+$/, "")
const extensionToken = requiredEnvironment("QINGSHE_VERIFY_EXTENSION_TOKEN")
const extensionDeviceId = requiredEnvironment("QINGSHE_VERIFY_EXTENSION_DEVICE_ID")
const sourceImagePath = requiredEnvironment("QINGSHE_VERIFY_SOURCE_IMAGE")
const extensionPath = resolve("browser-extension/dist/chrome")
const sourceImage = await readFile(sourceImagePath)
const profilePath = resolve(join(tmpdir(), `qingshe-browser-pipeline-${process.pid}-${Date.now()}`))

let context
let createdRun = null
let uploadedItem = null

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`缺少完整浏览器闭环环境变量：${name}`)
  return value
}

function providerFixture() {
  return `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8" /><title>ChatGPT 完整闭环验收</title></head>
  <body>
    <main>
      <h1>ChatGPT 图片生成会话</h1>
      <div id="prompt-textarea" contenteditable="true" data-lexical-editor="true" role="textbox" aria-label="提示词"></div>
      <button data-testid="send-button" aria-label="发送消息">发送</button>
      <section id="results" aria-label="生成结果"></section>
    </main>
    <script>
      window.__qingshePrompts = [];
      const composer = document.querySelector('#prompt-textarea');
      document.querySelector('button').addEventListener('click', () => {
        window.__qingshePrompts.push(composer.textContent || '');
        setTimeout(() => {
          const image = document.createElement('img');
          image.alt = '真实插件闭环素材';
          image.width = 720;
          image.height = 540;
          image.src = '/fixture/generated.png?run=' + Date.now();
          document.querySelector('#results').append(image);
        }, 120);
      });
    </script>
  </body>
</html>`
}

async function proxyAssetApi(route) {
  const request = route.request()
  const official = new URL(request.url())
  const suffix = `${official.pathname.replace(/^\/api\/v1/, "")}${official.search}`
  const headers = { ...request.headers() }
  for (const name of [
    "accept-encoding",
    "content-length",
    "host",
    "origin",
    "referer",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
  ]) {
    delete headers[name]
  }
  const method = request.method()
  const body = method === "GET" || method === "HEAD" ? undefined : request.postDataBuffer()
  const response = await fetch(`${localApiUrl}${suffix}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
    redirect: "manual",
  })
  const bytes = Buffer.from(await response.arrayBuffer())
  const contentType = response.headers.get("content-type") || "application/octet-stream"
  if (contentType.includes("application/json") && bytes.length > 0) {
    const payload = JSON.parse(bytes.toString("utf8"))
    if (method === "POST" && official.pathname.endsWith("/extension-runs")) {
      createdRun = payload
    }
    if (method === "POST" && /\/items\/[^/]+\/upload$/.test(official.pathname)) {
      uploadedItem = payload
    }
  }
  await route.fulfill({
    status: response.status,
    headers: { "content-type": contentType },
    body: bytes,
  })
}

async function waitForUpload(timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (uploadedItem?.task_id) return uploadedItem
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error("真实 MV3 扩展未在 30 秒内把图片上传到素材服务")
}

async function main() {
  context = await chromium.launchPersistentContext(profilePath, {
    acceptDownloads: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    channel: "chromium",
    headless: true,
    locale: "zh-CN",
    serviceWorkers: "allow",
    viewport: { width: 1280, height: 800 },
  })
  await context.route(/^https:\/\/chatgpt\.com(?:\/.*)?$/, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === "/fixture/generated.png") {
      await route.fulfill({
        body: sourceImage,
        contentType: "image/png",
        headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
      })
      return
    }
    await route.fulfill({ body: providerFixture(), contentType: "text/html" })
  })
  await context.route(/^https:\/\/assets\.xiduoduo\.top\/api\/v1(?:\/.*)?$/, proxyAssetApi)
  for (const page of context.pages()) await page.close()

  let worker = context
    .serviceWorkers()
    .find((candidate) => candidate.url().endsWith("service-worker.js"))
  worker ??= await context.waitForEvent("serviceworker", { timeout: 15_000 })
  const browserExtensionId = worker.url().split("/")[2]
  assert.match(browserExtensionId, /^[a-p]{32}$/)
  assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().manifest_version), 3)
  await worker.evaluate(
    async (connection) => chrome.storage.local.set({ qingsheExtensionConnection: connection }),
    {
      baseUrl: "https://assets.xiduoduo.top/api/v1",
      token: extensionToken,
      deviceId: extensionDeviceId,
    },
  )

  const popup = await context.newPage()
  await popup.setViewportSize({ width: 420, height: 560 })
  await popup.goto(`chrome-extension://${browserExtensionId}/popup.html`)
  await popup.locator("#connection-state").filter({ hasText: "服务器已连接" }).waitFor()
  await popup.locator("#auto-provider").selectOption("chatgpt")
  await popup.locator("#auto-count").fill("1")
  await popup.locator("#auto-prompt").fill("真实插件闭环素材")

  const providerPagePromise = context.waitForEvent("page", {
    predicate: (page) => page.url().startsWith("https://chatgpt.com/"),
    timeout: 15_000,
  })
  await popup.locator("#auto-start").click()
  const providerPage = await providerPagePromise
  await providerPage.goto("https://chatgpt.com/")
  await providerPage.waitForFunction(() => window.__qingshePrompts?.length === 1)
  const upload = await waitForUpload()
  assert.ok(createdRun?.id && createdRun?.items?.length === 1)
  assert.equal(upload.created, true)
  const stored = await worker.evaluate(() => chrome.storage.local.get("qingsheAutomationState"))
  assert.equal(stored.qingsheAutomationState.id, createdRun.id)
  assert.equal(stored.qingsheAutomationState.items[0].status, "processing")

  console.log(
    JSON.stringify({
      created: upload.created,
      browser_extension_id: browserExtensionId,
      run_id: createdRun.id,
      item_id: createdRun.items[0].id,
      task_id: upload.task_id,
      prompt_submissions: await providerPage.evaluate(() => window.__qingshePrompts.length),
      uploads: 1,
    }),
  )
}

try {
  await main()
} finally {
  await context?.close().catch(() => undefined)
  assert.ok(
    profilePath.startsWith(`${resolve(tmpdir())}\\`) &&
      basename(profilePath).startsWith("qingshe-browser-pipeline-"),
    `拒绝清理意外目录：${profilePath}`,
  )
  await rm(profilePath, { recursive: true, force: true })
}
