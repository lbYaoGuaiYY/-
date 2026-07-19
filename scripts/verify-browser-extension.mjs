import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { promisify } from "node:util"
import AxeBuilder from "@axe-core/playwright"
import { chromium } from "@playwright/test"
import { unzipSync } from "fflate"

const extensionPath = resolve("browser-extension/dist/chrome")
const auditDirectory = resolve("docs/audits/2026-07-17-final-product")
const fixtureImage = await readFile(resolve("src/features/assets/media/burgundy-autumn-floral.png"))
const fixtureImageBase64 = fixtureImage.toString("base64")
const userDataDirectory = await mkdtemp(join(tmpdir(), "qingshe-extension-e2e-"))
const connection = {
  baseUrl: "https://assets.xiduoduo.top/api/v1",
  token: "extension-e2e-token-1234567890",
  deviceId: "extension-e2e-device",
}

const api = {
  cancellations: [],
  heartbeats: 0,
  itemUpdates: [],
  runSequence: 0,
  runs: new Map(),
  uploads: [],
}
let nextProviderBehavior = { mode: "generate", delayMs: 120 }
let context
const execFileAsync = promisify(execFile)

function jsonResponse(route, value, status = 200) {
  return route.fulfill({
    body: JSON.stringify(value),
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    status,
  })
}

function createRun(config) {
  api.runSequence += 1
  const id = `extension-e2e-run-${api.runSequence}`
  const run = {
    id,
    provider: config.provider,
    prompt: config.prompt,
    count: config.count,
    category: config.category ?? null,
    status: "running",
    items: Array.from({ length: config.count }, (_, index) => ({
      id: `${id}-item-${index + 1}`,
      ordinal: index + 1,
      status: "queued",
      error: null,
    })),
  }
  api.runs.set(id, run)
  return run
}

