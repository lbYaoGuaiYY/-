import { useEffect, useMemo, useState } from "react"

type ManualSection = {
  readonly id: string
  readonly title: string
  readonly kicker: string
  readonly summary: string
  readonly points: readonly { readonly label: string; readonly text: string }[]
}

const sections: readonly ManualSection[] = [
  {
    id: "overview",
    title: "认识轻设",
    kicker: "01 · 从这里开始",
    summary:
      "轻设是一款面向日常设计工作的图片编辑工具。你可以在电脑或 iPad 上完成排版、合成、调整和导出。",
    points: [
      {
        label: "画布",
        text: "新建项目后，把图片、透明素材和文字放到画布中，调整位置、大小、旋转和层级。",
      },
      {
        label: "素材库",
        text: "常用图片可以从素材库搜索并加入项目，也可以把自己的透明 PNG 保存到素材库，跨设备继续使用。",
      },
      {
        label: "项目",
        text: "项目会保存在当前设备；需要换设备时，导出项目包，再在另一台设备导入。",
      },
    ],
  },
  {
    id: "quick-start",
    title: "快速开始",
    kicker: "02 · 三步完成一张图",
    summary: "第一次使用时，按“新建项目—添加素材—导出图片”的顺序即可完成基本工作。",
    points: [
      {
        label: "新建项目",
        text: "打开轻设，选择新建项目或打开已有项目；先确定画布尺寸，再添加底图。",
      },
      {
        label: "编辑画面",
        text: "从素材库或设备文件中添加图片；在图层面板调整顺序、显示状态、位置和比例。",
      },
      {
        label: "保存结果",
        text: "项目会保留编辑状态；完成后从导出入口选择 PNG 或 JPG，并选择保存位置。",
      },
    ],
  },
  {
    id: "windows",
    title: "Windows 版",
    kicker: "03 · 鼠标与键盘工作台",
    summary: "Windows 版适合批量导入、桌面文件管理和键盘操作。",
    points: [
      {
        label: "导入",
        text: "可以从文件资源管理器拖入图片，也可以点击导入按钮选择一张或多张图片。",
      },
      {
        label: "选择",
        text: "点击图层或画布对象后再进行移动、缩放、旋转；按住 Shift 可连续选择多个对象。",
      },
      {
        label: "快捷操作",
        text: "使用撤销、重做、复制、删除和项目包导入导出，适合连续处理多张设计图。",
      },
    ],
  },
  {
    id: "macos",
    title: "macOS 版",
    kicker: "04 · 桌面编辑与抠图",
    summary:
      "macOS 版与 Windows 版保持相同的编辑逻辑，并支持 Finder 拖拽；需要批量抠图时使用配套轻抠。",
    points: [
      {
        label: "Finder",
        text: "从 Finder 拖入图片即可添加到当前项目，也可以通过打开文件选择项目包。",
      },
      {
        label: "轻抠",
        text: "需要批量去除背景时，下载并打开轻抠；它只出现在菜单栏/托盘角标，保持运行即可处理素材面板里排队的图片。",
      },
      {
        label: "完成后使用",
        text: "抠图完成的透明图片会回到素材库，可直接添加到项目或导出到 Finder。",
      },
    ],
  },
  {
    id: "ipad",
    title: "iPad 版",
    kicker: "05 · 触控优先",
    summary: "iPad 版把画布留给手势，把素材、图层和项目操作放进抽屉与底部操作栏。",
    points: [
      {
        label: "移动与缩放",
        text: "单指拖动已选对象；双指在空白画布上平移和缩放视图。双指缩放画布不会同时改变多个图层。",
      },
      {
        label: "图层",
        text: "从底部图层入口打开图层抽屉；点选图层后使用隐藏、锁定、复制和删除等操作。",
      },
      { label: "项目操作", text: "底部更多入口包含导入项目、备份项目、重命名以及 PNG/JPG 导出。" },
    ],
  },
  {
    id: "materials",
    title: "使用素材库",
    kicker: "06 · 找到并复用素材",
    summary: "素材库用于保存和复用图片，不需要把素材重复拷贝到每台设备。",
    points: [
      {
        label: "搜索",
        text: "使用名称、编号或标签搜索素材，再按分类筛选；点击素材即可预览，确认后加入画布。",
      },
      {
        label: "保存素材",
        text: "已有透明 PNG 可以直接上传到素材库；普通图片可先经轻抠去除背景，再保存为透明成品。",
      },
      {
        label: "加入项目",
        text: "点击素材卡片上的添加按钮，或将素材拖到画布；已使用过的素材会保留在本机缓存中。",
      },
    ],
  },
  {
    id: "project-export",
    title: "项目与导出",
    kicker: "07 · 交付你的设计",
    summary: "项目文件和导出图片分别服务于继续编辑与最终交付，按用途选择即可。",
    points: [
      {
        label: "项目包",
        text: "导出项目包可以保留图层和编辑状态，适合在 Windows、macOS 和 iPad 之间继续编辑。",
      },
      {
        label: "PNG",
        text: "需要透明背景或继续后期处理时选择 PNG；透明区域和图层效果会被保留在导出结果中。",
      },
      {
        label: "JPG",
        text: "需要通用图片或较小文件时选择 JPG；导出前确认画布背景颜色和最终尺寸。",
      },
    ],
  },
  {
    id: "extension",
    title: "浏览器插件",
    kicker: "08 · 从网页带回素材",
    summary:
      "轻设浏览器插件（配套收集器）可以把 ChatGPT、Gemini 等网页生成的图片整理后带回素材面板。",
    points: [
      {
        label: "扫描",
        text: "打开生成图片的网页，点击插件并扫描；插件会过滤头像、图标和重复图片。",
      },
      {
        label: "下载",
        text: "选择需要的图片后，可以单张下载、批量下载或打包成 ZIP。",
      },
      {
        label: "保存到素材库",
        text: "选择“发送到素材库”，图片会出现在素材入库流程中；透明 PNG 最适合继续编辑。",
      },
    ],
  },
  {
    id: "troubleshooting",
    title: "常见问题",
    kicker: "09 · 快速排查",
    summary: "先判断是项目、素材、触控还是导出问题，再按下面的办法处理。",
    points: [
      {
        label: "素材库没有图片",
        text: "先刷新素材库，再检查搜索词和分类筛选；已经加入项目的图片仍可从本机缓存继续使用。",
      },
      {
        label: "iPad 手势不对",
        text: "单指用于选择或拖动对象，双指用于画布平移和缩放；操作前先点选正确的图层。",
      },
      {
        label: "导出结果不对",
        text: "确认当前选中的是正确项目和图层，并检查导出格式、画布尺寸及背景设置。",
      },
    ],
  },
]

