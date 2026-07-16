# 轻设统一产品架构

## 目标

**轻设是唯一主产品。** 其余能力都是配套：

- 轻设 App：编辑器
- 云素材面板：服务器入库/审核页
- 轻抠：本机角标处理工人
- 浏览器插件：收集器，把网页图片送到素材面板

统一指共享业务源码和构建入口，不是把服务器、插件和本地抠图进程塞进同一个程序，也不把配套能力讲成并列产品。

```text
src/main.tsx + src/App.tsx + src/features
        ├── 浏览器：Vite 直接运行
        ├── Windows：Tauri 打包同一个 dist
        ├── macOS：Tauri 打包同一个 dist
        └── iPadOS：Tauri 打包同一个 dist

浏览器插件 ──收集──> 云素材面板
                         │ 创建任务
                         ▼
                  云端素材队列/API
                         ▲
                         │ 主动领取/回传
                  本地轻抠 ──成品──> 轻设 App
```

## 代码所有权

| 路径 | 负责内容 | 不允许承载 |
|---|---|---|
| `src/App.tsx`、`src/features/editor/**` | 各端共享编辑器行为 | Mac/iPad 各自复制的一套功能 |
| `src/platform/**` | 运行环境识别、构建信息、平台适配入口 | 编辑器业务规则 |
| `src-tauri/**` | App 壳、权限、原生插件与平台打包 | Web 页面分支或另一套编辑器 UI |
| `src/features/asset-admin/**` | 云素材面板（运维页） | 独立 Tauri 素材 App |
| `tools/asset_admin/**`、`deploy/asset-cloud/**` | 素材 API、队列、部署和处理协议 | 编辑器项目文件 |
| `browser-extension/**` | AI 网页图片识别、下载、归档、发送 | 管理令牌、SSH 信息、云端审核逻辑 |
| `src/features/processor/**` | 轻抠托盘壳（无界面角标） | 素材后台或编辑器 UI |

## 构建链路

1. `pnpm app:build` 只生成 `dist/index.html` 和轻设 App 资源。
2. `src-tauri/tauri.conf.json` 的 `beforeBuildCommand` 固定调用 `pnpm app:build`，所以 Windows、macOS、iPadOS 不允许引用第二套前端输出；桌面安装包最终复制到独立的 `dist-app`，不会被轻抠构建覆盖。
3. `pnpm asset-panel:build` 生成 `dist-asset-admin`，它由服务器镜像托管。
4. `pnpm extension:build` 生成浏览器安装包。
5. `pnpm processor:build` 构建 Python 处理 sidecar，并用单独的 Tauri 配置和 Cargo `processor` feature 打包到 `dist-processing-agent`。

`pnpm boundaries:check` 会检查这些关系。`pnpm build:all` 还会检查实际产物中是否发生页面串包。

## 平台差异原则

- 布局和触控差异用共享 React 组件内的响应式状态处理。
- 文件选择、项目存储等系统能力通过平台适配层处理。
- iPadOS 可以用系统分享面板，桌面可以用原生文件对话框，但两者调用同一份项目和导出逻辑。
- 只有确实需要系统 API 的能力才进入 Rust/Swift；不要在 Xcode 生成工程里实现业务功能。

## 更新为什么不会“自动出现”

开发服务器、已安装 App 和 iPad 包是三种不同的运行实例。共享源码只能保证重新运行/重新打包后行为一致，不能远程改写已经安装的旧二进制。底部状态栏的版本和 Git 修订号用于确认当前运行实例是否是最新构建。

正确流程：

```text
修改共享源码 → 自动检查 → Web 验收 → 桌面开发壳验收 → iPad 验收 → 生成安装包
```

不允许的流程：

```text
直接改 dist / 直接改 Xcode 生成工程里的页面 / 复制一份 App 源码给另一个平台
```
