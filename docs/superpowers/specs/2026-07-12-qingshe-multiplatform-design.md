# 轻设 Windows / macOS / iPadOS 成品化设计

## 目标

在保留现有 Windows 编辑器能力的前提下，把轻设做成一套可持续交付的跨平台产品：

- Windows：继续使用 Tauri 桌面版，保持当前项目文件、素材库、画布编辑和导出能力。
- macOS：使用同一套 React + Fabric 编辑器核心，提供原生 Tauri `.app` / `.dmg` 构建。
- iPadOS：使用 Tauri iOS 原生壳，提供适配触控、分屏和安全区的 iPad 编辑体验。
- 素材：Windows、Mac、iPad 使用同一套可配置的素材服务地址；本地编辑项目仍以本地持久化为主，通过现有 `.qingshe` 项目包进行跨设备传输。
- 协作：源代码以 Git 为主，内网传输用于构建产物、项目包和测试素材，不把 Windows 控制能力混进用户产品。

## 已确认的约束

- 遵守 `DESIGN.md` 的画布优先、borders-only、中性深色界面，不增加模板、AI、登录或后台入口。
- 继续使用 pnpm，不引入第二套前端框架或新的状态管理框架。
- 不把素材管理员 token 打进普通编辑器安装包。
- 网络不可用时，项目编辑和已缓存素材仍可工作；网络恢复后允许重新拉取云素材。
- 不能把“浏览器响应式布局”当作 iPad 成品；必须有 iPad 原生构建入口和触控验收路径。

## 方案选择

采用“共享前端核心 + 平台能力适配层 + Tauri 多目标壳”的方案。

### 方案 A：共享 React/Fabric 核心，Tauri 2 负责桌面和 iPad 原生壳（采用）

优点是最大化复用当前已经完成的编辑器、项目格式、素材缓存和测试；Windows、macOS、iPadOS 的数据模型与交互语义一致，平台差异集中在文件、缓存、分享和窗口能力中。代价是要补齐 Tauri iOS 工程、权限、Xcode 构建和触控验收。

### 方案 B：Mac/iPad 另写 SwiftUI 客户端

原生体验上限高，但需要重新实现 Fabric 画布、图层操作、项目包解析和素材库，短期内会产生两套产品行为，不能满足快速形成可用成品的目标。

### 方案 C：只做响应式网页/PWA

开发成本最低，但没有原生 iPad 安装包和 Xcode 运行路径，不能满足“iPad 端制作”的交付要求。

## 架构

### 1. 平台能力层

新增显式的运行时能力模型，至少区分：

```text
web
tauri-desktop (Windows / macOS)
tauri-mobile (iPadOS)
```

把当前散落的 `isDesktopRuntime()` 判断收敛到平台能力层，提供以下能力：

- 项目存储：Windows/macOS 使用 Tauri AppData 文件包；iPadOS/web 使用 IndexedDB，确保无需依赖桌面文件路径。
- 项目导入：桌面使用原生文件选择器；iPad/web 使用系统文件/照片选择器和 `<input type=file>` 回退。
- 项目导出：桌面使用原生保存对话框；iPad 优先系统分享，不能分享时回退下载；web 继续下载。
- 素材缓存：桌面使用现有原生 AppData 缓存；iPad/web 使用现有浏览器缓存实现，不直接访问桌面路径。
- 网络：素材服务 URL 从构建环境注入，默认值只用于本机开发；正式构建必须显式设置内网或公网地址。

这样既保留桌面的可靠落盘，也避免 iPad 因桌面文件系统权限而无法启动。

### 2. 编辑器与触控

- Fabric 画布、项目格式、历史记录、图层模型和素材服务客户端保持共享。
- iPad 以触控为第一输入：所有主要按钮和字段至少 44px 命中区；拖拽素材、画布平移、缩放、图层选择不能依赖 hover 或右键。
- 移动端面板继续使用底部操作栏和抽屉，但要补充 iPad 横竖屏、分屏宽度、safe-area inset 和键盘出现后的可用高度处理。
- 桌面三栏布局在 macOS/Windows 保持；窄窗口使用既有抽屉策略，不新增一套完全不同的编辑器。
- 对 `prefers-reduced-motion` 和触控滚动保持现有设计规则。

### 3. Tauri 目标

- Windows：保留 NSIS 配置和现有 bundle identifier。
- macOS：增加 `.app` / `.dmg` 构建配置，支持当前 Mac 的架构；若工具链具备 universal 目标，再提供 universal 构建。
- iPadOS：初始化 Tauri iOS 工程，固定 bundle identifier、显示名、图标、支持方向和最小系统版本；前端构建由同一套 `pnpm build` 提供。
- 桌面和移动权限分开声明：桌面允许 AppData 读写和原生文件对话框；iPad 只声明必要的沙盒文件/分享能力。

### 4. 内网与跨设备传输

产品内不引入远程桌面或未认证的文件服务器。跨设备的可靠路径为：

```text
Git：源代码与配置
素材服务：已确认素材和缩略图
.qingshe 项目包：单个项目的跨设备传输
内网共享/安全传输：构建包、测试素材和导出的成品
```

素材服务地址通过 `.env` / CI secret 配置，编辑器只读公开的素材查询与下载能力；管理员上传仍留在 asset-admin 构建和运维环境。项目包导入/导出继续由用户显式触发，避免未经确认覆盖另一台设备的本地项目。

## 错误处理

- 原生能力不可用时，必须回退到浏览器实现或给出可读错误，不让 App 空白启动。
- 素材服务不可达时，显示本地内置/缓存素材，并保留编辑能力；错误状态不能只用颜色表达。
- 项目包损坏、空间不足、权限拒绝分别提示，且不删除旧的有效项目文件。
- iPad 分享失败时自动回退下载；导出文件生成失败时保留当前编辑状态。
- 平台运行时判定和存储选择增加单元测试，防止移动端误走桌面文件路径。

## 验证与交付

代码验证按改动范围执行：

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm check`
4. `pnpm build`
5. `pnpm test:e2e`
6. macOS `pnpm tauri build`，检查 `.app` / `.dmg` 产物并实际启动。
7. iPadOS 初始化并构建 Tauri iOS 工程；在可用的 Xcode Simulator 或已连接 iPad 上验证启动、导入图片、素材拖入、触控移动/缩放、撤销重做、导出分享和项目恢复。

Apple 签名、真机安装、TestFlight/App Store 上传不把账号信息写入仓库；需要在当前 Mac 的 Xcode 中按用户账号完成签名配置后执行。

## 非目标

- 不重写现有 Windows 编辑器。
- 不把 Mac 作为远程控制服务器加入用户产品。
- 不在本轮加入账号系统、协作编辑、自动云同步或在线数据库项目存储。
- 不修改 Media/素材处理服务的算法实现，只完善客户端跨平台接入。

## 外部依据

- [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Apple: Distributing your app to registered devices](https://developer.apple.com/documentation/Xcode/distributing-your-app-to-registered-devices)
- [Apple: Preparing your app for distribution](https://developer.apple.com/documentation/Xcode/preparing-your-app-for-distribution)
