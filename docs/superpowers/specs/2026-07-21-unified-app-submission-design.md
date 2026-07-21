# 轻设三端同源与用户投稿闭环设计

## 1. 产品目标

轻设只维护一个主产品和一套编辑器业务代码。Windows、macOS 与 iPadOS 使用同一版本、同一提交和同一项目格式构建；平台差异只存在于文件选择、存储、分享、触屏和安装更新等适配层。

用户无需打开素材管理后台。用户在轻设 App 内选择图片、决定“智能抠图后审核”或“保留原图仅审核”，提交后可持续查看状态；只有审核通过的素材才进入正式素材库并可用于画布。

## 2. 设计原则

1. **一个产品，不是三套 App**：业务组件和交互语义共享，响应式布局适配输入方式与屏幕尺寸。
2. **画布优先**：新增投稿入口位于素材面板，不增加独立产品首页或复杂工具栏。
3. **投稿不等于入库**：用户提交与正式素材目录隔离，避免离线缓存或 Editor Token 绕过审核。
4. **状态必须可解释**：每次投稿都有等待、处理中、待审核、已通过或失败状态，并提供下一步。
5. **最小权限**：Editor Token 继续只读；投稿使用独立、受限的 Submission Token；管理员权限永不进入 App。
6. **同源发布**：版本、构建号、下载文件名与三端产物来自单一发布清单和同一 Git 提交。

## 3. 核心用户流程

### 3.1 提交素材

1. 用户在素材面板点击“提交素材”。
2. 用户选择 JPEG、PNG 或 WebP 图片；允许有背景，不要求透明。
3. App 显示真实图片预览、文件名、大小和格式。
4. 用户填写素材名称，可选分类。
5. 用户选择处理方式：
   - **智能抠图后审核（默认）**：进入远程处理队列，生成透明 PNG 后等待人工审核。
   - **保留原图，仅审核**：规范化图片和缩略图后直接进入待审核区。
6. App 上传并在“我的提交”中显示状态。

### 3.2 查看状态

| 状态 | 用户文案 | 可用动作 |
|---|---|---|
| `queued` | 等待处理 | 查看详情 |
| `processing` | 正在智能抠图 | 查看详情 |
| `pending_review` | 等待审核 | 查看详情 |
| `approved` | 已进入素材库 | 在素材库中查看、插入画布 |
| `failed` | 处理失败 | 查看原因、重新提交 |

状态凭据只保存在用户设备上的专用投稿记录中，不写入正式云素材缓存。审核通过后由素材目录 revision/SSE 触发正式素材库刷新。

### 3.3 管理员审核

管理员继续使用现有素材面板：查看待审核素材、调整分类、确认或删除。确认后 `needs_review=false`，正式目录 revision 增加，所有 App 获得更新。

## 4. 信息架构

素材面板保留一个主上下文，在标题下提供两个视图：

- **素材库**：搜索、分类、刷新、离线缓存、拖放或点击插入。
- **我的提交**：投稿状态、失败原因、通过后的“查看素材”。

“提交素材”是素材面板中的唯一高强调操作。桌面端显示文字按钮；iPad 抽屉使用同一组件并保持至少 44px 命中区。

## 5. 后端边界

### 5.1 投稿接口

- `POST /api/v1/submission-sessions`
  - 要求有效的 `X-Qingshe-Client` 匿名 UUID，返回绑定该 UUID、约 10 分钟有效的 HMAC upload capability
  - `QINGSHE_SUBMISSION_TOKEN` 只作为服务端签名密钥，禁止写入 `VITE_*` 环境变量或前端 bundle
- `POST /api/v1/submissions`
  - 使用 `Authorization: Bearer <upload capability>`，并要求同一 `X-Qingshe-Client`
  - `multipart/form-data`
  - `original`: JPEG/PNG/WebP，最多 25MB
  - `metadata`: `{ name, category?, mode, idempotency_key }`
- `GET /api/v1/submissions/{submission_id}`
  - 使用每次投稿返回的唯一 status token
  - 只返回状态、时间、错误摘要和可公开的 asset id
  - 不返回原图路径、管理凭据或其他用户投稿

### 5.2 数据隔离

`SubmissionStore` 单独保存投稿与处理任务/素材的映射、幂等键和 status token 哈希。正式 `Catalog` 仍只向编辑器返回 `status=ready AND needs_review=false` 的素材。