function providerFixture(provider, behavior) {
  const isGemini = provider === "gemini"
  const composer = isGemini
    ? '<div class="ql-editor" contenteditable="true" role="textbox" aria-label="提示词"></div>'
    : '<div id="prompt-textarea" contenteditable="true" data-lexical-editor="true" role="textbox" aria-label="提示词"></div>'
  const send = isGemini
    ? '<button class="send-button" aria-label="发送消息">发送</button>'
    : '<button data-testid="send-button" aria-label="发送消息">发送</button>'
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${isGemini ? "Gemini" : "ChatGPT"} 真实扩展测试页</title>
    <style>
      body { margin: 0; min-height: 100vh; background: #171717; color: #f3f3f3; font: 16px system-ui; }
      main { width: min(860px, calc(100% - 48px)); margin: 48px auto; }
      .composer { display: grid; gap: 12px; padding: 16px; border: 1px solid #444; background: #252525; }
      [contenteditable] { min-height: 80px; padding: 12px; border: 1px solid #555; background: #191919; }
      button { justify-self: end; min-width: 96px; min-height: 40px; }
      #results { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 24px; }
      #results img { width: 100%; min-height: 260px; object-fit: contain; background: #111; }
    </style>
  </head>
  <body>
    <main>
      <h1>${isGemini ? "Gemini" : "ChatGPT"} 图片生成会话</h1>
      <section class="composer">${composer}${send}</section>
      <section id="results" aria-label="生成结果"></section>
    </main>
    <script>
      window.__qingshePrompts = [];
      const composer = document.querySelector('[contenteditable="true"]');
      const send = document.querySelector('button');
      send.addEventListener('click', () => {
        const prompt = composer.textContent || composer.value || '';
        window.__qingshePrompts.push(prompt);
        if (${JSON.stringify(behavior.mode)} === 'stall') return;
        setTimeout(() => {
          const image = document.createElement('img');
          image.alt = '生成的高清花艺素材';
          image.src = '/fixture/generated-' + window.__qingshePrompts.length + '.png?provider=${provider}&run=' + Date.now();
          document.querySelector('#results').append(image);
        }, ${Number(behavior.delayMs)});
      });
    </script>
  </body>
</html>`
}

function manualFixture() {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>ChatGPT 多图会话</title>
    <style>
      body { margin: 0; background: #171717; color: #f3f3f3; font: 16px system-ui; }
      main { width: min(980px, calc(100% - 48px)); margin: 40px auto; }
      section { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
      figure { margin: 0; padding: 14px; border: 1px solid #444; background: #252525; }
      img { display: block; width: 100%; height: 360px; object-fit: contain; background: #111; }
      figcaption { margin-top: 10px; }
    </style>
  </head>
  <body>
    <main>
      <h1>ChatGPT 图片生成结果</h1>
      <section>
        <figure><img src="data:image/png;base64,${fixtureImageBase64}" alt="酒红秋日花艺" /><figcaption>酒红秋日花艺</figcaption></figure>
        <figure><img src="data:image/png;qingshe=variation;base64,${fixtureImageBase64}" alt="婚礼桌花素材" /><figcaption>婚礼桌花素材</figcaption></figure>
      </section>
    </main>
  </body>
</html>`
}

function panelFixture() {
  return `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8" /><title>轻设素材面板</title></head>
  <body>
    <main><h1>轻设素材面板</h1><p id="received" role="status">等待插件文件</p></main>
    <script>
      window.__qingsheReceivedFiles = [];
      window.addEventListener('message', (event) => {
        if (event.origin !== location.origin || event.data?.source !== 'qingshe-extension') return;
        if (event.data?.type !== 'qingshe-extension-upload') return;
        window.__qingsheReceivedFiles.push(event.data.file);
        document.querySelector('#received').textContent = '已接收 ' + window.__qingsheReceivedFiles.length + ' 个文件';
      });
      const announce = () => window.postMessage({ source: 'qingshe-panel', type: 'qingshe-extension-ready' }, location.origin);
      announce();
      setInterval(announce, 250);
    </script>
  </body>
</html>`
}

async function installRoutes(browserContext) {
  await browserContext.route(/^https:\/\/chatgpt\.com(?:\/.*)?$/, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith("/fixture/") && url.pathname.endsWith(".png")) {
      await route.fulfill({
        body: fixtureImage,
        contentType: "image/png",
        headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
      })
      return
    }
    await route.fulfill({
      body:
        url.pathname === "/manual-fixture"
          ? manualFixture()
          : providerFixture("chatgpt", nextProviderBehavior),
      contentType: "text/html",
    })
  })

  await browserContext.route(/^https:\/\/gemini\.google\.com(?:\/.*)?$/, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith("/fixture/") && url.pathname.endsWith(".png")) {
      await route.fulfill({
        body: fixtureImage,
        contentType: "image/png",
        headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
      })
      return
    }
    await route.fulfill({
      body: providerFixture("gemini", nextProviderBehavior),
      contentType: "text/html",
    })
  })

  await browserContext.route("https://assets.xiduoduo.top/admin/**", (route) =>
    route.fulfill({ body: panelFixture(), contentType: "text/html" }),
  )

  await browserContext.route("https://assets.xiduoduo.top/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api\/v1\/?/, "")
    const authorization = request.headers().authorization
    assert.equal(
      authorization,
      `Bearer ${connection.token}`,
      `unexpected authorization for ${path}`,
    )

    if (path === "extension-devices/heartbeat" && request.method() === "POST") {
      api.heartbeats += 1
      await jsonResponse(route, { ok: true, device_id: connection.deviceId })
      return
    }
    if (path === "extension-runs" && request.method() === "POST") {
      const run = createRun(request.postDataJSON())
      await jsonResponse(route, run, 201)
      return
    }

    const runMatch = path.match(/^extension-runs\/([^/]+)$/)
    if (runMatch && request.method() === "GET") {
      const run = api.runs.get(decodeURIComponent(runMatch[1]))
      assert.ok(run, `unknown run: ${runMatch[1]}`)
      await jsonResponse(route, run)
      return
    }

    const cancelMatch = path.match(/^extension-runs\/([^/]+)\/cancel$/)
    if (cancelMatch && request.method() === "POST") {
      const run = api.runs.get(decodeURIComponent(cancelMatch[1]))
      assert.ok(run, `unknown run: ${cancelMatch[1]}`)
      run.status = "cancelled"
      for (const item of run.items) {
        if (!["ready", "failed"].includes(item.status)) item.status = "cancelled"
      }
      api.cancellations.push(run.id)
      await jsonResponse(route, run)
      return
    }

    const itemMatch = path.match(/^extension-runs\/([^/]+)\/items\/([^/]+)$/)
    if (itemMatch && request.method() === "PATCH") {
      const run = api.runs.get(decodeURIComponent(itemMatch[1]))
      const item = run?.items.find((candidate) => candidate.id === decodeURIComponent(itemMatch[2]))
      assert.ok(run && item, `unknown item: ${path}`)
      const update = request.postDataJSON()
      Object.assign(item, update)
      api.itemUpdates.push({ runId: run.id, itemId: item.id, ...update })
      await jsonResponse(route, item)
      return
    }

    const uploadMatch = path.match(/^extension-runs\/([^/]+)\/items\/([^/]+)\/upload$/)
    if (uploadMatch && request.method() === "POST") {
      const run = api.runs.get(decodeURIComponent(uploadMatch[1]))
      const item = run?.items.find(
        (candidate) => candidate.id === decodeURIComponent(uploadMatch[2]),
      )
      assert.ok(run && item, `unknown upload item: ${path}`)
      const body = request.postDataBuffer()
      assert.ok(body && body.byteLength > fixtureImage.byteLength, "multipart upload body is empty")
      assert.match(request.headers()["content-type"] || "", /^multipart\/form-data;/)
      assert.ok(
        body.includes(Buffer.from('name="original"')),
        "multipart upload misses original file",
      )
      item.status = "processing"
      api.uploads.push({ runId: run.id, itemId: item.id, bytes: body.byteLength })
      setTimeout(() => {
        item.status = "ready"
        if (run.items.every((candidate) => candidate.status === "ready")) run.status = "completed"
      }, 250)
      await jsonResponse(route, { task_id: `task-${item.id}`, created: true }, 201)
      return
    }

    throw new Error(`Unhandled asset API route: ${request.method()} ${path}`)
  })
}

