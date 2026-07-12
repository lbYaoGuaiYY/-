# 轻设跨平台成品化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏现有 Windows 编辑器的前提下，交付可构建的 macOS 桌面版和 iPadOS 原生版，并让三端共享项目格式、素材服务和可验证的触控/导入/导出行为。

**Architecture:** React + Fabric 继续作为唯一编辑器核心。新增平台能力模块区分 `web`、`tauri-desktop` 和 `tauri-mobile`；桌面使用 Tauri AppData 与原生文件对话框，iPad/web 使用 IndexedDB、文件 input、下载/系统分享。Tauri 配置和权限按桌面与移动端分开，素材服务地址只从环境注入。

**Tech Stack:** React 19, TypeScript 7, Fabric 7, Dexie 4, Tauri 2.11, Rust 1.95, Vite 8, pnpm 11, Vitest 4, Playwright.

## Global Constraints

- 使用 `pnpm`，不使用 npm 或 yarn。
- 遵守 `DESIGN.md` 的画布优先、borders-only、中性深色界面。
- 不增加模板、AI、登录、后台入口、协作编辑或在线项目数据库。
- 不把素材管理员 token 打进普通编辑器构建。
- Windows/macOS 使用 Tauri AppData，iPadOS/web 使用 IndexedDB。
- iPad 主要交互不依赖 hover、右键或键盘；触控命中区至少 44px。
- 素材服务不可用时必须保留内置/缓存素材和本地编辑能力。
- 原生能力不可用时必须回退到浏览器实现或显示可读错误。

## 文件地图

- `src/features/projects/tauri-runtime.ts`: 统一识别 web、桌面 Tauri、移动 Tauri。
- `src/features/projects/project-storage.ts`: 按平台选择项目存储。
- `src/features/projects/project-file-dialog.ts`: 桌面原生文件对话框与移动/网页文件 input 回退。
- `src/features/projects/project-package.ts`: `.qingshe` 编解码和移动端分享/下载入口。
- `src/features/assets/asset-service-config.ts`: 运行环境注入素材服务地址和安全 token。
- `src/features/editor/EditorCanvas.tsx`: 画布触控平移/缩放和移动端交互。
- `src/styles/responsive.css`, `src/styles/layout.css`: iPad 安全区、分屏、抽屉和触控尺寸。
- `src-tauri/tauri.conf.json`: Windows 与 macOS 桌面 bundle 基线。
- `src-tauri/capabilities/`: 桌面和移动权限边界。
- `src-tauri/gen/apple/`: Tauri iOS/Xcode 工程，由 Tauri CLI 生成并纳入需要的配置。
- `tests/`: 平台判定、文件回退、分享回退、触控相关回归测试。
- `docs/PLATFORM_DEVELOPMENT.md`: Mac 统筹 Windows、内网素材服务和平台构建命令。

---

### Task 1: 建立平台能力层并锁定存储选择

**Files:**
- Modify: `src/features/projects/tauri-runtime.ts`
- Modify: `src/features/projects/project-storage.ts`
- Modify: `src/features/assets/cloud-asset-cache.ts`
- Modify: `tests/project-storage-selector.test.ts`
- Create: `tests/platform-runtime.test.ts`

**Interfaces:**
- Produce `PlatformRuntime = "web" | "tauri-desktop" | "tauri-mobile"`.
- Produce `getPlatformRuntime(): PlatformRuntime`.
- Produce `isDesktopRuntime(): boolean` as a compatibility wrapper returning only `tauri-desktop`.
- Produce `isMobileRuntime(): boolean` for iPad/Tauri mobile branches.

- [ ] **Step 1: Write failing runtime tests**

```ts
import { afterEach, describe, expect, it } from "vitest"
import { getPlatformRuntime, isDesktopRuntime, isMobileRuntime } from "../src/features/projects/tauri-runtime"

const originalTauri = (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__

afterEach(() => {
  const target = window as Window & { __TAURI_INTERNALS__?: unknown }
  if (originalTauri === undefined) delete target.__TAURI_INTERNALS__
  else target.__TAURI_INTERNALS__ = originalTauri
})

describe("platform runtime", () => {
  it("uses web when the Tauri bridge is absent", () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    expect(getPlatformRuntime()).toBe("web")
    expect(isDesktopRuntime()).toBe(false)
    expect(isMobileRuntime()).toBe(false)
  })

  it("uses desktop for a Tauri bridge without mobile marker", () => {
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    expect(getPlatformRuntime()).toBe("tauri-desktop")
    expect(isDesktopRuntime()).toBe(true)
  })

  it("uses mobile when the mobile marker is present", () => {
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { platform: "ios" }
    expect(getPlatformRuntime()).toBe("tauri-mobile")
    expect(isMobileRuntime()).toBe(true)
    expect(isDesktopRuntime()).toBe(false)
  })
})
```