capability 是短期授权而非用户身份认证；服务端不保存 capability 原文，仅常量时间验证签名、过期时间和 client 绑定。新投稿按 client hash 与可信 remote-IP hash 的 UTC 日配额原子计数，精确幂等重试不重复消费，超限返回 `429` 和 `Retry-After`。remote IP 默认取 `request.client.host`，只有直连 peer 命中 `QINGSHE_TRUSTED_PROXY_IPS` 时才读取转发头，避免伪造。

### 5.3 清理策略

- 处理成功并写入正式 originals 后删除 incoming 临时副本。
- 失败或取消的 incoming 文件设置 TTL 清理。
- App 只保留必要状态，不缓存待审核原图。

## 6. 三端同源发布

### 6.1 单一来源

- 主 App 版本来自唯一 release manifest。
- Windows NSIS、macOS app/dmg、iPadOS build 都注入同一 SemVer、Git revision 和 release channel。
- 处理节点和浏览器扩展可以有独立版本，但必须在同一发布清单中显式声明，禁止散落硬编码。

### 6.2 CI 矩阵

| Job | 平台 | 产物/证明 |
|---|---|---|
| Quality | Linux/Windows | typecheck、unit、check、web build、E2E |
| Windows | Windows runner | NSIS 安装包 |
| macOS | macOS runner | app 与 dmg |
| iPadOS | macOS + Xcode | simulator build；有签名密钥时上传 TestFlight |

所有原生 job 使用同一 commit。iOS 生成工程必须可重复生成，并通过 `git diff --exit-code` 或等价哈希检查避免手工漂移。

### 6.3 更新方式

- Windows/macOS：Tauri updater + 签名更新元数据。
- iPadOS：App Store/TestFlight 的版本与 build number。
- UI 只展示一个轻设版本和构建 revision，不让用户理解平台内部差异。

官方依据：Tauri 支持从同一代码库构建 Windows、macOS 与 iOS，并推荐在 `tauri.conf.json > version` 管理应用版本；桌面 updater 的检查、下载和安装使用签名元数据。参见 [Tauri Distribute](https://v2.tauri.app/distribute/) 与 [Updater API](https://v2.tauri.app/reference/javascript/updater/)。

## 7. 从优秀产品吸收的模式

- **Adobe Creative Cloud Libraries**：素材库是跨应用复用的创意资产，而不是普通同步文件夹；轻设应把投稿、审核和正式库分层。参见 [Creative Cloud Libraries overview](https://helpx.adobe.com/in/creative-cloud/apps/create-and-manage-libraries/create-and-organize-libraries/libraries-overview.html)。
- **Adobe Cloud Documents**：项目跨设备同步需要版本历史和云原生文档模型，不能只同步本地文件夹。参见 [Organize and manage Creative Cloud assets](https://helpx.adobe.com/ca/creative-cloud/apps/create-and-manage-libraries/organize-manage-creative-cloud-assets.html)。
- **Canva editor uploads**：上传入口与用户自己的素材库直接相邻，上传完成后素材可立即继续编辑；轻设采用相同的“素材面板内完成”心智，但增加审核隔离。参见 [Canva asset upload](https://www.canva.dev/docs/apps/examples/asset-upload/)。
- **Figma desktop/mobile 分工**：共享文件与导航心智，但根据设备能力调整操作密度；轻设不应在 iPad 复制桌面三栏，而应保留画布优先抽屉。参见 [Figma desktop app](https://help.figma.com/hc/en-us/articles/5601429983767-Guide-to-the-Figma-desktop-app) 与 [Figma mobile app](https://help.figma.com/hc/en-us/articles/1500007537281-Guide-to-the-Figma-mobile-app)。

## 8. 验收标准

1. 改一次主 App 版本后，Windows、macOS、iPadOS 配置与产物名称自动一致。
2. CI 能在同一 commit 生成三端未签名/模拟器验证产物；签名 job 仅在 secrets 存在时运行。
3. App 可提交 JPEG/PNG/WebP，不要求透明或无背景。
4. 默认投稿进入抠图并待审核；“保留原图”进入待审核。
5. 用户可看到完整状态；失败可重试或重新提交。
6. Editor Token 无法调用投稿写接口，Admin Token 不进入 App。
7. 未审核素材在在线目录、离线缓存和画布素材列表中均不可见。
8. 管理员确认后，投稿状态变为已通过，素材出现在 App 正式素材库。
9. 1194px iPad 横屏布局与设计规范一致，触屏命中区不少于 44px。
10. 投稿对话框、移动操作面板和导出面板支持初始焦点、Tab 限制、Escape 与焦点恢复。
