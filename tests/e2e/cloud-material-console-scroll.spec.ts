import { expect, test } from "@playwright/test"

test("keeps the cloud material console scrollable when its content exceeds the viewport", async ({
  page,
}) => {
  await page.route("**/admin/processing-dashboard", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(dashboard()) })
  })
  await page.route("**/admin/observability/summary", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(observability()) })
  })

  await page.goto("/asset-admin.html")
  await expect(page.getByRole("heading", { name: "把素材放进云库" })).toBeVisible()

  const scrollState = await page.locator(".material-panel").evaluate((element) => {
    const console = element as HTMLElement
    console.scrollTop = 240
    return {
      clientHeight: console.clientHeight,
      scrollHeight: console.scrollHeight,
      scrollTop: console.scrollTop,
    }
  })

  expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight)
  expect(scrollState.scrollTop).toBeGreaterThan(0)
})

test("fits a narrow phone without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.route("**/admin/processing-dashboard", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(dashboard()) })
  })
  await page.route("**/admin/observability/summary", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(observability()) })
  })

  await page.goto("/asset-admin.html")
  await expect(page.getByRole("heading", { name: "把素材放进云库" })).toBeVisible()

  const layout = await page.locator(".material-panel").evaluate((element) => {
    const console = element as HTMLElement
    return {
      clientWidth: console.clientWidth,
      scrollWidth: console.scrollWidth,
      clientHeight: console.clientHeight,
      scrollHeight: console.scrollHeight,
    }
  })

  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)
  expect(layout.scrollHeight).toBeGreaterThan(layout.clientHeight)
})

test("presents the material workflow in a clear action-first order", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await page.route("**/admin/processing-dashboard", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(dashboard()) })
  })
  await page.route("**/admin/observability/summary", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(observability()) })
  })

  await page.goto("/asset-admin.html")

  await expect(page.locator(".material-panel__section-header h2")).toHaveText([
    "把素材放进云库",
    "此电脑轻抠",
    "待检查",
    "处理队列",
    "配套工具",
  ])
  await expect(page.locator(".material-panel__summary article")).toHaveCount(4)

  const sectionStyle = await page
    .locator(".material-panel__section")
    .first()
    .evaluate((element) => {
      const style = window.getComputedStyle(element)
      return { borderRadius: style.borderRadius, boxShadow: style.boxShadow }
    })
  expect(sectionStyle.borderRadius).toBe("4px")
  expect(sectionStyle.boxShadow).toBe("none")
})

test("stages extension images and creates processing tasks only after confirmation", async ({
  page,
}) => {
  let taskRequests = 0
  await page.route("**/admin/processing-dashboard", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(dashboard()) })
  })
  await page.route("**/admin/observability/summary", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(observability()) })
  })
  await page.route("**/admin/processing-tasks", async (route) => {
    taskRequests += 1
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: `00000000-0000-4000-8000-${String(taskRequests).padStart(12, "0")}`,
      }),
    })
  })

  await page.goto("/asset-admin.html")
  await expect(page.getByRole("heading", { name: "把素材放进云库" })).toBeVisible()
  const pixel =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nzsAAAAASUVORK5CYII="
  await page.evaluate(
    ({ dataUrl }) => {
      for (const name of ["car-a.png", "car-b.png"]) {
        window.postMessage(
          {
            source: "qingshe-extension",
            type: "qingshe-extension-upload",
            file: { name, type: "image/png", dataUrl },
          },
          window.location.origin,
        )
      }
    },
    { dataUrl: pixel },
  )

  await expect(page.getByRole("heading", { name: "插件待上传 · 2 张" })).toBeVisible()
  await expect(page.getByText("car-a.png", { exact: true })).toBeVisible()
  await expect(page.getByText("car-b.png", { exact: true })).toBeVisible()
  expect(taskRequests).toBe(0)

  await page.getByRole("button", { name: "确认上传并抠图" }).click()

  await expect.poll(() => taskRequests).toBe(2)
  await expect(page.getByRole("heading", { name: "插件待上传 · 2 张" })).toBeHidden()
  await expect(page.getByText("已创建 2 / 2 个入库任务。", { exact: true })).toBeVisible()
})

