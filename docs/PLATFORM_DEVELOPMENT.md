# 轻设跨平台开发与内网协作

## 本地依赖

在 Mac 上执行：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm check
pnpm app:build
```

桌面 Tauri 构建需要 Rust；macOS/iPadOS 构建还需要完整 Xcode，而不是只有 Command Line Tools。iPadOS 真机安装或 TestFlight 仍需要 Xcode 里的 Apple 签名配置，证书和账号不进入仓库。

## Mac 统筹 Windows 工作区

源代码以 Git 作为唯一权威来源。Mac 端检查 Windows 之前的最新提交：

```sh
git fetch --prune origin
git log --oneline --decorate --all -12
git status --short --branch
```

Windows 端使用：

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm app:desktop:dev
```

Mac 完成一个可验证的小步后，先提交到分支，再由 Windows 工作区用 `git fetch` / `git switch` / `git pull --ff-only` 获取。不要用共享目录覆盖工作树，也不要用 `git reset --hard` 处理跨设备同步冲突；有冲突就保留两边变更并显式解决。

## 素材服务器

素材面板和素材 API 均部署在服务器。Mac、Windows、iPad 调试临时服务时，可以不设置 `VITE_APP_ENV=production`，并把编辑器开发环境指向测试服务：

```dotenv
VITE_ASSET_SERVICE_URL=http://<内网地址>:<端口>/api/v1
VITE_ASSET_EDITOR_TOKEN=<只读编辑器令牌>
VITE_ASSET_SERVICE_EVENTS=0
```

当前云端素材部署使用远端编辑器地址时，在项目根目录执行：

```sh
sh deploy/asset-cloud/create-runtime-env.sh
```

脚本从 `deploy/asset-cloud/.env` 读取 `QINGSHE_EDITOR_TOKEN`，将编辑器配置写入项目根目录的 `.env.local`，随后再运行 `pnpm app:dev`、`pnpm app:build` 或 Tauri 构建。普通编辑器环境不写入 Admin URL 或 Admin Token；素材面板使用独立的 `.env.asset-admin.local`。

生产构建只允许 `https://assets.xiduoduo.top/api/v1`。`https://xiduoduo.top/` 只承载婚庆网站首页，轻设不得在根域名挂载路径服务。内网 HTTP 只用于本地开发，不得进入安装包。Admin Token 只放在 asset-admin 运维环境，不写进普通编辑器构建。源站 IP 只存在于 CDN、防火墙和管理通道配置，不进入客户端环境。

## 文件传输边界

- 源代码和配置：Git。
- 云素材：素材服务 API，客户端按需下载并缓存。
- 单个项目：在编辑器里导出/导入 `.qingshe` 项目包。
- 构建包、测试素材、导出图片：使用内网共享或经过认证的 `scp` / `rsync`，不要将密钥写进脚本。

项目包导入是创建新本地项目，不覆盖当前项目；这保证 Mac、Windows、iPad 之间传输时不会误删已有编辑状态。

## 平台构建

macOS：

```sh
pnpm app:mac:build
```

iPadOS：

```sh
pnpm app:ios:init
pnpm app:ios:dev
pnpm app:ios:build
```

日常用 Xcode 调试时，必须从仓库根目录执行 `pnpm app:ios:dev`，保持该终端进程运行，再在它打开的 Xcode 工程中点击 Run。不要直接双击生成的 `.xcodeproj` 后单独点击 Run：Tauri 的 `Build Rust Code` 阶段需要仍在运行的 Tauri CLI 开发桥接进程，否则会出现 `failed to build WebSocket client` 或 `Connection refused`。

`app:ios:dev` 和 `app:ios:build` 都会先运行 `app:ios:sync`，将生成的工程固定到 iOS 15，并写入 Tao scene 生命周期配置；Vite 打包使用相对资源路径和关闭 modulepreload，避免 iPad WebKit 自定义协议下出现“HTML 已加载但脚本不执行”。当前 Mac 使用 Xcode 27 beta 时，仓库内还包含 SwiftPM target shim 与 `tauri-runtime-wry` 的 WebKit 版本探测兼容补丁，这些只针对 iOS/macOS 构建链路，不改变编辑器业务逻辑。

默认的 iPadOS 验证构建面向 Apple Silicon Simulator，不签名；真机或 TestFlight 使用 Xcode Team/Provisioning 配置后，再按 Tauri CLI 的 `--target aarch64` 和 `--export-method` 选项构建。

Windows：

```powershell
corepack pnpm app:windows:build
```

macOS 和 Windows 的轻设安装包统一输出到 `dist-app/`；轻抠输出到 `dist-processing-agent/`。

构建完成后，交付前必须实际启动对应 App，检查底图导入、素材添加、触控/鼠标移动、撤销重做、项目包导出和项目恢复。

Web、桌面和 iPad 的底部状态栏都显示同一个版本与 Git 修订号。验收时先核对修订号；不同就说明运行的是旧开发进程或旧安装包，需要重新启动或重新构建，不是再修改一套平台代码。
