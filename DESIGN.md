# 轻设 Design System

## 0. Product Boundary

- 轻设 App 是唯一主产品。Web、Windows、macOS 与 iPadOS 共享同一套编辑器源码和视觉系统。
- 云素材面板是服务器运维页，负责入库、排队与审核；不出现在轻设 App 内，也不做成桌面 App。
- 轻抠是配套本机处理工人，只以 macOS 菜单栏 / Windows 托盘角标存在；打开即上报、领取任务并回传，不做成独立窗口软件。
- 浏览器插件是配套收集器：识别、下载、整理并发送 AI 网页图片，不承载审核或编辑。
- 插件、轻抠、素材面板都从属于轻设，不并列成多款产品。
- 平台适配不能复制、改写或另起一套编辑器 UI；平台差异必须收敛在共享响应式组件和 `src/platform/` 适配层。
- 产品界面不使用内部协作词汇（例如“用 / 存 / 造”）作为用户可见文案。

## 1. Atmosphere & Identity

轻设是一台安静、专业、画布优先的本地图片合成工作台。界面保持中性，把注意力留给用户的照片和素材；视觉关键词是克制、精确、高效、低干扰。签名是“蓝色选区”：强调色只用于选中、焦点和主操作，不用于装饰。

- 只保留导入、素材、画布、属性、图层、撤销重做和导出。
- 不使用渐变、玻璃拟态、大圆角卡片、欢迎文案或装饰插图。
- 不复制 Photoshop 的复杂工具栏，也不加入模板、AI、登录或后台入口。

## 2. Color

### Palette

| Role | Token | Value | Usage |
|---|---|---:|---|
| Application | `--surface-app` | `#161616` | 应用背景 |
| Stage | `--surface-stage` | `#202020` | 画布外工作区 |
| Panel | `--surface-panel` | `#252525` | 左右面板 |
| Control | `--surface-control` | `#303030` | 工具栏、输入框 |
| Hover | `--surface-hover` | `#3A3A3A` | 悬停反馈 |
| Selected | `--surface-selected` | `#3F3F3F` | 当前选中项 |
| Canvas | `--canvas-white` | `#FFFFFF` | 空白画布 |
| Border | `--border-default` | `#3C3C3C` | 默认分隔线 |
| Border strong | `--border-strong` | `#555555` | 聚焦分隔线 |
| Text primary | `--text-primary` | `#F2F2F2` | 主要文字 |
| Text secondary | `--text-secondary` | `#B8B8B8` | 次要文字 |
| Text muted | `--text-muted` | `#A8A8A8` | 元数据、禁用状态 |
| Accent | `--accent-primary` | `#4D8DFF` | 主按钮、选区、焦点 |
| Accent hover | `--accent-hover` | `#70A5FF` | 强调色悬停 |
| Accent strong | `--accent-strong` | `#3B6DC7` | 承载白色文字的主按钮 |
| Accent strong hover | `--accent-strong-hover` | `#325DAD` | 主按钮悬停 |
| Success | `--status-success` | `#45C98A` | 成功状态 |
| Warning | `--status-warning` | `#E7B657` | 警告状态 |
| Error | `--status-error` | `#ED6B72` | 错误状态 |

### Rules

- 强调色只用于导出按钮、选区、控制点、焦点环和当前选项。
- 面板层级依靠明度差和 1px 边线，不使用阴影。
- 画布外工作区比面板更暗，让用户图片成为视觉中心。
- 所有状态同时提供图标或文字，不能只依赖颜色。

## 3. Typography

### Scale

| Level | Size | Weight | Line height | Usage |
|---|---:|---:|---:|---|
| App title | 16px | 650 | 20px | 产品名称 |
| Section title | 13px | 600 | 18px | 面板标题 |
| Body | 14px | 400 | 20px | 默认正文 |
| Control | 13px | 500 | 18px | 控件标签 |
| Caption | 12px | 500 | 16px | 元数据、状态 |

### Font Stack

- Primary: `"Segoe UI Variable", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif`
- Mono: `"Cascadia Code", "SFMono-Regular", Consolas, monospace`

### Rules

- 最多使用两套字体；界面中不加载远程字体。
- 数值字段启用 `font-variant-numeric: tabular-nums`。
- 正文不低于 14px；元数据可使用 12px。

## 4. Spacing & Layout

### Base Unit

所有间距来自 4px 基础单位。

| Token | Value | Usage |
|---|---:|---|
| `--space-1` | 4px | 图标与标签 |
| `--space-2` | 8px | 紧凑列表、素材网格 |
| `--space-3` | 12px | 面板内边距 |
| `--space-4` | 16px | 分组间距 |
| `--space-6` | 24px | 空状态间距 |

### Grid