- [ ] **Step 2: Run the focused test and confirm the new API fails**

Run: `pnpm vitest run tests/platform-runtime.test.ts tests/project-storage-selector.test.ts`

Expected: FAIL because `getPlatformRuntime` and `isMobileRuntime` do not yet exist and the current runtime treats every Tauri bridge as desktop.

- [ ] **Step 3: Implement the runtime selector and switch desktop-only consumers**

Use the Tauri mobile marker when available, while keeping web as the safe default:

```ts
export type PlatformRuntime = "web" | "tauri-desktop" | "tauri-mobile"

type TauriInternals = { readonly platform?: unknown }

export function getPlatformRuntime(): PlatformRuntime {
  if (typeof window === "undefined") return "web"
  const bridge = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__
  if (bridge === undefined) return "web"
  return bridge.platform === "ios" || bridge.platform === "android"
    ? "tauri-mobile"
    : "tauri-desktop"
}

export function isDesktopRuntime(): boolean {
  return getPlatformRuntime() === "tauri-desktop"
}

export function isMobileRuntime(): boolean {
  return getPlatformRuntime() === "tauri-mobile"
}
```

Keep `TauriProjectStore` and `TauriProjectCatalog` behind `isDesktopRuntime()`. iPad must select `IndexedDbProjectStore` and `IndexedDbProjectCatalog`; `CloudAssetCache` must keep IndexedDB on `tauri-mobile`.

- [ ] **Step 4: Run focused tests and commit the platform boundary**

Run: `pnpm vitest run tests/platform-runtime.test.ts tests/project-storage-selector.test.ts`

Expected: PASS with all existing storage selector behavior preserved.

Commit: `git add src/features/projects/tauri-runtime.ts src/features/projects/project-storage.ts src/features/assets/cloud-asset-cache.ts tests/platform-runtime.test.ts tests/project-storage-selector.test.ts && git commit -m "feat: separate desktop and mobile runtimes"`

### Task 2: Make project import/export platform-aware

**Files:**
- Modify: `src/features/projects/project-file-dialog.ts`
- Modify: `src/features/projects/project-package.ts`
- Modify: `src/App.tsx`
- Modify: `src/features/editor/AppHeader.tsx`
- Create: `tests/project-file-dialog.test.ts`
- Modify: `tests/project-package.test.ts`

**Interfaces:**
- Produce `openProjectPackageFile(): Promise<File | null>` with desktop dialog and browser/mobile input fallback.
- Produce `openBackgroundImageFile(): Promise<File | null>` with desktop dialog and browser/mobile input fallback.
- Produce `shareOrDownloadProjectPackage(blob: Blob, filename: string): Promise<"shared" | "downloaded">`.

- [ ] **Step 1: Add failing tests for mobile-safe fallbacks**

Test that desktop code is not called for `tauri-mobile`, that a selected file input is decoded into a `File`, and that a rejected `navigator.share` falls back to an anchor download.

