# 轻设最终产品审计与真实闭环证据

日期：2026-07-17

基线：`e8e212a26a73`（审计开始时远端覆盖后的 `origin/main`）

范围：轻设编辑器、项目管理、云素材面板、浏览器插件、轻抠桌面伴侣、云素材服务与发布构建。

## 用户任务顺序

1. 在 AI 对话网站发现或生成单张/多张图片。
2. 插件提供单张下载、批量下载、ZIP 打包或发送素材面板。
3. 已配对插件可创建自动任务并把原图直接上传素材服务。
4. 已登录素材面板签发轻抠设备令牌；轻抠只能使用该令牌领取任务。
5. 轻抠在本机运行 rembg，生成透明 PNG 与 WebP 缩略图并回传。
6. 素材服务入库、分类、审核并向轻设编辑器提供目录与媒体文件。
7. 编辑器下载并缓存素材，添加到画布，继续排版、保存、导入/导出。

## 验收矩阵

| 产品面 | 要求 | 当前证据 | 状态 |
| --- | --- | --- | --- |
| 编辑器 | 底图、素材、图层、属性、撤销重做、导入导出、项目持久化 | 最终 68 条 E2E 全部通过；截图 07、17、18 | 通过 |
| 云素材 | 正式域名、缓存、缩略图、登录、目录读取 | 正式健康端点 200；编辑器读取 19 项；截图 07、08 | 通过 |
| 轻抠 | 本机真实模型、透明 PNG、WebP、回传与目录消费 | `pnpm pipeline:verify` 从真实 MV3 Chromium 发起连续闭环，返回 `pipeline=ready`，PNG 1216×862，alpha 0–255，媒体均为 200 | 通过 |
| 设备安全 | 管理会话、插件作用域令牌、轻抠面板配对、无硬编码默认密码 | 匿名轻抠注册已移除；管理密码随机生成且仅保存在部署主机；40 条 Python 回归通过 | 通过 |
| 发布构建 | App、素材面板、处理器、Chrome/Firefox 插件 | 最终 `pnpm build:all` 与 `pnpm processor:build` 通过；Chrome ZIP、Firefox XPI、三个 Web 产物和 Windows 轻抠 NSIS 安装包均重建 | 通过 |
| 浏览器插件 | 真实 MV3 加载、发现、下载、ZIP、面板桥接、取消与服务工作线程恢复 | `pnpm extension:verify` 在 Playwright 自带隔离 Chromium 中加载 `dist/chrome`：两项下载完成、ZIP 两项、面板收到两项；ChatGPT/Gemini 各提交并上传一次；强制终止 service worker 后无重复提示或上传；取消后零上传；截图 15、16 | 通过 |

## 真实闭环结果

命令：`pnpm pipeline:verify`
结构化结果：`pipeline-e2e.jsonl`

```json
{
  "pipeline": "ready",
  "extension_client": "browser-extension/dist/chrome (MV3 Chromium)",
  "browser_extension_id": "npihccnndcpbkchaomdncbgghccffflj",
  "prompt_submissions": 1,
  "uploads": 1,
  "extension_device_id": "578c35ed-af08-48dd-be39-aadc4dc8edb7",
  "run_id": "27275ddd-7b1d-4a8d-9f8f-2c9548dc5870",
  "item_id": "6d49149c-28a0-4a81-9aa9-9f1c87cb8eaf",
  "task_id": "8397089e-9f78-4f1e-b2cd-10c26a905a40",
  "asset_id": "c94459fb-f0fe-498e-ac40-aacf15c73bfd",
  "processed_http": 200,
  "thumbnail_http": 200,
  "processed_size": [1216, 862],
  "thumbnail_size": [480, 340],
  "alpha_range": [0, 255]
}
```

该验收不是像素透传、管理员直传、API 客户端替身或分段推断：脚本启动真实 FastAPI/SQLite 服务，配对作用域扩展与轻抠令牌，在 Playwright 自带隔离 Chromium 中加载发布目录 `browser-extension/dist/chrome`；真实 MV3 弹窗打开 ChatGPT 同源确定性页面，提交 1 次提示词，内容脚本捕获图片，service worker 通过正式 API 地址代理到临时真实服务并以 multipart 上传。随后真实轻抠节点加载 `isnet-general-use` ONNX 模型处理，服务关联扩展运行与成品，最后使用编辑器令牌读取目录、透明 PNG 和 WebP 缩略图。整条链路在同一次命令中连续完成。

## 真实 MV3 浏览器验收

命令：`pnpm extension:verify`

结构化结果：`extension-e2e.json`

该命令使用 Playwright 1.61.1 自带 Chromium、全新临时用户目录和发布目录 `browser-extension/dist/chrome`，没有使用或修改日常 Chrome/Edge 配置。测试从真实 MV3 service worker URL 取得扩展 ID `npihccnndcpbkchaomdncbgghccffflj`，并在 ChatGPT、Gemini 与素材面板的正式源站地址上提供确定性页面响应，因此 manifest 匹配、内容脚本、标签页 API、下载 API、跨上下文消息、multipart 上传和 service worker 生命周期均由浏览器真实执行。