test("shows the browser extension and full-auto run progress", async ({ page }) => {
  await page.route("**/admin/processing-dashboard", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(dashboard()) })
  })
  await page.route("**/admin/observability/summary", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(observability()) })
  })

  await page.goto("/asset-admin.html")

  await expect(page.getByRole("heading", { name: "浏览器插件" })).toBeVisible()
  await expect(page.getByText("Chrome on Mac", { exact: true })).toBeVisible()
  await expect(page.getByText("婚庆素材", { exact: true })).toBeVisible()
  await expect(page.getByText("4 / 10", { exact: true })).toBeVisible()
})

test("distinguishes this computer from every other processor", async ({ page }) => {
  const thisPanel = "33333333-3333-4333-8333-333333333333"
  await page.addInitScript((clientId) => {
    window.localStorage.setItem("qingshe.processor.panel-client.v1", clientId)
  }, thisPanel)
  await page.route("**/admin/processing-dashboard", async (route) => {
    const payload = dashboard()
    const baseNode = payload.nodes[0]
    if (baseNode === undefined) throw new Error("dashboard fixture requires one processor")
    payload.nodes = [
      {
        ...baseNode,
        name: "前台 Mac",
        client_id: thisPanel,
      },
      {
        ...baseNode,
        id: "00000000-0000-4000-8000-000000000006",
        name: "设计室 Windows",
        platform: "windows",
        client_id: "44444444-4444-4444-8444-444444444444",
      },
    ]
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) })
  })
  await page.route("**/admin/observability/summary", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(observability()) })
  })

  await page.goto("/asset-admin.html")

  const localProcessor = page.locator(".material-panel__local-processor")
  const processors = page.locator(".material-panel__processors")
  await expect(localProcessor.getByRole("heading", { name: "此电脑轻抠" })).toBeVisible()
  await expect(localProcessor.getByText("已连接", { exact: true })).toBeVisible()
  await expect(processors.getByText("前台 Mac", { exact: true })).toBeVisible()
  await expect(processors.getByText("设计室 Windows", { exact: true })).toBeVisible()
  await expect(processors.getByText("其他电脑 · Windows", { exact: true })).toBeVisible()
  await expect(localProcessor.getByRole("button", { name: "打开轻抠" })).toBeVisible()
})

test("does not mistake another computer's processor for this computer", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "qingshe.processor.panel-client.v1",
      "33333333-3333-4333-8333-333333333333",
    )
  })
  await page.route("**/admin/processing-dashboard", async (route) => {
    const payload = dashboard()
    const node = payload.nodes[0]
    if (node === undefined) throw new Error("dashboard fixture requires one processor")
    node.client_id = "44444444-4444-4444-8444-444444444444"
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) })
  })
  await page.route("**/admin/observability/summary", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(observability()) })
  })

  await page.goto("/asset-admin.html")

  const localProcessor = page.locator(".material-panel__local-processor")
  const processors = page.locator(".material-panel__processors")
  await expect(localProcessor.getByText("未连接", { exact: true })).toBeVisible()
  await expect(
    localProcessor.getByText("其他电脑在线，此电脑尚未关联", { exact: true }),
  ).toBeVisible()
  await expect(processors.getByText("其他电脑 · macOS", { exact: true })).toBeVisible()
  await expect(localProcessor.getByRole("button", { name: "检测并启动" })).toBeVisible()
})