const defaultSection = sections[0] as ManualSection

export function ManualApp() {
  const [activeId, setActiveId] = useState(() => readHash() ?? defaultSection.id)
  const activeSection = useMemo(
    () => sections.find((section) => section.id === activeId) ?? defaultSection,
    [activeId],
  )

  useEffect(() => {
    const onHashChange = () => setActiveId(readHash() ?? defaultSection.id)
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  function selectSection(id: string): void {
    setActiveId(id)
    window.history.replaceState(null, "", `#${id}`)
    document.getElementById(id)?.scrollIntoView({ block: "start" })
  }

  return (
    <main className="manual-shell">
      <header className="manual-mobile-header">
        <div>
          <span className="manual-brand-mark">轻</span>
          <strong>轻设产品说明书</strong>
        </div>
        <label>
          <span className="sr-only">选择主题</span>
          <select value={activeId} onChange={(event) => selectSection(event.currentTarget.value)}>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.title}
              </option>
            ))}
          </select>
        </label>
      </header>
      <aside className="manual-sidebar" aria-label="说明书大纲">
        <div className="manual-sidebar__brand">
          <span className="manual-brand-mark">轻</span>
          <div>
            <strong>轻设</strong>
            <span>产品说明书</span>
          </div>
        </div>
        <nav aria-label="说明书大纲">
          {sections.map((section) => (
            <a
              key={section.id}
              className={section.id === activeId ? "is-active" : ""}
              href={`#${section.id}`}
              onClick={() => setActiveId(section.id)}
            >
              <small>{section.kicker}</small>
              <span>{section.title}</span>
            </a>
          ))}
        </nav>
        <p className="manual-sidebar__note">从开始编辑到导出交付，所有常用操作都可以在这里找到。</p>
      </aside>
      <section className="manual-content" aria-live="polite">
        <header className="manual-content__header">
          <span className="manual-eyebrow">QINGSHE / HANDBOOK</span>
          <h1>轻设产品说明书</h1>
          <p>Windows、macOS、iPad、素材库、项目导出与浏览器插件的完整使用办法。</p>
        </header>
        <div className="manual-sections">
          {sections.map((section) => (
            <article
              id={section.id}
              key={section.id}
              className={section.id === activeSection.id ? "is-active" : ""}
            >
              <div className="manual-section__heading">
                <span>{section.kicker}</span>
                <h2>{section.title}</h2>
                <p>{section.summary}</p>
              </div>
              <dl>
                {section.points.map((point) => (
                  <div key={point.label}>
                    <dt>{point.label}</dt>
                    <dd>{point.text}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
        <footer className="manual-footer">轻设产品说明书 · 版本随应用更新</footer>
      </section>
    </main>
  )
}

function readHash(): string | null {
  const value = window.location.hash.slice(1)
  return sections.some((section) => section.id === value) ? value : null
}
