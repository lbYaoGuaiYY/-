# 轻设

**轻设是唯一主产品。** 其余都是配套能力，不并列成第二款产品。

| 角色 | 是什么 | 运行位置 | 入口 / 构建 |
|---|---|---|---|
| **轻设 App** | 使用云素材做本地图片合成 | Web / Windows / macOS / iPad | `index.html` · `pnpm app:build` |
| **云素材面板** | 素材入库、排队、审核 | `assets.xiduoduo.top` | `asset-admin.html` · `pnpm asset-panel:build` |
| **轻抠** | 本机抠图工人：打开即上报，领取任务并回传 | macOS 菜单栏 / Windows 托盘 | `processor.html` · `pnpm processor:build` |
| **浏览器插件** | 从 AI 网页收图，送到素材面板 | Chrome / Edge / Firefox | `browser-extension/` · `pnpm extension:build` |

日常使用只记这条线：

```text
AI 网页 → 浏览器插件收集 → 云素材面板排队/审核 → 轻抠本地处理 → 轻设 App
```

原生安装包目录：轻设在 `dist-app/`，轻抠在 `dist-processing-agent/`；两者构建互不覆盖。

## 最重要的统一规则

- Web、Windows、macOS 和 iPadOS 不是四套 App。它们都打包 `src/main.tsx` 和 `src/App.tsx`。
- 不要直接修改 `dist*`、`browser-extension/dist`、`src-tauri/target` 或 `src-tauri/gen` 来实现产品功能；它们是生成物。
- 平台差异只放在 `src/platform/`、Tauri 能力配置或原生适配层，编辑器业务功能继续放在 `src/features/`。
- 云素材面板只部署到服务器，不做成桌面 App，也不塞进轻设编辑器。
- 浏览器插件只负责识别、下载、归档，并把用户选择的图片送到素材面板。
- 抠图任务由服务器排队；轻抠只在本机领取和处理；服务器不运行 AI 抠图。
- 不要把插件、轻抠、素材面板讲成和轻设并列的“产品线”；它们是轻设的配套能力。

机器可读的产品边界在 `config/product-surfaces.json`，运行 `pnpm boundaries:check` 会阻止入口、输出目录、Tauri 配置或权限再次分叉。

## 日常开发

```sh
pnpm install --frozen-lockfile
pnpm app:dev
```

桌面 App 热更新：

```sh
pnpm app:desktop:dev
```

iPadOS 开发（必须从仓库根目录启动，不要单独双击生成的 Xcode 工程）：

```sh
pnpm app:ios:init   # 只在首次或工程需要重建时运行
pnpm app:ios:dev
```

云素材面板与配套工具：

```sh
pnpm asset-panel:dev
pnpm processor:dev
pnpm extension:build
```

## 验证与交付

```sh
pnpm boundaries:check
pnpm typecheck
pnpm test
pnpm check
pnpm build:all
pnpm test:e2e
```

编辑器底部状态栏会显示 `版本号 · Git 修订号`。Web、Mac、Windows 或 iPad 显示相同修订号时，代表它们确实来自同一份源码；安装包不会自动变成新版本，修改后必须重新运行对应构建或开发命令。

更完整的所有权和数据流说明见 `docs/PRODUCT_ARCHITECTURE.md`，视觉与产品范围继续以 `DESIGN.md` 为准。
