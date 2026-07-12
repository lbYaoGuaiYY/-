# 轻设跨平台开发与内网协作

## 本地依赖

在 Mac 上执行：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm check
pnpm build
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
corepack pnpm tauri dev
```

Mac 完成一个可验证的小步后，先提交到分支，再由 Windows 工作区用 `git fetch` / `git switch` / `git pull --ff-only` 获取。不要用共享目录覆盖工作树，也不要用 `git reset --hard` 处理跨设备同步冲突；有冲突就保留两边变更并显式解决。

## 内网素材服务

本机服务：

```sh
pnpm assets:server
pnpm dev
```

Mac、Windows、iPad 在同一内网时，把编辑器构建环境的地址改为素材服务所在机器的内网地址：

```dotenv
VITE_APP_ENV=production
VITE_ASSET_SERVICE_URL=http://<内网地址>:<端口>/api/v1
VITE_ASSET_EDITOR_TOKEN=<只读编辑器令牌>
VITE_ASSET_SERVICE_EVENTS=0
```

生产构建不能使用 `127.0.0.1`、`localhost` 或 `0.0.0.0` 作为编辑器素材服务地址；内网地址可以使用 HTTP，公网传输应使用 HTTPS。Admin Token 只放在 asset-admin 运维环境，不写进普通编辑器构建。

## 文件传输边界

- 源代码和配置：Git。
- 云素材：素材服务 API，客户端按需下载并缓存。
- 单个项目：在编辑器里导出/导入 `.qingshe` 项目包。
- 构建包、测试素材、导出图片：使用内网共享或经过认证的 `scp` / `rsync`，不要将密钥写进脚本。

项目包导入是创建新本地项目，不覆盖当前项目；这保证 Mac、Windows、iPad 之间传输时不会误删已有编辑状态。

## 平台构建

macOS：

```sh
pnpm tauri:build:mac
```

iPadOS：

```sh
pnpm qingshe:ios:init
pnpm qingshe:ios:dev
pnpm qingshe:ios:build
```

Windows：

```powershell
corepack pnpm tauri build
```

构建完成后，交付前必须实际启动对应 App，检查底图导入、素材添加、触控/鼠标移动、撤销重做、项目包导出和项目恢复。