```ts
it("does not invoke the Tauri dialog on mobile", async () => {
  setMobileRuntime()
  const file = await openBackgroundImageFile()
  expect(file?.type).toBe("image/png")
  expect(mockTauriOpen).not.toHaveBeenCalled()
})

it("falls back to download when mobile sharing rejects", async () => {
  Object.assign(navigator, { share: vi.fn().mockRejectedValue(new Error("cancelled")) })
  const result = await shareOrDownloadProjectPackage(new Blob(["zip"]), "项目.qingshe")
  expect(result).toBe("downloaded")
  expect(anchorClick).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `pnpm vitest run tests/project-file-dialog.test.ts tests/project-package.test.ts`

Expected: FAIL because the current code chooses Tauri dialogs for all Tauri runtimes and has no share helper.

- [ ] **Step 3: Implement explicit desktop/mobile/web branches**

Use `isDesktopRuntime()` for `@tauri-apps/plugin-dialog` only. For mobile and web, reuse the hidden file inputs already owned by `App.tsx`; keep project decode and background import in the existing handlers. Add a small `shareOrDownloadProjectPackage` helper that calls `navigator.share({ files: [new File([blob], filename, { type: "application/zip" })] })` only when `navigator.canShare?.({ files })` is true; otherwise use the existing `downloadBlob` path.

- [ ] **Step 4: Wire App export/import actions and preserve desktop behavior**

`App.tsx` should use desktop native save only for `isDesktopRuntime()`. Mobile and web should call `shareOrDownloadProjectPackage`. The import buttons must remain keyboard-accessible and use `accept=".qingshe"` / image MIME filters on the hidden inputs. Do not show desktop-only project file controls on narrow touch layouts unless they have a working input fallback.

- [ ] **Step 5: Run focused tests and commit**

Run: `pnpm vitest run tests/project-file-dialog.test.ts tests/project-package.test.ts tests/e2e/project-home.spec.ts`

Expected: PASS; existing `.qingshe` encode/decode behavior remains unchanged.

Commit: `git add src/features/projects/project-file-dialog.ts src/features/projects/project-package.ts src/App.tsx src/features/editor/AppHeader.tsx tests/project-file-dialog.test.ts tests/project-package.test.ts && git commit -m "feat: support mobile project import and sharing"`

### Task 3: Finish iPad touch canvas and responsive editor behavior

**Files:**
- Modify: `src/features/editor/EditorCanvas.tsx`
- Modify: `src/styles/layout.css`
- Modify: `src/styles/responsive.css`
- Modify: `src/features/editor/MobileTabbar.tsx`
- Modify: `src/features/editor/use-editor-panels.ts`
- Create: `tests/editor-touch-layout.test.tsx`
- Modify: `tests/e2e/canvas-navigation.spec.ts`

**Interfaces:**
- Preserve `EditorCanvasProps` and `EditorController` APIs.
- Add a touch-safe canvas gesture layer that scrolls the stage with one-finger pan when the gesture starts outside an active Fabric object and uses pinch/trackpad zoom without blocking native panel scrolling.

- [ ] **Step 1: Write failing UI tests for iPad-sized interaction**

Assert that pointer-coarse controls expose at least 44px computed/minimum hit areas, the mobile tabbar has four labeled actions, the editor stage keeps safe-area padding, and project import/export actions remain reachable in portrait-sized viewport.

- [ ] **Step 2: Run the focused UI tests and record the current failure**

Run: `pnpm vitest run tests/editor-touch-layout.test.tsx`

Expected: FAIL for the newly asserted stage gesture/safe-area hooks.

- [ ] **Step 3: Implement pointer-aware stage gestures**

Use Pointer Events with an active pointer map, `touch-action: none` only on the canvas stage, and a guard that leaves native scrolling enabled in panels. On one-finger pan, update `stage-scroll.scrollLeft/scrollTop`; on two-finger gestures, calculate distance delta and call `controller.zoomBy` in coarse increments. Always clear pointers on `pointercancel` and component unmount.

- [ ] **Step 4: Update responsive layout for iPad and split view**

Use `100dvh`, `env(safe-area-inset-*)`, `min-height: 44px`, and `max-width` breakpoints that cover 768px portrait, 1024px landscape, and narrower split-view widths. Keep the existing desktop three-column layout at `>=1280px`; do not animate layout properties or introduce shadows/gradients.

- [ ] **Step 5: Run focused tests and actual browser acceptance**

Run: `pnpm vitest run tests/editor-touch-layout.test.tsx && pnpm test:e2e -- tests/e2e/canvas-navigation.spec.ts tests/e2e/editor.spec.ts`

Expected: PASS. Start `pnpm dev:e2e --host 127.0.0.1 --port 4175`, inspect the editor at 768x1024 and 1024x768, and confirm panels, canvas, import, export and tabbar are visible and usable.

- [ ] **Step 6: Commit the touch/mobile surface**

Commit: `git add src/features/editor/EditorCanvas.tsx src/styles/layout.css src/styles/responsive.css src/features/editor/MobileTabbar.tsx src/features/editor/use-editor-panels.ts tests/editor-touch-layout.test.tsx tests/e2e/canvas-navigation.spec.ts && git commit -m "feat: complete touch-first editor layout"`

### Task 4: Add configurable LAN asset service and platform development workflow

**Files:**
- Modify: `src/features/assets/asset-service-config.ts`
- Modify: `.env.e2e`
- Create: `.env.example`
- Create: `docs/PLATFORM_DEVELOPMENT.md`
- Create: `scripts/dev-with-assets.sh`
- Test: `tests/asset-service-config.test.ts`

**Interfaces:**
- Preserve `createAssetServiceConfig(environment, surface)` and its current editor/admin separation.
- Add a documented `VITE_ASSET_SERVICE_URL` contract supporting `http://127.0.0.1:7000`, a LAN IP, or an HTTPS public endpoint.