| 场景 | 运行结果 |
| --- | --- |
| 当前页扫描 | 识别并选择 2 张 1448×1086 实图；文件名为 `01-酒红秋日花艺.png`、`02-婚礼桌花素材.png` |
| 单独/批量下载 | Chrome downloads API 返回 2 个 `complete`，每个 1,403,349 字节且由当前扩展发起 |
| ZIP | 实际下载并解包，含 2 个不重名 PNG 条目 |
| 素材面板桥接 | 面板真实内容脚本收到 2 个分块重组的数据文件，均超过 1.8 MB |
| ChatGPT 全自动 | 提示词提交 1 次、multipart 上传 1 次、运行完成 |
| Gemini 全自动 | 提示词提交 1 次、multipart 上传 1 次、运行完成 |
| MV3 中断恢复 | 用 CDP 强制关闭 service worker；图片随后仍上传成功，提示词 1 次、上传 1 次，无重复 |
| 取消 | 内容页观察器与云端运行同时取消；取消 API 1 次，取消后上传 0 次 |
| 可访问性 | 两个插件核心状态均无 axe serious/critical 结果 |

这套验收遵循 Chrome 与 Playwright 的官方扩展测试方式：持久化 Chromium context、`--load-extension`、直接读取 MV3 service worker，并通过真实浏览器状态而非内部函数替身判断结果。`pnpm extension:verify` 使用快速确定性 API 响应覆盖下载、ZIP、桥接、取消和 service worker 中断；`pnpm pipeline:verify` 另以同一真实 MV3 构建连续连接 FastAPI/SQLite/rembg 和编辑器目录。第三方账号登录与真实模型计费不进入自动门禁，站点 DOM 适配使用正式源站地址上的同源确定性页面。

最终门禁：`pnpm verify` 已一次通过产品边界、TypeScript、44 个测试文件共 163 条 Vitest、226 个文件的 Biome、完整构建、正式端点扫描、真实 MV3 Chromium 验收与 68 条 Playwright E2E；新增连续闭环证据后又以 `pnpm check` 复核当前 227 个文件，并让重型连续闭环 `pnpm pipeline:verify` 独立通过。构建产物未发现管理令牌、旧 IP 或硬编码默认凭据。

Windows 轻抠发布证据：`dist-processing-agent/qingshe-processor-windows-x64.exe` 为 135,930,504 字节，PE 元数据产品名“轻抠”、版本 `0.2.0`，SHA-256 为 `808E3144600B780C5AC2CFBB76F06CB8044CE715911FF80B01D7352BC151890D`。随包 PyInstaller sidecar 为 133,719,423 字节；独立启动后真实输出 `node`、`ready` 状态，并对无效测试令牌返回 HTTP 401 重试状态，证明解释器、ONNX Runtime 与运行入口均可加载。构建脚本现由 `uv` 隔离安装 PyInstaller 6.21.0 与固定抠图依赖，并通过 Corepack 启动 Tauri，Windows 干净环境不再依赖全局 `python3`/PyInstaller/pnpm 命令。

## 视觉审计

### 优点

- 编辑器遵守既有深色桌面工具设计：低圆角、无渐变和装饰阴影，操作层级稳定。
- 画布、素材、属性和图层保持在单屏工作区，桌面端高频操作不需要页面跳转。
- 正式云素材恢复后，19 个真实素材及其缩略图能在左侧面板显示，状态与刷新入口清晰。
- 素材面板登录页使用明确账号/密码标签和可读状态反馈；不再显示失效源站 IP。

### 已修问题