async function getServiceWorker(browserContext) {
  const current = browserContext
    .serviceWorkers()
    .find((worker) => worker.url().endsWith("service-worker.js"))
  return current ?? browserContext.waitForEvent("serviceworker", { timeout: 15_000 })
}

async function openExtensionPopup(worker, browserContext, tabId = null) {
  const extensionId = worker.url().split("/")[2]
  const popup = await browserContext.newPage()
  await popup.setViewportSize({ width: 420, height: 560 })
  const query = Number.isInteger(tabId) ? `?tab=${tabId}` : ""
  await popup.goto(`chrome-extension://${extensionId}/popup.html${query}`)
  await popup.locator(".popup-shell").waitFor({ state: "visible" })
  return popup
}

async function waitForDownloads(worker, previousIds, expectedCount) {
  const deadline = Date.now() + 15_000
  let lastDownloads = []
  while (Date.now() < deadline) {
    const downloads = await worker.evaluate(() =>
      chrome.downloads.search({ orderBy: ["-startTime"] }),
    )
    lastDownloads = downloads.filter((item) => !previousIds.has(item.id))
    const completed = downloads.filter(
      (item) => !previousIds.has(item.id) && item.state === "complete" && item.exists !== false,
    )
    if (completed.length >= expectedCount) return completed
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(
    `Timed out waiting for ${expectedCount} completed browser downloads: ${JSON.stringify(lastDownloads)}`,
  )
}

async function waitForRun(runId, predicate, timeout = 20_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const run = api.runs.get(runId)
    if (run && predicate(run)) return run
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(
    `Timed out waiting for run ${runId}: ${JSON.stringify({
      run: api.runs.get(runId),
      updates: api.itemUpdates.filter((item) => item.runId === runId),
      uploads: api.uploads.filter((item) => item.runId === runId),
    })}`,
  )
}

async function seriousAxeViolations(page) {
  const result = await new AxeBuilder({ page }).analyze()
  return result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact))
}