- [ ] **Step 1: Add failing config tests**

Test whitespace trimming, trailing slash normalization, editor token separation, and an explicit empty/invalid URL rejection for production builds.

- [ ] **Step 2: Run the focused config test**

Run: `pnpm vitest run tests/asset-service-config.test.ts`

Expected: FAIL only for the new production validation branch.

- [ ] **Step 3: Implement safe environment handling**

Keep local default `http://127.0.0.1:7000` for development. Add `VITE_APP_ENV=production` handling that throws a descriptive error during build-time config creation when the editor URL is absent or uses `127.0.0.1`; never expose `VITE_ASSET_ADMIN_SERVICE_URL` or admin tokens in the editor surface.

- [ ] **Step 4: Document Mac-to-Windows workflow**

`docs/PLATFORM_DEVELOPMENT.md` must include exact commands for:

```text
Mac: pnpm install --frozen-lockfile
Mac: pnpm typecheck && pnpm test && pnpm check && pnpm build
Windows: corepack pnpm install --frozen-lockfile
Windows: corepack pnpm tauri dev
LAN: VITE_ASSET_SERVICE_URL=http://<内网地址>:<端口>/api/v1
Project transfer: export/import .qingshe
```

Document that source changes travel through Git, while LAN/secure transfer is only for builds, assets and explicit project packages. Do not add passwords, tokens or device-specific paths.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm vitest run tests/asset-service-config.test.ts tests/asset-service-client.test.ts`

Expected: PASS, with the existing editor token behavior unchanged.

Commit: `git add src/features/assets/asset-service-config.ts .env.e2e .env.example docs/PLATFORM_DEVELOPMENT.md scripts/dev-with-assets.sh tests/asset-service-config.test.ts && git commit -m "feat: document cross-platform asset connectivity"`

### Task 5: Configure macOS Tauri desktop target

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/icons/icon.icns` only if regenerated from the repository source asset
- Create: `src-tauri/tauri.macos.conf.json` only if the Tauri CLI requires a target-specific overlay
- Modify: `package.json`

**Interfaces:**
- Preserve `pnpm tauri:dev` for Windows-compatible desktop development.
- Add `pnpm tauri:build:mac` to produce a macOS app bundle/DMG on macOS.

- [ ] **Step 1: Check local macOS toolchain before editing config**

Run: `uname -m; xcode-select -p; xcodebuild -version; rustc --version; pnpm exec tauri info`

Record whether Xcode, Rust, and Tauri prerequisites are present. Do not claim a signed app if signing identity is absent.

- [ ] **Step 2: Add the macOS build command and bundle target**

Use Tauri’s existing `com.qingshe.editor` identifier and product name `轻设`. Add a script that invokes `pnpm tauri build --bundles app,dmg` or the exact target syntax reported by the installed Tauri CLI. Keep Windows `nsis` as the default on Windows; do not replace it with a mac-only target.

- [ ] **Step 3: Build and inspect the macOS artifacts**

Run: `pnpm tauri:build:mac`

Expected: an `.app` and/or `.dmg` under `src-tauri/target/release/bundle/`, with the app launching on this Mac. If signing is unavailable, verify the unsigned local app and record the signing requirement separately.

- [ ] **Step 4: Commit macOS packaging**

Commit: `git add src-tauri/tauri.conf.json src-tauri/capabilities/default.json package.json src-tauri/tauri.macos.conf.json && git commit -m "feat: add macos desktop bundle"`

### Task 6: Initialize and configure Tauri iPadOS target

**Files:**
- Create/modify: `src-tauri/gen/apple/` generated Tauri iOS project
- Create: `src-tauri/capabilities/mobile.json`
- Modify: `src-tauri/tauri.conf.json` only for shared mobile-safe settings
- Modify: `package.json` with `qingshe:ios:init`, `qingshe:ios:dev`, `qingshe:ios:build`
- Modify: `docs/PLATFORM_DEVELOPMENT.md`

**Interfaces:**
- `pnpm qingshe:ios:init`: idempotently initializes the iOS project when absent.
- `pnpm qingshe:ios:dev`: starts the iOS target for Simulator/device through Tauri CLI.
- `pnpm qingshe:ios:build`: builds the iPadOS target through Xcode/Tauri without embedding signing credentials.