test("pairs the browser extension only after explicit confirmation", async ({ page }) => {
  let pairRequests = 0
  let pairedMessage: unknown
  await page.exposeFunction("captureExtensionPair", (message: unknown) => {
    const candidate = message as { type?: string }
    if (candidate.type === "qingshe-extension-pair") pairedMessage = message
  })
  await page.addInitScript(() => {
    window.addEventListener("message", (event) => {
      const target = window as Window & {
        captureExtensionPair?: (message: unknown) => Promise<void>
      }
      void target.captureExtensionPair?.(event.data)
    })
  })
  await page.route("**/admin/processing-dashboard", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(dashboard()) })
  })
  await page.route("**/admin/observability/summary", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(observability()) })
  })
  await page.route("**/admin/extension-devices/pair", async (route) => {
    pairRequests += 1
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "55555555-5555-4555-8555-555555555555",
        token: "scoped-extension-token-123456",
      }),
    })
  })
  await page.goto("/asset-admin.html?extension_pair=1")

  await expect(page.getByRole("heading", { name: "连接浏览器插件" })).toBeVisible()
  expect(pairRequests).toBe(0)
  await page.getByRole("button", { name: "确认连接浏览器插件" }).click()

  await expect.poll(() => pairRequests).toBe(1)
  await expect(
    page.getByText("浏览器插件已连接，可以回到插件开始全自动任务。", { exact: true }),
  ).toBeVisible()
  await expect.poll(() => pairedMessage).toBeTruthy()
  expect(pairedMessage).toMatchObject({
    source: "qingshe-panel",
    type: "qingshe-extension-pair",
    connection: {
      baseUrl: "https://assets.xiduoduo.top/api/v1",
      token: "scoped-extension-token-123456",
      deviceId: "55555555-5555-4555-8555-555555555555",
    },
  })
})

function dashboard() {
  const nodeId = "00000000-0000-4000-8000-000000000001"
  return {
    nodes: [
      {
        id: nodeId,
        name: "这台 Mac",
        platform: "macos",
        status: "online",
        client_id: null as string | null,
        last_seen: "2026-07-13T06:00:00Z",
        created_at: "2026-07-13T05:00:00Z",
      },
    ],
    tasks: [
      {
        id: "00000000-0000-4000-8000-000000000002",
        name: "花艺素材",
        category: "花艺",
        needs_review: false,
        status: "ready",
        node_id: nodeId,
        asset_id: "00000000-0000-4000-8000-000000000003",
        error: null,
        created_at: "2026-07-13T05:00:00Z",
        updated_at: "2026-07-13T06:00:00Z",
      },
    ],
    extension_devices: [
      {
        id: "00000000-0000-4000-8000-000000000004",
        name: "Chrome on Mac",
        platform: "chrome",
        status: "online",
        last_seen: "2026-07-15T04:00:00Z",
        created_at: "2026-07-15T03:00:00Z",
      },
    ],
    automation_runs: [
      {
        id: "00000000-0000-4000-8000-000000000005",
        device_id: "00000000-0000-4000-8000-000000000004",
        provider: "chatgpt",
        prompt: "婚庆素材",
        count: 10,
        category: "婚庆",
        status: "running",
        error: null,
        created_at: "2026-07-15T04:00:00Z",
        updated_at: "2026-07-15T04:01:00Z",
        total: 10,
        ready: 4,
        failed: 0,
        items: [],
      },
    ],
  }
}

function observability() {
  return {
    status: "ready",
    generated_at: "2026-07-13T06:00:00Z",
    uptime_seconds: 3600,
    host: {
      cpu: { count: 1, load_1m: 0.2, load_5m: 0.1, load_15m: 0.1, estimated_usage_percent: 20 },
      memory: { total_bytes: 1024, used_bytes: 635, available_bytes: 389, used_percent: 62 },
      disk: { total_bytes: 4096, used_bytes: 1024, available_bytes: 3072, used_percent: 25 },
      uptime_seconds: 3600,
    },
    library: { total: 8, ready: 6, review: 1, deleted: 1, processing: 0, failed: 0, bytes: 2048 },
    clients: { active_5m: 3, seen_24h: 5 },
    requests: { last_24h: 100, failures_24h: 2, average_duration_ms: 14.2 },
    transfers: { active_downloads: 2, downloads_24h: 30, download_bytes_24h: 3072 },
    controls: {
      maintenance_mode: false,
      downloads_enabled: true,
      max_concurrent_downloads: 8,
      active_downloads: 2,
    },
    alerts: [],
  }
}