async function waitForPanelBridge(worker, tabId) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const ready = await worker.evaluate(async (id) => {
      try {
        const response = await chrome.tabs.sendMessage(id, { type: "QINGSHE_BRIDGE_PING" })
        return response?.ok === true
      } catch {
        return false
      }
    }, tabId)
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error("material panel content script did not become ready")
}

async function verifyManualFlow(worker, extensionId) {
  const providerPage = await context.newPage()
  await providerPage.goto("https://chatgpt.com/manual-fixture")
  await providerPage.locator("img").last().waitFor({ state: "visible" })
  await providerPage.bringToFront()
  const providerTabs = await worker.evaluate(() =>
    chrome.tabs.query({ url: "https://chatgpt.com/manual-fixture" }),
  )
  const providerTabId = providerTabs[0]?.id
  assert.equal(typeof providerTabId, "number")

  const popup = await openExtensionPopup(worker, context, providerTabId)
  await popup.locator("#tab-manual").click()
  await popup.locator("#count").filter({ hasText: "2 张图片 · 已选 2 张" }).waitFor()
  const requestedNames = await popup.locator(".image-item span").allTextContents()
  assert.equal(
    requestedNames.every((name) => name.endsWith(".png")),
    true,
  )
  assert.equal(await popup.locator(".image-item").count(), 2)
  assert.equal(await popup.locator("#manual-panel").isVisible(), true)
  assert.equal(await popup.locator("#auto-panel").isVisible(), false)

  await popup.locator("#tab-manual").press("ArrowLeft")
  assert.equal(await popup.locator("#tab-auto").getAttribute("aria-selected"), "true")
  await popup.locator("#tab-auto").press("ArrowRight")
  assert.equal(await popup.locator("#tab-manual").getAttribute("aria-selected"), "true")
  await popup.locator("#count").filter({ hasText: "2 张图片 · 已选 2 张" }).waitFor()

  const axe = await seriousAxeViolations(popup)
  assert.deepEqual(
    axe,
    [],
    `popup accessibility violations: ${axe.map((item) => item.id).join(", ")}`,
  )
  const manualScreenshot = join(auditDirectory, "15-extension-mv3-manual.png")
  await popup.screenshot({ path: manualScreenshot })

  const before = await worker.evaluate(() => chrome.downloads.search({}))
  const previousIds = new Set(before.map((item) => item.id))
  await popup.locator("#download").click()
  await popup.locator("#status").filter({ hasText: "已提交 2 张图片下载" }).waitFor()
  const downloads = await waitForDownloads(worker, previousIds, 2)
  assert.equal(
    downloads.every(
      (item) =>
        item.byExtensionId === extensionId &&
        item.danger === "safe" &&
        item.fileSize === fixtureImage.byteLength,
    ),
    true,
  )

  const zipPromise = popup.waitForEvent("download")
  await popup.locator("#zip").click()
  const zipDownload = await zipPromise
  const zipPath = await zipDownload.path()
  assert.ok(zipPath, "Playwright did not retain the ZIP download")
  const zipEntries = Object.keys(unzipSync(new Uint8Array(await readFile(zipPath))))
  assert.equal(zipEntries.length, 2)
  assert.equal(new Set(zipEntries).size, 2)

  const panel = await context.newPage()
  await panel.goto("https://assets.xiduoduo.top/admin/asset-admin.html?extension_bridge=1")
  const panelTabs = await worker.evaluate(() =>
    chrome.tabs.query({ url: "https://assets.xiduoduo.top/admin/*" }),
  )
  const panelTabId = panelTabs[0]?.id
  assert.equal(typeof panelTabId, "number")
  await waitForPanelBridge(worker, panelTabId)
  await popup.locator("#send").click()
  await popup.locator("#status").filter({ hasText: "已发送 2 张" }).waitFor({ timeout: 20_000 })
  await panel.waitForFunction(() => window.__qingsheReceivedFiles?.length === 2, null, {
    timeout: 20_000,
  })
  const bridgedFiles = await panel.evaluate(() => window.__qingsheReceivedFiles)
  assert.equal(bridgedFiles.length, 2)
  assert.equal(
    bridgedFiles.every((file) => /^data:image\/png(?:;[^,]+)?;base64,/.test(file.dataUrl)),
    true,
  )
  assert.equal(
    bridgedFiles.every((file) => file.dataUrl.length > 1_000),
    true,
  )

  await panel.close()
  await providerPage.close()
  return {
    axeSeriousOrCritical: axe.length,
    bridgedFiles: bridgedFiles.map((file) => ({ name: file.name, bytes: file.dataUrl.length })),
    browserDownloads: downloads
      .slice(0, 2)
      .map((item) => ({ bytes: item.fileSize, state: item.state })),
    requestedNames,
    screenshot: manualScreenshot,
    zipEntries,
  }
}

