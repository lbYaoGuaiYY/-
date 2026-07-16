# 移动端功能对齐修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 iPad 与手机端具备电脑端核心编辑能力，补齐触控多选、图层操作、项目包和图片格式导出入口。

**Architecture:** 保留现有共享编辑控制器和响应式面板，仅增加移动端明确的触控入口；所有操作继续复用 `EditorController`，避免为移动端复制业务逻辑。项目包导入/备份统一走已有 Web Share/下载回退，图片导出复用已有 `ImageExportSheet`。

**Tech Stack:** React、TypeScript、Vitest、Playwright、pnpm、现有 Phosphor 图标与 DESIGN.md tokens。

## Global Constraints

- 使用 `pnpm`，不改用 npm/yarn。
- 遵守 `DESIGN.md` 的深色、画布优先、触控命中区至少 44px 约束。
- 保留工作区已有用户改动，不回滚无关文件。
- 先写失败测试，再写生产代码；只执行任务相关的最小验证。

---

### Task 1: 触控多选图层

**Files:**
- Modify: `src/features/editor/LayerPanel.tsx`
- Modify: `src/features/editor/MobileTabbar.tsx`
- Modify: `src/App.tsx`
- Test: `tests/editor-touch-layout.test.tsx`

**Behavior:** 图层面板在触控设备上提供“多选”模式；启用后点按图层切换选择，退出后恢复单选。桌面端保留 Shift/Ctrl/Command 多选行为。

- [ ] 添加失败测试，验证移动端多选按钮和批量选择回调。
- [ ] 运行定向测试确认因入口不存在而失败。
- [ ] 实现最小的移动多选状态和 44px 按钮。
- [ ] 运行测试确认通过，并保持桌面单选行为不变。

### Task 2: 触控图层“更多操作”

**Files:**
- Modify: `src/features/editor/LayerPanel.tsx`
- Modify: `src/features/editor/LayerContextMenu.tsx`
- Modify: `src/styles/responsive.css`
- Test: `tests/layer-panel-touch-actions.test.tsx`

**Behavior:** 每个移动端图层行提供可见“更多”按钮，直接打开复制、剪切、粘贴、创建副本、置顶/置底、删除菜单；长按/右键继续兼容。

- [ ] 添加失败测试，验证移动端更多按钮可见且打开现有菜单。
- [ ] 运行定向测试确认失败。
- [ ] 复用 `LayerContextMenu` 添加按钮入口和触控尺寸。
- [ ] 运行测试确认通过。

### Task 3: 移动端项目包与 JPG 导出

**Files:**
- Modify: `src/features/editor/AppHeader.tsx`
- Modify: `src/features/editor/MobileTabbar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles/responsive.css`
- Test: `tests/mobile-project-actions.test.tsx`

**Behavior:** 手机端提供“更多”菜单，包含导入可编辑项目、备份可编辑项目、PNG/JPG 导出；导出项目继续使用 Web Share/下载回退。移动端项目名可从更多菜单进入编辑。

- [ ] 添加失败测试，验证窄屏 DOM 仍有项目包操作和 JPG 选项入口。
- [ ] 运行定向测试确认失败。
- [ ] 实现移动端更多菜单及项目名编辑入口。
- [ ] 运行测试确认通过。

### Task 4: 回归与可见验收

**Files:**
- No additional source files.

- [ ] 运行 `pnpm typecheck`。
- [ ] 运行 `pnpm check`。
- [ ] 运行相关 Vitest 测试。
- [ ] 运行相关 Playwright E2E 测试或在本地页面完成桌面/平板/手机三种视口验收。
- [ ] 保存并检查验收截图，记录剩余风险。
