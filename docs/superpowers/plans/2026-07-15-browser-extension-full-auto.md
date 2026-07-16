# Browser Extension Full Auto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one WebExtension codebase that continuously detects new generated images and runs durable ChatGPT/Gemini generation-to-upload jobs in Chrome-like browsers and Firefox.

**Architecture:** Provider adapters operate only on page DOM, while a persistent run record in extension storage is orchestrated by the background context. Content-script image events wake the background context, which uploads through a scoped server token and advances one item at a time.

**Tech Stack:** Manifest V3 WebExtensions, vanilla ES modules, MutationObserver, Chrome/Firefox APIs, Vitest, Playwright/web-ext.

## Global Constraints

- Do not store admin credentials or server secrets in the extension bundle.
- Manual send keeps the existing stage-then-confirm behavior.
- Full-auto starts only from an explicit user click.
- ChatGPT and Gemini are the only automatic provider adapters in this release.
- Work in the existing dirty checkout without commits or broad cleanup.

---

### Task 1: Cross-browser build artifacts

**Files:**
- Modify: `browser-extension/manifest.json`
- Modify: `scripts/build-browser-extension.mjs`
- Modify: `browser-extension/README.md`
- Test: `tests/browser-extension-scan.test.ts`

**Interfaces:**
- Produces: `browser-extension/dist/chrome`, `browser-extension/dist/firefox`, Chrome ZIP, and Firefox XPI source package.

- [ ] **Step 1: Write a failing manifest/build test**

```ts
expect(manifest.background).toMatchObject({
  service_worker: "service-worker.js",
  scripts: ["service-worker.js"],
})
expect(firefoxManifest.browser_specific_settings.gecko.id).toBe("qingshe-images@xiduoduo.top")
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test tests/browser-extension-scan.test.ts`
Expected: FAIL because `background.scripts` and Firefox metadata are absent.

- [ ] **Step 3: Implement dual manifests and packaging**

The base manifest uses a classic-compatible background entry and both background keys. The build script copies shared files to both outputs, adds Firefox Gecko metadata only to the Firefox manifest, and creates deterministic archives with `fflate` or the system ZIP command invoked from Node.

- [ ] **Step 4: Verify builds**

Run: `pnpm extension:build`
Expected: both unpacked directories and both archives are printed.

### Task 2: Continuous new-image discovery

**Files:**
- Modify: `browser-extension/src/content-script.js`
- Modify: `browser-extension/src/service-worker.js`
- Test: `tests/browser-extension-scan.test.ts`

**Interfaces:**
- Produces: runtime message `QINGSHE_IMAGES_DISCOVERED` with `{tabUrl, images}` and `QINGSHE_GET_DISCOVERY_STATE`.

- [ ] **Step 1: Write a failing observer test**

```ts
document.body.append(generatedImage("https://example.test/generated.png"))
await vi.advanceTimersByTimeAsync(350)
expect(sendMessage).toHaveBeenCalledWith(
  expect.objectContaining({ type: "QINGSHE_IMAGES_DISCOVERED" }),
)
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test tests/browser-extension-scan.test.ts -t 'reports newly generated images without opening the popup'`
Expected: FAIL because the observer callback is empty.

- [ ] **Step 3: Implement debounced discovery and dedupe**