async function pairExtension(worker) {
  await worker.evaluate(async (value) => {
    await chrome.storage.local.set({
      qingsheExtensionConnection: value,
      qingsheAutomationState: null,
    })
  }, connection)
}

async function startAutomaticRun(worker, provider, behavior) {
  nextProviderBehavior = behavior
  const beforeRunIds = new Set(api.runs.keys())
  const popup = await openExtensionPopup(worker, context)
  await popup
    .locator("#connection-state")
    .filter({ hasText: "服务器已连接" })
    .waitFor({ timeout: 10_000 })
  await popup.locator("#auto-provider").selectOption(provider)
  await popup.locator("#auto-count").fill("1")
  await popup.locator("#auto-prompt").fill(`${provider} 生成一张透明背景婚礼花艺素材`)
  const providerPagePromise = context.waitForEvent("page", {
    predicate: (page) =>
      page
        .url()
        .startsWith(provider === "chatgpt" ? "https://chatgpt.com/" : "https://gemini.google.com/"),
    timeout: 15_000,
  })
  await popup.locator("#auto-start").click()
  const providerPage = await providerPagePromise
  const providerUrl =
    provider === "chatgpt" ? "https://chatgpt.com/" : "https://gemini.google.com/app"
  await providerPage.goto(providerUrl)
  try {
    await providerPage.waitForFunction(() => window.__qingshePrompts?.length === 1, null, {
      timeout: 20_000,
    })
  } catch (error) {
    const diagnostics = {
      apiUpdates: api.itemUpdates.slice(-3),
      composer: await providerPage
        .locator('[contenteditable="true"]')
        .evaluate((element) => element.textContent)
        .catch(() => null),
      popupStatus: await popup
        .locator("#status")
        .textContent()
        .catch(() => null),
      providerBody: await providerPage
        .locator("body")
        .innerText()
        .catch(() => null),
      providerUrl: providerPage.url(),
      storage: await worker
        .evaluate(() =>
          chrome.storage.local.get(["qingsheAutomationState", "qingsheExtensionConnection"]),
        )
        .catch(() => null),
    }
    throw new Error(`provider prompt was not submitted: ${JSON.stringify(diagnostics)}`, {
      cause: error,
    })
  }
  const run = [...api.runs.values()].find((candidate) => !beforeRunIds.has(candidate.id))
  assert.ok(run, `${provider} did not create an extension run`)
  return { providerPage, run }
}

