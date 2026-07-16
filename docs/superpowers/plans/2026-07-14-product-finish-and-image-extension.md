# 轻设产品收口与 AI 图片下载插件实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复素材面板的移动端基础布局与云端连接稳定性，整理四端产品说明，并交付一个可加载的 Manifest V3 AI 图片批量下载与素材面板传输插件。

**Architecture:** 素材面板继续作为 `assets.xiduoduo.top` 下的独立静态管理台，云 API 只走 `https://assets.xiduoduo.top/api/v1`；面板与编辑器通过共享的云端 API、健康状态和处理节点协议连接。浏览器插件使用 Manifest V3 service worker、内容脚本和 popup，复用现有 `fflate` 做 ZIP 打包，通过面板域名内容脚本桥接把图片送入已登录的素材管理台。

**Tech Stack:** React 19、TypeScript、Vite、FastAPI、Caddy、Tauri、Chrome Manifest V3、`chrome.downloads`、内容脚本、`fflate`。

## Global Constraints

- 婚庆首页 `https://xiduoduo.top/` 不变；轻设服务只使用 `assets.xiduoduo.top` 子域名。
- 客户端生产素材端点必须是 `https://assets.xiduoduo.top/api/v1`，不能出现源站 IP。
- 使用 `pnpm`，不引入第二套包管理器。
- 移动端页面必须没有横向溢出，内容超过视口时可正常纵向滚动，触控目标不小于 44px。
- 保留用户已有改动；只修改与本计划直接相关的文件。

---

### Task 1: 素材面板移动端布局基线

**Files:**
- Modify: `src/styles/asset-admin.css`
- Modify: `src/styles/tokens.css`
- Test: `tests/e2e/cloud-material-console-scroll.spec.ts`

目标：将管理台和云素材页统一为 `width: 100%`、`min-width: 0`、`overflow-x: hidden`、可滚动的移动布局；在 320px 宽度下不截断按钮、指标和筛选器。

### Task 2: 云端连接状态与登录恢复

**Files:**
- Modify: `src/features/asset-admin/RemoteAssetAdminApp.tsx`
- Modify: `src/features/asset-admin/remote-processing-client.ts`
- Modify: `src/features/asset-admin/cloud-operations-client.ts`
- Modify: `tools/asset_admin/cloud_server.py`
- Test: `tests/remote-processing-client.test.ts`
- Test: `tests/test_asset_cloud.py`

目标：统一 API 基址、区分未登录/服务器不可用/接口异常，连接失败时不锁死登录按钮；登录后显示云端健康、客户端、任务和下载状态。

### Task 3: 四端说明书页面

**Files:**
- Create: `manual.html`
- Create: `src/manual-main.tsx`
- Create: `src/features/manual/ManualApp.tsx`
- Create: `src/styles/manual.css`
- Modify: `vite.config.ts`
- Modify: `scripts/finalize-asset-admin-build.mjs`
- Create: `docs/PRODUCT_MANUAL.md`
- Test: `tests/e2e/manual.spec.ts`

目标：在 `https://assets.xiduoduo.top/admin/manual.html` 提供响应式侧边大纲、Windows/macOS/iPad/素材面板/连接与故障排查说明，并可在窄屏切换为顶部主题选择器。

### Task 4: AI 图片下载插件

**Files:**
- Create: `browser-extension/manifest.json`
- Create: `browser-extension/src/service-worker.js`
- Create: `browser-extension/src/content-script.js`
- Create: `browser-extension/src/popup.html`
- Create: `browser-extension/src/popup.js`
- Create: `browser-extension/src/popup.css`
- Create: `browser-extension/README.md`
- Create: `scripts/build-browser-extension.mjs`
- Modify: `package.json`

目标：支持 ChatGPT、Gemini 等页面的图片扫描、去重、选中、批量下载、ZIP 打包、下载记录和发送到已登录素材面板；所有站点适配器以独立选择器配置维护。

### Task 5: 交付验证与部署

**Files:**
- Modify: `README.md`
- Modify: `docs/ASSET_CLOUD_ARCHITECTURE.md`
- Modify: `docs/PLATFORM_DEVELOPMENT.md`

验证：运行必要的类型检查、相关单测、素材面板 E2E、插件构建和真实线上健康/登录/静态入口检查；部署管理台和说明书静态产物到云端容器。