- [ ] **Step 1: Verify iOS prerequisites**

Run: `xcode-select -p; xcodebuild -version; rustup target list --installed | rg 'apple-ios'; pod --version || true; pnpm exec tauri info`

Expected: Xcode is selected and iOS Rust targets/CocoaPods are available. If a prerequisite is missing, install only the documented dependency or leave a concrete build error in the handoff; do not fabricate an IPA.

- [ ] **Step 2: Initialize the generated iOS project**

Run: `pnpm exec tauri ios init` and inspect the generated Xcode project for the bundle identifier, deployment target, orientations, app icon and display name. Keep generated files under source control only when required by the Tauri version; preserve the repository’s generated-icon source.

- [ ] **Step 3: Add mobile capabilities and package scripts**

Mobile permissions must not inherit desktop AppData write permissions. Keep iPad project data in IndexedDB, and allow only capabilities required for the frontend file/share path. Add scripts that call the installed Tauri CLI’s iOS commands.

- [ ] **Step 4: Build on Simulator and inspect the app**

Run: `pnpm qingshe:ios:build`

Expected: the iPadOS target compiles and launches in an iPad Simulator, with no runtime attempt to read desktop AppData. Verify portrait, landscape and split-width startup.

- [ ] **Step 5: Commit the iPadOS target**

Commit: `git add src-tauri/gen/apple src-tauri/capabilities/mobile.json src-tauri/tauri.conf.json package.json docs/PLATFORM_DEVELOPMENT.md && git commit -m "feat: add ipadOS tauri target"`

### Task 7: Add end-to-end acceptance and run the full verification matrix

**Files:**
- Create: `tests/e2e/multiplatform-editor.spec.ts`
- Modify: `playwright.config.ts` only if a mobile viewport project is needed
- Modify: `docs/PROJECT_TIMELINE.md`
- Modify: `docs/PLATFORM_DEVELOPMENT.md`

**Interfaces:**
- E2E tests use only public UI labels and `data-testid` attributes, not implementation-private React state.

- [ ] **Step 1: Write the acceptance scenarios**

Cover:

1. At 768x1024: import a background, open assets/layers/properties, add a built-in asset, move it, undo/redo, export PNG.
2. At 1024x768: preserve the canvas and panels in landscape.
3. With Tauri bridge absent: IndexedDB project persistence remains selected.
4. With a mobile marker: desktop dialogs are not called and export uses share/download fallback.
5. With asset service unavailable: built-in assets and previously cached assets remain visible.

- [ ] **Step 2: Run the focused browser acceptance**

Run: `pnpm test:e2e -- tests/e2e/multiplatform-editor.spec.ts`

Expected: PASS in Chromium at both mobile-sized viewports.

- [ ] **Step 3: Run the required project verification**

Run: `pnpm typecheck && pnpm test && pnpm check && pnpm build && pnpm test:e2e`

Expected: all commands exit 0. Separate unrelated pre-existing failures from changed-surface failures in the handoff; do not call the product complete while a changed-surface failure remains.

- [ ] **Step 4: Update the actual project timeline and handoff docs**

Record only commands and artifacts actually produced: macOS app/DMG path, iOS Simulator build result, Windows regression status, and any signing action still required. Include a short “运行成品” section with exact local commands.

- [ ] **Step 5: Commit the verified delivery state**

Commit: `git add tests/e2e/multiplatform-editor.spec.ts playwright.config.ts docs/PROJECT_TIMELINE.md docs/PLATFORM_DEVELOPMENT.md && git commit -m "test: verify multiplatform editor delivery"`

---

## Plan self-review

- Spec coverage: runtime separation is Task 1; file/share fallback is Task 2; touch/safe-area behavior is Task 3; LAN configuration and Mac-to-Windows workflow are Task 4; macOS packaging is Task 5; iPadOS native packaging is Task 6; required verification and handoff are Task 7.
- Placeholder scan: no task depends on a `TODO`, `TBD`, unspecified file, or an undefined neighboring API.
- Type consistency: `getPlatformRuntime`, `isDesktopRuntime`, and `isMobileRuntime` are defined in Task 1 and consumed by Tasks 2 and 3; mobile scripts are defined in Task 6 and documented in Task 7.
- Scope: all tasks are part of the same multiplatform delivery milestone and each ends with a focused test/build checkpoint.