async function verifyAutomaticProvider(worker, provider) {
  const uploadStart = api.uploads.length
  const { providerPage, run } = await startAutomaticRun(worker, provider, {
    mode: "generate",
    delayMs: 120,
  })
  try {
    await waitForRun(run.id, (current) => current.status === "completed")
  } catch (error) {
    const stored = await worker.evaluate(() => chrome.storage.local.get("qingsheAutomationState"))
    const current = stored.qingsheAutomationState
    const active =
      typeof current?.tabId === "number"
        ? await worker
            .evaluate(
              async ({ itemId, runId, tabId }) => {
                try {
                  return await chrome.tabs.sendMessage(tabId, {
                    type: "QINGSHE_AUTOMATION_QUERY_ITEM",
                    runId,
                    itemId,
                  })
                } catch (messageError) {
                  return { error: String(messageError) }
                }
              },
              { itemId: run.items[0].id, runId: run.id, tabId: current.tabId },
            )
            .catch(() => null)
        : null
    const images = await providerPage.locator("img").evaluateAll((elements) =>
      elements.map((image) => ({
        complete: image.complete,
        height: image.height,
        naturalHeight: image.naturalHeight,
        naturalWidth: image.naturalWidth,
        source: image.currentSrc,
        width: image.width,
      })),
    )
    throw new Error(
      `automatic provider did not upload: ${JSON.stringify({ active, images, stored })}`,
      { cause: error },
    )
  }
  assert.equal(api.uploads.filter((upload) => upload.runId === run.id).length, 1)
  assert.equal(
    api.itemUpdates.some((update) => update.runId === run.id && update.status === "generating"),
    true,
  )
  assert.equal(api.uploads.length, uploadStart + 1)
  assert.equal(await providerPage.evaluate(() => window.__qingshePrompts.length), 1)

  const statusPopup = await openExtensionPopup(worker, context)
  await statusPopup
    .locator("#auto-progress-count")
    .filter({ hasText: "1 / 1" })
    .waitFor({ timeout: 10_000 })
  await statusPopup.locator("#auto-progress-detail").filter({ hasText: "全部完成" }).waitFor()
  const axe = await seriousAxeViolations(statusPopup)
  assert.deepEqual(
    axe,
    [],
    `${provider} popup accessibility violations: ${axe.map((item) => item.id).join(", ")}`,
  )
  let screenshot = null
  if (provider === "gemini") {
    screenshot = join(auditDirectory, "16-extension-mv3-auto-complete.png")
    await statusPopup.screenshot({ path: screenshot })
  }
  await statusPopup.close()
  await providerPage.close()
  return {
    axeSeriousOrCritical: axe.length,
    promptSubmissions: 1,
    runId: run.id,
    screenshot,
    uploads: 1,
  }
}

async function terminateServiceWorker(page, extensionId) {
  const cdp = await context.newCDPSession(page)
  try {
    const { targetInfos } = await cdp.send("Target.getTargets")
    const target = targetInfos.find(
      (candidate) =>
        candidate.type === "service_worker" &&
        candidate.url.startsWith(`chrome-extension://${extensionId}/`),
    )
    assert.ok(target, "could not locate the MV3 service worker target")
    const result = await cdp.send("Target.closeTarget", { targetId: target.targetId })
    assert.equal(result.success, true)
  } finally {
    await cdp.detach()
  }
}

async function verifyServiceWorkerRestart(worker, extensionId) {
  const { providerPage, run } = await startAutomaticRun(worker, "chatgpt", {
    mode: "generate",
    delayMs: 3_000,
  })
  await terminateServiceWorker(providerPage, extensionId)
  await waitForRun(run.id, (current) => current.status === "completed", 20_000)
  const prompts = await providerPage.evaluate(() => window.__qingshePrompts.length)
  const uploads = api.uploads.filter((upload) => upload.runId === run.id)
  assert.equal(prompts, 1, "service worker restart caused a duplicate provider prompt")
  assert.equal(uploads.length, 1, "service worker restart caused a duplicate upload")
  const restartedWorker = await getServiceWorker(context)
  const stored = await restartedWorker.evaluate(() =>
    chrome.storage.local.get("qingsheAutomationState"),
  )
  assert.equal(stored.qingsheAutomationState.id, run.id)
  await providerPage.close()
  return { promptSubmissions: prompts, runId: run.id, uploads: uploads.length }
}