- 本机 `.env.local` 指向已失效的 `191.223.220.201`，且把管理令牌暴露给 Vite 客户端环境。
- 素材面板失去环境变量后无法推导正式 API，现只在生产环境回退到官方域名。
- 轻抠网页预览永久停在“启动中”，现明确区分网页预览和安装版能力，并禁用不可用操作。
- 轻抠允许匿名自注册并领取云任务，现改为登录素材面板签发令牌和安全深链。
- Windows 上 `/proc/meminfo`、POSIX 路径、`sh` 测试和临时 SQLite 清理均会失败，现已跨平台处理。
- 轻抠发布脚本在 Windows 会命中 Microsoft Store 的空 `python3`，且 Node 无法直接启动 `pnpm.cmd`；现改为 `uv` 隔离构建和 Node/Corepack 入口，真实 NSIS 安装包已生成。
- 生产镜像引用不存在的插件 `0.1.0` 包；发布门禁也未检查旧 IP，现已修复。
- 全自动启动请求此前会一直占用消息端口直到整批图片完成，真实批量任务可能卡死；现改为立即确认、后台逐项推进，并对重复指令和服务工作线程重启做恢复判断。
- 插件只要本地残留令牌就会显示“服务器已连接”，现通过真实心跳区分在线、离线和凭据失效，失效令牌会被清除。
- 弹窗的 `display:flex` 曾覆盖原生 `hidden`，导致“全自动”和“当前页面”两个面板同时渲染；现已修复并用真实弹窗代码重新截图。
- 批量下载此前忽略单项失败且 ZIP 同名文件会被覆盖；现逐项验证下载结果、锁定重复操作并为 ZIP 同名文件自动去重。
- “取消运行”此前只取消服务器状态，生成页仍会继续观察图片并可能迟到上传；现会同步终止当前页面任务、释放 DOM 观察器，再取消云端运行；断网时保留取消待同步状态，心跳恢复后自动补偿取消。
- 远程 JPEG、WebP、AVIF 或 GIF 图片此前可能统一获得 `.png` 文件名；现根据真实 URL/媒体类型保留正确扩展名。
- 安装说明此前指向不存在的 `browser-extension/dist` 根目录；现明确 Chrome/Edge 使用 `dist/chrome`、Firefox 使用 `dist/firefox`。
- 正式扩展包此前仍包含开发预览运行时和 TypeScript 声明；构建现会剥离这些文件，产品边界门禁也会阻止它们再次进入 Chrome/Firefox 包。
- 新建 AI 标签页发生重定向或客户端路由切换时，旧内容脚本可能先接收任务后被销毁；现先确认目标站点和输入框真正就绪，再把项目置为生成中。
- AI 图片节点若先插入、后完成网络加载，MutationObserver 不会收到第二次 DOM 变化，自动任务会永久停在生成中；现同时监听图片 `load` 事件，并有回归与真实 Chromium 证据。
- 素材面板主按钮原配色只有 4.46:1 对比度；主强调色已在原设计体系内微调到 4.72:1，登录稳定态通过 axe。
- 素材面板断网时曾直接展示底层英文请求和 URL；现改为可操作的中文网络提示，详细错误不再暴露在登录界面。

### 可访问性

- 编辑器主区域、素材、画布、属性、图层均有可读语义和名称。
- 轻抠状态使用 `role="status"` 与 `aria-live="polite"`；网页不可用按钮采用真实 disabled 状态。
- 素材面板登录输入均有可见标签，连接状态通过状态区域呈现。
- 插件模式切换采用 `tablist`/`tab`/`tabpanel` 语义，支持左右方向键、Home 和 End；隐藏面板不再进入可见流程。
- 截图 15–20 均在本轮以 420×560 或 1280×800 精确视口重新捕获并逐张检查；插件、编辑器、项目、素材面板登录与轻抠预览均无 axe serious/critical 结果。

### 限制

- 截图 05、09 是轻抠隐藏 Tauri 窗口的浏览器调试页；正式产品主要通过系统托盘展示状态。
- ChatGPT/Gemini 的 DOM 会持续变化；当前门禁验证正式域名、真实扩展注入与完整浏览器时序，但确定性页面不能代替第三方上线后按账号抽样巡检。
- 审计未使用或记录真实管理密码；登录后的管理区截图需要用户凭证或已登录会话。
- 当前 Windows 轻抠安装包未做 Authenticode 签名（`NotSigned`）；公开分发前需要发布者的代码签名证书，否则 Windows 可能显示信誉提示。
- 自动 axe 只能证明已覆盖规则中没有 serious/critical 结果，不能替代完整人工 WCAG 审核；本轮同时人工检查了文字、裁切、间距、焦点层级和加载状态。

## 截图索引

- `01-app-home.png`：初始首页。
- `02-app-editor-desktop.png`：编辑器桌面工作区。
- `03-project-list.png`：本地项目列表。
- `04-asset-panel.png`：修复前旧 IP 网络错误。
- `05-processor.png`：修复前永久“启动中”。
- `06-extension-popup.png`：直接 Vite 路径无法解析扩展构建布局，仅作问题证据。
- `07-editor-official-cloud.png`：修复后正式云端 19 项素材与缩略图。
- `08-asset-panel-official-login.png`：修复后正式 API 连接正常。
- `09-processor-browser-state.png`：修复后明确网页预览状态。
- `10-extension-current-preview.png`：按真实 420×560 弹窗结构复验的全自动运行状态。
- `11-extension-live-preview.png`：复用生产弹窗代码的全自动运行状态。
- `12-extension-manual-live-preview.png`：修复模式隔离后的当前页面批量扫描、下载、ZIP 和送入素材面板状态。
- `13-extension-manual-current-run.png`：本轮重新捕获的当前页面模式与真实候选图片。
- `14-extension-auto-current-run.png`：本轮重新捕获的全自动运行进度、取消入口与模式隔离。
- `15-extension-mv3-manual.png`：真实 MV3 扩展当前页模式，420×560；两张实图、下载、ZIP 和素材面板入口完整可见。
- `16-extension-mv3-auto-complete.png`：真实 MV3 扩展 Gemini 自动运行完成态，420×560。
- `17-editor-full-width.png`：编辑器完整桌面工作区，1280×800；真实仓库底图、素材、画布、图层和属性同屏。
- `18-projects-full-width.png`：本地项目列表稳定态，1280×800。
- `19-asset-panel-full-width.png`：云素材面板健康但未登录状态，1280×800；非加载中、按钮可用。
- `20-processor-full-width.png`：轻抠网页预览的明确能力边界，1280×800；正式安装版仍以隐藏托盘进程运行。