Use a 300 ms debounce, wait for `img.complete`, compare stable source keys, send only newly discovered summaries, cap stored summaries at 120 per tab, and set the action badge to the unseen count.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm test tests/browser-extension-scan.test.ts`
Expected: PASS.

### Task 3: Server pairing and durable run state

**Files:**
- Create: `browser-extension/src/server-client.js`
- Create: `browser-extension/src/automation-state.js`
- Modify: `browser-extension/src/service-worker.js`
- Modify: `browser-extension/src/content-script.js`
- Test: `tests/browser-extension-automation.test.ts`

**Interfaces:**
- Produces: `pairExtension()`, `startAutomation(config)`, `resumeAutomation()`, `cancelAutomation()`, and stored key `qingsheAutomationState`.

- [ ] **Step 1: Write failing state-transition tests**

```ts
expect(nextAutomationState(run, { type: "IMAGE_UPLOADED", itemId: "i1" })).toMatchObject({
  currentOrdinal: 2,
  status: "running",
})
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test tests/browser-extension-automation.test.ts`
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement scoped pairing bridge**

`QINGSHE_PAIR_EXTENSION` opens `asset-admin.html?extension_pair=1`; the panel content script receives `qingshe-extension-pair`, forwards it to the background context, and the background context stores `{baseUrl, token, deviceId}`.

- [ ] **Step 4: Implement persisted state and 30-second alarm heartbeat**

```js
chrome.alarms.create("qingshe-heartbeat", { periodInMinutes: 0.5 })
```

Listeners are registered at top level; startup/install/alarms read storage rather than relying on worker globals.

- [ ] **Step 5: Run focused tests**

Run: `pnpm test tests/browser-extension-automation.test.ts`
Expected: PASS.

### Task 4: ChatGPT/Gemini page adapters and sequential automation

**Files:**
- Create: `browser-extension/src/provider-adapters.js`
- Modify: `browser-extension/src/content-script.js`
- Modify: `browser-extension/src/service-worker.js`
- Test: `tests/browser-extension-automation.test.ts`

**Interfaces:**
- Produces: `providerForLocation()`, `waitForComposer()`, `submitPrompt()`, and `waitForGeneratedImage()`.

- [ ] **Step 1: Write failing adapter DOM tests**

```ts
document.body.innerHTML = '<div id="prompt-textarea" contenteditable="true"></div><button data-testid="send-button"></button>'
await submitPrompt(chatGptAdapter, "婚庆素材，生成 1 张")
expect(document.querySelector("#prompt-textarea")?.textContent).toContain("婚庆素材")
expect(sendClick).toHaveBeenCalledOnce()
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test tests/browser-extension-automation.test.ts -t provider`
Expected: FAIL because adapters are missing.

- [ ] **Step 3: Implement resilient selector lists and input events**

ChatGPT selectors include `#prompt-textarea`, `[contenteditable="true"][data-lexical-editor="true"]`, and `[data-testid="send-button"]`. Gemini selectors include `.ql-editor[contenteditable="true"]`, `[contenteditable="true"][role="textbox"]`, and localized send-button aria labels. Every wait has a deadline and returns a Chinese error string.

- [ ] **Step 4: Implement per-item baseline and image stability**

Before submitting, snapshot useful image keys. Resolve the first new complete image whose source remains unchanged for 2 seconds, convert blob sources to data URLs, and send `QINGSHE_AUTOMATION_IMAGE` with run/item ids.

- [ ] **Step 5: Implement sequential advancement and retry cap**

Each upload advances to the next ordinal in the same tab. A page/input/generation failure is retried twice, then the item/run is visibly failed and can be continued from the popup.

- [ ] **Step 6: Run focused tests**

Run: `pnpm test tests/browser-extension-automation.test.ts tests/browser-extension-scan.test.ts`
Expected: PASS.

### Task 5: Full-auto popup UI and real browser acceptance

**Files:**
- Modify: `browser-extension/popup.html`
- Modify: `browser-extension/popup.css`
- Modify: `browser-extension/popup.js`
- Modify: `browser-extension/preview.html`
- Modify: `browser-extension/preview.css`
- Test: `tests/e2e/cloud-material-console-scroll.spec.ts`

**Interfaces:**
- Consumes: automation runtime messages and server pairing state.

- [ ] **Step 1: Add a failing popup structure assertion**

```ts
expect(popupHtml).toContain('id="auto-prompt"')
expect(popupHtml).toContain('id="auto-count"')
expect(popupHtml).toContain('id="auto-start"')
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test tests/browser-extension-automation.test.ts -t popup`
Expected: FAIL.

- [ ] **Step 3: Implement the two-mode UI**

Add visible tabs `全自动` and `当前页面`, provider/prompt/count/category controls, connection state, progress `ready / total`, current item, pause/cancel/retry actions, and keep existing manual selection/download/send actions.

- [ ] **Step 4: Apply DESIGN.md tokens**

Use 4px radii, 1px borders, no shadows/gradients, 14px body text, and `#4D8DFF` only for the primary/focus state.

- [ ] **Step 5: Build and load both browsers**

Run: `pnpm extension:build`
Expected: Chrome and Firefox artifacts build.

Run: `web-ext lint --source-dir browser-extension/dist/firefox`
Expected: no manifest errors.

Visible acceptance: load Chrome unpacked output and run Firefox through `web-ext run`; verify popup, badge, and a fixture-driven automatic one-item flow before using live providers.