async function verifyCancellation(worker) {
  const uploadStart = api.uploads.length
  const { providerPage, run } = await startAutomaticRun(worker, "chatgpt", {
    mode: "stall",
    delayMs: 0,
  })
  const popup = await openExtensionPopup(worker, context)
  await popup.locator("#auto-cancel").waitFor({ state: "visible" })
  await popup.locator("#auto-cancel").click()
  await popup.locator("#status").filter({ hasText: "任务已取消" }).waitFor({ timeout: 10_000 })
  await waitForRun(run.id, (current) => current.status === "cancelled")
  await new Promise((resolve) => setTimeout(resolve, 750))
  assert.equal(api.cancellations.includes(run.id), true)
  assert.equal(api.uploads.length, uploadStart)
  const stored = await worker.evaluate(() => chrome.storage.local.get("qingsheAutomationState"))
  assert.equal(stored.qingsheAutomationState.status, "cancelled")
  await popup.close()
  await providerPage.close()
  return { cancelApiCalls: 1, runId: run.id, uploadsAfterCancel: 0 }
}

async function main() {
  await mkdir(auditDirectory, { recursive: true })
  context = await chromium.launchPersistentContext(userDataDirectory, {
    acceptDownloads: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    channel: "chromium",
    colorScheme: "dark",
    headless: true,
    locale: "zh-CN",
    serviceWorkers: "allow",
    viewport: { width: 1280, height: 800 },
  })
  await installRoutes(context)
  for (const page of context.pages()) await page.close()
  let worker = await getServiceWorker(context)
  const extensionId = worker.url().split("/")[2]
  assert.match(extensionId, /^[a-p]{32}$/)
  assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().manifest_version), 3)

  const manual = await verifyManualFlow(worker, extensionId)
  await pairExtension(worker)
  const chatgpt = await verifyAutomaticProvider(worker, "chatgpt")
  const gemini = await verifyAutomaticProvider(worker, "gemini")
  const serviceWorkerRestart = await verifyServiceWorkerRestart(worker, extensionId)
  worker = await getServiceWorker(context)
  const cancellation = await verifyCancellation(worker)

  const summary = {
    status: "passed",
    browser: "Playwright bundled Chromium",
    extensionId,
    manifestVersion: 3,
    serviceWorkerUrl: worker.url(),
    manual,
    automatic: { chatgpt, gemini },
    serviceWorkerRestart,
    cancellation,
    api: {
      cancellations: api.cancellations.length,
      heartbeats: api.heartbeats,
      itemUpdates: api.itemUpdates.length,
      runs: api.runs.size,
      uploads: api.uploads.length,
    },
  }
  const evidencePath = join(auditDirectory, "extension-e2e.json")
  await writeFile(evidencePath, `${JSON.stringify(summary, null, 2)}\n`)
  await execFileAsync(
    process.execPath,
    [resolve("node_modules/@biomejs/biome/bin/biome"), "format", "--write", evidencePath],
    { cwd: resolve(".") },
  )
  console.log(JSON.stringify(summary))
}

try {
  await main()
} finally {
  await context?.close().catch(() => undefined)
  const resolvedTemporaryDirectory = resolve(userDataDirectory)
  assert.ok(
    resolvedTemporaryDirectory.startsWith(`${resolve(tmpdir())}\\`) &&
      basename(resolvedTemporaryDirectory).startsWith("qingshe-extension-e2e-"),
    `refusing to remove unexpected directory: ${resolvedTemporaryDirectory}`,
  )
  await rm(resolvedTemporaryDirectory, { recursive: true, force: true })
}