- 顶栏 48px，状态栏 28px。
- 标准桌面左栏 272px，右栏 288px，中心画布获得全部剩余空间。
- `>=1180px`：完整三栏常驻。
- `900–1179px`：左栏 220px、右栏 248px，可独立收起。
- `700–899px`：画布常驻，素材和属性使用左右抽屉。
- `<700px`：画布全屏，底部 56px 操作栏，功能面板使用底部抽屉。
- `pointer: coarse` 时交互命中区域至少 44px。

### Rules

- 面板分隔使用 1px 边线；画布不设置最大宽度。
- 控件高度桌面 32px、触屏 44px。
- 常规控件圆角 4px，菜单 6px；不使用药丸形大按钮。
- 不把桌面三栏直接纵向堆叠到窄屏。

## 5. Components

### Icon Button

- **Structure**: 原生 `button` + Phosphor 图标 + 可见 tooltip。
- **Variants**: neutral、active、primary、danger。
- **Spacing**: 32px 桌面命中区，44px 触屏命中区。
- **States**: default、hover、active、focus-visible、disabled。
- **Accessibility**: 必须提供 `aria-label`，焦点环为 2px 强调色。
- **Motion**: 120ms，仅使用颜色、transform 和 opacity。

### Panel Header

- **Structure**: 标题、可选计数、折叠动作。
- **Spacing**: 左右 12px，高 40px。
- **States**: normal、collapsed。
- **Accessibility**: 折叠按钮暴露 `aria-expanded`。

### Project Save Status

- **Structure**: 顶栏内紧邻项目名的单行状态文字。
- **States**: saving、saved、save failed、restore failed；空闲时不占用注意力。
- **Accessibility**: 使用礼貌级 live region，状态不能只依赖颜色表达。

### Asset Tile

- **Structure**: 透明棋盘预览、单行名称、状态角标。
- **Variants**: built-in、local、selected。
- **Spacing**: 双列网格，8px 间距。
- **States**: default、hover、focus、loading、error。
- **Accessibility**: 键盘可添加素材，完整名称在 `title` 中可读。

### Asset Filter Row

- **Structure**: 名称/编号/标签搜索框 + 单一分类选择器。
- **Spacing**: 12px 外边距、8px 控件间距；桌面高度 32px，触屏高度 44px。
- **States**: loading、ready、empty、service unavailable；错误时继续显示内置素材。
- **Behavior**: 搜索与分类由本地素材服务处理，首屏最多 120 项，其余由用户显式加载。
- **Accessibility**: 使用原生搜索框、选择器和按钮，所有控件必须有可读标签。

### Asset Review Gate

- **Structure**: 在库、待检查和回收站三个目录视图；待检查入口显示数量。
- **Behavior**: 编辑器只读取已确认素材；待检查素材保留当前分类，确认后进入在库视图。
- **States**: approved、needs review、selected、empty、busy。
- **Accessibility**: 视图按钮使用可见文字，素材选择使用 `aria-pressed`，确认动作不能只依赖颜色表达。

### Inspector Field

- **Structure**: 标签 + 数值输入框；单位紧邻数值。
- **States**: editable、readonly、disabled、focus、error。
- **Accessibility**: 标签通过 `htmlFor` 与输入框关联。

### Layer Row

- **Structure**: 可见性、缩略图、名称、锁定状态。
- **States**: default、selected、hidden、locked、dragging。
- **Accessibility**: 当前层使用 `aria-current`；排序按钮有方向说明。

### Project Card

- **Structure**: 场地底图封面、项目名称、最后修改时间、打开入口与管理操作。
- **States**: default、hover、focus、renaming、busy。
- **Depth**: 仅使用 `1px solid var(--border-default)`，不使用阴影。
- **Accessibility**: 打开、重命名、复制和删除分别使用原生按钮及完整 `aria-label`。
- **Responsive**: 桌面三列、平板两列、手机单列。

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
|---|---:|---|---|
| Micro | 120ms | ease-out | 按钮、悬停、按压 |
| Panel | 160ms | ease-in-out | 抽屉与面板开合 |

- 只动画 `transform` 与 `opacity`；不对布局属性做动画。
- 所有交互元素提供 hover、active、focus-visible 和 disabled 状态。
- 尊重 `prefers-reduced-motion`，关闭非必要动画。
- `Tab` 隐藏或恢复全部面板；`Delete` 删除当前素材；常用操作有键盘路径。

## 7. Depth & Surface

策略：**borders-only**。

- 应用、面板和画布工作区使用相邻的色阶建立层级。
- 面板、输入框、菜单和素材卡只使用 `1px solid var(--border-default)`。
- 禁止 `box-shadow`，选中态使用强调色边框或背景。
- 弹层仍使用边线和更高明度表面，不通过阴影制造深度。
