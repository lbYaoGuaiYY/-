# 抠图器桌面程序与插件待上传流程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户下载并双击极简“轻设抠图器”即可在后台处理任务；浏览器插件把已选图片带到素材面板并停在用户确认上传之前。

**Architecture:** 保留现有 `processing_agent.py` 的云端轮询、配对和抠图协议，用标准库 Tkinter 提供极简状态窗口，再由 PyInstaller 冻结 Python 与依赖。插件继续使用 Manifest V3 service worker 与现有内容脚本分块桥接，素材面板只把桥接文件加入页面内待上传队列，确认按钮才调用现有 `createRemoteProcessingTask`。

**Tech Stack:** Python 3.12、Tkinter、PyInstaller、rembg、React 19、TypeScript、Chrome Manifest V3、Playwright、Vitest、pnpm。

## Global Constraints

- 不修改抠图算法、云端队列协议或登录体系。
- 不让用户下载或运行 `.py`；网站入口指向平台安装包。
- 插件发送后必须激活素材面板所在标签和窗口。
- 插件图片只进入待上传队列，用户确认前不得创建云端任务。
- 复用现有 `createRemoteProcessingTask`、内容脚本桥接和素材面板样式体系。

---

### Task 1: 插件聚焦素材面板并可靠交付文件

**Files:**
- Modify: `browser-extension/src/service-worker.js`
- Modify: `browser-extension/src/content-script.js`
- Modify: `tests/browser-extension-scan.test.ts`

**Interfaces:**
- Consumes: `QINGSHE_SEND_TO_PANEL` and the existing chunked transfer messages.
- Produces: focused panel tab plus `qingshe-extension-upload` window messages buffered until `qingshe-extension-ready`.

- [ ] Add a failing extension test proving an existing panel tab is activated and its Chrome window is focused.
- [ ] Run `pnpm exec vitest run tests/browser-extension-scan.test.ts` and observe the missing focus calls.
- [ ] Update `openPanelTab()` to call `chrome.tabs.update(tab.id, { active: true })` and `chrome.windows.update(tab.windowId, { focused: true })` before waiting for the bridge.
- [ ] Add a small content-script pending-file queue; flush it only after the panel posts `{ source: "qingshe-panel", type: "qingshe-extension-ready" }`.
- [ ] Re-run the focused test and `pnpm extension:build`.

### Task 2: 素材面板显示待上传图片并等待确认

**Files:**
- Modify: `src/features/asset-admin/RemoteAssetAdminApp.tsx`
- Modify: `src/styles/asset-admin.css`
- Modify: `tests/e2e/cloud-material-console-scroll.spec.ts`

**Interfaces:**
- Consumes: same-origin `qingshe-extension-upload` messages containing `{ name, type, dataUrl }`.
- Produces: an in-memory `File[]` staging area and one explicit `确认上传并抠图` action.

- [ ] Add an E2E test that posts two extension files, verifies both previews/names are selected, and proves no `/admin/processing-tasks` request occurs before confirmation.
- [ ] In the same test click `确认上传并抠图` and expect exactly two processing-task requests.
- [ ] Move extension message listening outside the signed-in-only branch, post the ready handshake on mount, and append valid files to `stagedExtensionFiles`.
- [ ] Render a compact pending-upload block inside the existing ingestion section with count, names/previews, remove/clear actions, and the confirmation button.
- [ ] On confirmation, call `createRemoteProcessingTask(file, category)` sequentially, keep failed files staged, clear successful files, refresh the dashboard, and focus/scroll the ingestion section when files arrive.
- [ ] Run only `pnpm test:e2e -- tests/e2e/cloud-material-console-scroll.spec.ts` plus `pnpm typecheck`.

### Task 3: 将抠图节点交付为极简桌面程序

**Files:**
- Modify: `tools/asset_admin/processing_agent.py`
- Create: `tools/asset_admin/processing_agent_app.py`
- Create: `tools/asset_admin/qingshe_processor.spec`
- Create: `scripts/build-processing-agent.mjs`
- Modify: `package.json`
- Modify: `tools/asset_admin/cloud_server.py`
- Modify: `src/features/asset-admin/remote-processing-client.ts`
- Modify: `scripts/finalize-asset-admin-build.mjs`
- Modify: `deploy/asset-cloud/Dockerfile`
- Modify: `tests/test_processing_agent.py`
- Modify: `tests/test_asset_cloud.py`

**Interfaces:**
- Consumes: the existing enrollment URL, stored processor token, poll/task/complete APIs and `render_result()`.
- Produces: `dist-processing-agent/轻设抠图器.app` and a downloadable macOS archive/DMG; the same spec is buildable as a Windows `.exe` on Windows.

- [ ] Add failing Python tests for status callbacks and for the download endpoint never serving the raw Python source.
- [ ] Refactor `run_agent()` to accept an optional status callback while keeping its existing command-line behavior unchanged.
- [ ] Build a Tkinter window with connection state, recent activity, `打开素材面板`, `最小化` and `退出`; run enrollment/polling on a daemon thread so the UI remains responsive.
- [ ] Add the PyInstaller spec and `pnpm processor:build` command using `uv run --with pyinstaller`; use windowed mode and the existing app icon.
- [ ] Make the FastAPI download route serve the packaged artifact from the admin downloads directory and return 404 when no platform artifact exists.
- [ ] Update the web link and build finalizer so the UI downloads an app package instead of `.py`.
- [ ] Run `uv run pytest tests/test_processing_agent.py tests/test_asset_cloud.py -q`, build the macOS app, launch it visibly, and verify its status window opens without a terminal.
- [ ] Run `pnpm typecheck`, relevant tests, the extension build, and targeted static checks.
