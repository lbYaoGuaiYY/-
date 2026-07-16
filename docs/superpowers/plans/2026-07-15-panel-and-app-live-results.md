# Panel and App Live Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show extension/processor/run state in the material panel and make completed cloud assets appear in the open editor without focus changes or restart.

**Architecture:** The existing processing dashboard schema is extended with extension devices and automation run summaries. The editor performs conditional catalog-revision checks every five seconds only while visible, so full catalog reloads happen only after a real revision change.

**Tech Stack:** React 19, TypeScript, ky, zod, Vitest, Testing Library, Playwright.

## Global Constraints

- Preserve manual extension staging and explicit confirmation.
- Do not create processing tasks from manual bridge messages until confirmation.
- Use `DESIGN.md` borders-only visual rules.
- Work in the existing dirty checkout without commits or broad cleanup.

---

### Task 1: Extension pairing and automation dashboard client

**Files:**
- Modify: `src/features/asset-admin/remote-processing-client.ts`
- Test: `tests/remote-processing-client.test.ts`

**Interfaces:**
- Produces: dashboard types `extension_devices` and `automation_runs`, `pairRemoteExtensionDevice()`, and `completeExtensionPairing()`.

- [ ] **Step 1: Write failing schema and payload tests**

```ts
expect(parseRemoteProcessingDashboard(payload).automation_runs[0]).toMatchObject({
  prompt: "婚庆素材",
  total: 10,
  ready: 4,
})
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test tests/remote-processing-client.test.ts`
Expected: FAIL because the schema strips or rejects the new keys.

- [ ] **Step 3: Implement exact zod schemas and pairing call**

`pairRemoteExtensionDevice(name, platform)` posts to `admin/extension-devices/pair`; `completeExtensionPairing()` posts the scoped token into the same-origin page bridge with source `qingshe-panel` and type `qingshe-extension-pair`.

- [ ] **Step 4: Run focused tests**

Run: `pnpm test tests/remote-processing-client.test.ts`
Expected: PASS.

### Task 2: Material panel status and run progress

**Files:**
- Modify: `src/features/asset-admin/RemoteAssetAdminApp.tsx`
- Modify: `src/styles/asset-admin.css`
- Test: `tests/e2e/cloud-material-console-scroll.spec.ts`

**Interfaces:**
- Consumes: extended dashboard and extension-pair query.

- [ ] **Step 1: Write a failing Playwright dashboard test**

```ts
await expect(page.getByText("浏览器插件")).toBeVisible()
await expect(page.getByText("婚庆素材")).toBeVisible()
await expect(page.getByText("4 / 10")).toBeVisible()
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test:e2e tests/e2e/cloud-material-console-scroll.spec.ts`
Expected: FAIL because those dashboard rows do not exist.

- [ ] **Step 3: Implement pairing and device/run sections**

When `extension_pair=1` is present and the admin is signed in, show one explicit `确认连接浏览器插件` action. Dashboard sections display online/offline text, provider, prompt, `ready / total`, failed count, and current status.

- [ ] **Step 4: Preserve manual gate regression**

Run: `pnpm test:e2e tests/e2e/cloud-material-console-scroll.spec.ts -g '插件图片'`
Expected: no `/admin/processing-tasks` request before the existing confirm button.

- [ ] **Step 5: Run the full focused spec**

Run: `pnpm test:e2e tests/e2e/cloud-material-console-scroll.spec.ts`
Expected: PASS.

### Task 3: Visible editor catalog polling

**Files:**
- Create: `src/features/assets/catalog-refresh-scheduler.ts`
- Modify: `src/features/assets/use-managed-assets.ts`
- Test: `tests/asset-service-events.test.ts`
- Test: `tests/e2e/asset-panel.spec.ts`

**Interfaces:**
- Produces: `startVisibleCatalogPolling(check, intervalMs = 5000): () => void`.

- [ ] **Step 1: Write a failing scheduler test with fake timers**

```ts
const stop = startVisibleCatalogPolling(check, 5_000)
await vi.advanceTimersByTimeAsync(10_000)
expect(check).toHaveBeenCalledTimes(2)
stop()
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test tests/asset-service-events.test.ts -t visible`
Expected: FAIL because the scheduler is missing.

- [ ] **Step 3: Implement visibility-aware polling**

The scheduler calls only while `document.visibilityState === "visible"`; the hook keeps its existing focus/visibility immediate check and adds scheduler cleanup.

- [ ] **Step 4: Verify conditional reload behavior**

The Playwright route returns revision 1 twice and revision 2 next; assert the assets endpoint is reloaded only after revision 2.

- [ ] **Step 5: Run focused tests**

Run: `pnpm test tests/asset-service-events.test.ts`
Expected: PASS.

Run: `pnpm test:e2e tests/e2e/asset-panel.spec.ts`
Expected: PASS.
