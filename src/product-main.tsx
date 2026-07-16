import {
  AppleLogo,
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpenText,
  Browser,
  Check,
  CheckCircle,
  CloudArrowUp,
  Command,
  DeviceMobile,
  DownloadSimple,
  Drop,
  Images,
  MagicWand,
  Monitor,
  Package,
  Stack,
  X,
} from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"

import floralAsset from "./features/assets/media/burgundy-autumn-floral.png"
import "./styles/product.css"

type ManualSection = {
  id: string
  title: string
  summary: string
}

type DownloadItem = {
  icon: typeof Monitor
  platform: string
  title: string
  description: string
  meta: string
  href?: string
  secondaryAction?: string
  secondaryHref?: string
  action: string
  available: boolean
}

const manualSections: ManualSection[] = [
  { id: "quick-start", title: "快速开始", summary: "从导入底图到第一次导出的完整路径" },
  { id: "windows", title: "Windows 版", summary: "桌面版安装、项目与快捷操作" },
  { id: "macos", title: "macOS 版", summary: "Mac 工作流与文件导出" },
  { id: "ipad", title: "iPad 版", summary: "触控、双指缩放与移动编辑" },
  { id: "materials", title: "云素材库", summary: "素材搜索、分类和一键入库" },
  { id: "project-export", title: "项目与导出", summary: "项目包、PNG 与跨设备传递" },
  { id: "extension", title: "浏览器插件", summary: "从素材来源快速收集图片" },
  { id: "troubleshooting", title: "问题排查", summary: "常见打不开、导入与导出问题" },
]

const downloads: DownloadItem[] = [
  {
    icon: Monitor,
    platform: "Windows",
    title: "轻设桌面版",
    description: "适合批量导入、整理项目和快速导出的完整工作台。",
    meta: "Windows 10 / 11 · 安装包待上传",
    action: "获取 Windows 安装包",
    available: false,
  },
  {
    icon: AppleLogo,
    platform: "macOS",
    title: "轻设桌面版",
    description: "同一套编辑核心，在 Mac 上保持完整图层与项目能力。",
    meta: "macOS 12+ · Apple silicon",
    href: "/downloads/qingshe-macos-0.1.0-aarch64.dmg",
    action: "下载 macOS 安装包",
    available: true,
  },
  {
    icon: DeviceMobile,
    platform: "iPadOS",
    title: "轻设移动版",
    description: "触控优先的画布操作，随时查看素材和继续项目。",
    meta: "iPadOS 15+ · 通过 Xcode 安装",
    action: "查看 iPad 说明",
    href: "/admin/manual.html#ipad",
    available: true,
  },
  {
    icon: Browser,
    platform: "Browser",
    title: "轻设浏览器插件",
    description: "轻设配套：从 AI 网页收集图片，发送到云素材面板。",
    meta: "Chrome / Edge + Firefox · 0.2.0",
    action: "下载 Chrome / Edge",
    href: "/admin/downloads/qingshe-image-archive-0.2.0-chrome.zip?rev=20260715-full-auto",
    secondaryAction: "下载 Firefox",
    secondaryHref:
      "/admin/downloads/qingshe-image-archive-0.2.0-firefox.xpi?rev=20260715-full-auto",
    available: true,
  },
]

function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.12 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className={`product-reveal ${visible ? "is-visible" : ""} ${className}`}>
      {children}
    </div>
  )
}

function ProductDemo() {
  return (
    <section className="product-demo" aria-label="轻设编辑器界面演示">
      <div className="demo-titlebar">
        <div className="demo-window-controls" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <span>轻设</span>
        <span className="demo-project-name">未命名设计</span>
        <span className="demo-saved">已自动保存</span>
      </div>
      <div className="demo-workspace">
        <aside className="demo-assets">
          <div className="demo-panel-heading">
            <Images size={16} />
            <span>素材</span>
          </div>
          <div className="demo-search">名称 / 编号 / 标签</div>
          <div className="demo-asset-list">
            <div className="demo-asset selected">
              <img src={floralAsset} alt="透明花材素材" />
              <span>红棕花材</span>
            </div>
            <div className="demo-asset demo-asset-empty">
              <span>+</span>
              <small>导入素材</small>
            </div>
          </div>
        </aside>
        <main className="demo-stage">
          <div className="demo-stage-toolbar">
            <span>画布 1200 × 800</span>
            <span>100%</span>
          </div>
          <div className="demo-canvas">
            <div className="demo-paper">
              <div className="demo-photo" />
              <img className="demo-floral" src={floralAsset} alt="花材图层预览" />
              <div className="demo-selection" aria-hidden="true">
                <b />
                <b />
                <b />
                <b />
                <span>花材 · 100%</span>
              </div>
            </div>
          </div>
        </main>
        <aside className="demo-inspector">
          <div className="demo-panel-heading">
            <Stack size={16} />
            <span>属性</span>
          </div>
          <div className="demo-field-group">
            <span>位置</span>
            <div className="demo-fields">
              <em>X 420</em>
              <em>Y 286</em>
            </div>
          </div>
          <div className="demo-field-group">
            <span>尺寸</span>
            <div className="demo-fields">
              <em>W 312</em>
              <em>H 248</em>
            </div>
          </div>
          <div className="demo-layer-row">
            <span className="demo-layer-dot" />
            花材 <small>可见</small>
          </div>
          <div className="demo-layer-row muted">
            <span className="demo-layer-dot" />
            背景照片
          </div>
        </aside>
      </div>
      <div className="demo-statusbar">
        <span>
          <CheckCircle size={14} weight="fill" />
          本地项目已保存
        </span>
        <span>⌘ / Ctrl + S</span>
      </div>
    </section>
  )
}

function ManualDrawer({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  return (
    <div className="manual-overlay" role="presentation">
      <aside
        className="manual-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-title"
      >
        <header className="manual-drawer-header">
          <div>
            <span className="eyebrow">轻设说明书</span>
            <h2 id="manual-title">从第一次导入，到完整交付</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭说明书" onClick={onClose}>
            <X size={22} />
          </button>
        </header>
        <div className="manual-drawer-scroll">
          <p className="manual-lead">
            按设备和工作阶段查找操作方法。网页说明书与应用版本同步更新。
          </p>
          <nav className="manual-list" aria-label="说明书章节">
            {manualSections.map((section) => (
              <a key={section.id} href={`/admin/manual.html#${section.id}`} onClick={onClose}>
                <span>
                  <strong>{section.title}</strong>
                  <small>{section.summary}</small>
                </span>
                <ArrowUpRight size={16} />
              </a>
            ))}
          </nav>
        </div>
        <footer className="manual-drawer-footer">
          <a className="text-link" href="/admin/manual.html">
            打开完整说明书 <ArrowRight size={16} />
          </a>
        </footer>
      </aside>
    </div>
  )
}

function ProductPage() {
  const [manualOpen, setManualOpen] = useState(false)
  const [activeNav, setActiveNav] = useState("overview")

  useEffect(() => {
    const sections = ["overview", "capabilities", "workflow", "downloads"]
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => section !== null)
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible?.target.id) setActiveNav(visible.target.id)
      },
      { rootMargin: "-18% 0px -65%", threshold: [0.12, 0.28, 0.56] },
    )
    sections.forEach((section) => {
      observer.observe(section)
    })
    return () => observer.disconnect()
  }, [])

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div className="product-site">
      <header className="product-nav">
        <a className="brand-lockup" href="#overview" aria-label="轻设首页">
          <span className="brand-mark">轻</span>
          <span>
            <strong>轻设</strong>
            <small>IMAGE WORKSPACE</small>
          </span>
        </a>
        <nav className="product-nav-links" aria-label="产品导航">
          {[
            { id: "overview", label: "概览" },
            { id: "capabilities", label: "能力" },
            { id: "workflow", label: "工作流" },
            { id: "downloads", label: "下载" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              className={activeNav === item.id ? "active" : ""}
              onClick={() => scrollTo(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="product-nav-actions">
          <button className="nav-manual-button" type="button" onClick={() => setManualOpen(true)}>
            <BookOpenText size={16} />
            说明书
          </button>
          <a className="nav-primary-button" href="#downloads">
            下载轻设 <ArrowDown size={16} />
          </a>
        </div>
      </header>

      <main>
        <section id="overview" className="product-hero section-anchor">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="status-dot" />
              轻设 · 图片合成工作台
            </p>
            <h1>让照片、素材与导出，回到同一个安静的工作台。</h1>
            <p className="hero-description">
              轻设把底图、透明素材、图层和项目文件放进一条清晰的创作路径。少一点寻找，多一点完成。
            </p>
            <div className="hero-actions">
              <button
                className="button-primary"
                type="button"
                onClick={() => scrollTo("downloads")}
              >
                <DownloadSimple size={18} />
                获取桌面版
              </button>
              <button
                className="button-secondary"
                type="button"
                onClick={() => setManualOpen(true)}
              >
                <BookOpenText size={18} />
                查看说明书
              </button>
            </div>
            <div className="hero-meta">
              <span>
                <Check size={14} />
                本地编辑，项目随时可导出
              </span>
              <span>
                <Check size={14} />
                Windows · macOS · iPad · 网页素材库
              </span>
            </div>
          </div>
          <Reveal className="hero-demo-wrap">
            <ProductDemo />
          </Reveal>
          <button
            className="scroll-cue"
            type="button"
            onClick={() => scrollTo("capabilities")}
            aria-label="查看产品能力"
          >
            <span>向下查看</span>
            <ArrowDown size={16} />
          </button>
        </section>

        <section id="capabilities" className="product-section section-anchor">
          <Reveal className="section-heading-row">
            <div>
              <p className="eyebrow">01 / 核心能力</p>
              <h2>把每一步都放在眼前。</h2>
            </div>
            <p>从素材进入画布开始，轻设只保留真正需要的操作。面板、图层和导出都遵循同一套逻辑。</p>
          </Reveal>
          <div className="capability-grid">
            {[
              {
                icon: Images,
                number: "01",
                title: "照片与透明素材",
                description: "拖入底图，直接从云素材库搜索、预览并添加透明 PNG。",
              },
              {
                icon: Stack,
                number: "02",
                title: "清晰的图层关系",
                description: "每个元素都可独立选择、移动、缩放和排序，减少误操作。",
              },
              {
                icon: CloudArrowUp,
                number: "03",
                title: "云素材一处维护",
                description: "素材统一存放在云端，编辑器、面板和插件使用同一套目录。",
              },
              {
                icon: ArrowUpRight,
                number: "04",
                title: "项目与成品导出",
                description: "保留可继续编辑的项目包，也能快速导出 PNG 成品交付。",
              },
            ].map((feature) => (
              <Reveal key={feature.number} className="capability-card">
                <div className="capability-icon">
                  <feature.icon size={22} />
                </div>
                <span className="capability-number">{feature.number}</span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
                <ArrowRight className="capability-arrow" size={18} />
              </Reveal>
            ))}
          </div>
        </section>

        <section id="workflow" className="product-section workflow-section section-anchor">
          <Reveal className="section-heading-row">
            <div>
              <p className="eyebrow">02 / 工作流</p>
              <h2>从第一张照片，到可交付成品。</h2>
            </div>
            <p>不需要在多个工具之间反复搬运。你可以在一个项目里完成组合、调整、复用和导出。</p>
          </Reveal>
          <div className="workflow-layout">
            <div className="workflow-rail" aria-hidden="true">
              <span className="workflow-line" />
              <span className="workflow-progress" />
            </div>
            <div className="workflow-steps">
              {[
                {
                  icon: Drop,
                  step: "导入",
                  title: "先把底图放进来",
                  copy: "选择照片或背景图，轻设会自动建立一个可编辑项目。",
                },
                {
                  icon: Stack,
                  step: "组合",
                  title: "从云素材库添加元素",
                  copy: "按分类、名称或标签查找素材，点击一次即可放入画布。",
                },
                {
                  icon: MagicWand,
                  step: "调整",
                  title: "只操作当前图层",
                  copy: "触控或鼠标都能精确选择，双指缩放只作用于当前素材。",
                },
                {
                  icon: Package,
                  step: "交付",
                  title: "导出成品或项目包",
                  copy: "PNG 用于直接交付，项目包用于跨设备继续编辑。",
                },
              ].map((item, index) => (
                <Reveal key={item.step} className="workflow-step">
                  <div className="workflow-step-index">0{index + 1}</div>
                  <div className="workflow-step-icon">
                    <item.icon size={20} />
                  </div>
                  <div>
                    <span className="workflow-step-label">{item.step}</span>
                    <h3>{item.title}</h3>
                    <p>{item.copy}</p>
                  </div>
                </Reveal>
              ))}
            </div>
            <div className="workflow-note">
              <div className="workflow-note-top">
                <Command size={18} />
                <span>快捷路径</span>
              </div>
              <strong>⌘ / Ctrl + S</strong>
              <span>保存项目</span>
              <strong>⌘ / Ctrl + Z</strong>
              <span>撤销操作</span>
              <strong>双指拖动</strong>
              <span>移动画布</span>
            </div>
          </div>
        </section>

        <section className="platform-section product-section">
          <Reveal className="platform-banner">
            <div>
              <p className="eyebrow">03 / 一套核心，多端使用</p>
              <h2>在你习惯的设备上继续。</h2>
              <p>
                桌面端负责完整编辑，iPad
                负责移动创作，云素材库负责统一管理。项目文件和素材不会被平台锁住。
              </p>
            </div>
            <div className="platform-stamp">
              <Monitor size={20} />
              <AppleLogo size={20} />
              <DeviceMobile size={20} />
              <CloudArrowUp size={20} />
            </div>
          </Reveal>
          <div className="platform-grid">
            <div>
              <strong>桌面端</strong>
              <span>Windows / macOS</span>
              <small>完整画布、项目与导出能力</small>
            </div>
            <div>
              <strong>移动端</strong>
              <span>iPadOS</span>
              <small>触控操作与随身查看</small>
            </div>
            <div>
              <strong>云端</strong>
              <span>assets.xiduoduo.top</span>
              <small>素材库、插件与成品入库</small>
            </div>
          </div>
        </section>

        <section id="downloads" className="product-section downloads-section section-anchor">
          <Reveal className="section-heading-row">
            <div>
              <p className="eyebrow">04 / 开始使用</p>
              <h2>选择你的工作方式。</h2>
            </div>
            <p>桌面安装包、移动端说明和浏览器插件集中在这里。安装包更新后会在同一位置替换。</p>
          </Reveal>
          <div className="download-grid">
            {downloads.map((item) => (
              <Reveal
                key={item.platform}
                className={`download-card ${item.available ? "available" : "pending"}`}
              >
                <div className="download-card-top">
                  <item.icon size={24} />
                  <span>{item.platform}</span>
                  {item.available && (
                    <CheckCircle className="download-check" size={16} weight="fill" />
                  )}
                </div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                <small>{item.meta}</small>
                {item.available && item.href ? (
                  <div className="download-actions">
                    <a className="download-action" href={item.href}>
                      <span>{item.action}</span>
                      <DownloadSimple size={17} />
                    </a>
                    {item.secondaryHref !== undefined && item.secondaryAction !== undefined && (
                      <a className="download-action" href={item.secondaryHref}>
                        <span>{item.secondaryAction}</span>
                        <DownloadSimple size={17} />
                      </a>
                    )}
                  </div>
                ) : (
                  <button className="download-action" type="button" disabled>
                    <span>{item.action}</span>
                    <ArrowRight size={17} />
                  </button>
                )}
              </Reveal>
            ))}
          </div>
          <Reveal className="download-footnote">
            <CheckCircle size={16} />
            <span>
              所有网页服务统一使用 <strong>assets.xiduoduo.top</strong>；根域名 xiduoduo.top
              仍是婚庆网站首页。
            </span>
          </Reveal>
        </section>

        <section className="manual-callout product-section">
          <Reveal className="manual-callout-inner">
            <div className="manual-callout-icon">
              <BookOpenText size={28} />
            </div>
            <div>
              <p className="eyebrow">完整说明书</p>
              <h2>需要一步一步的操作说明？</h2>
              <p>
                从安装、导入、素材管理到 iPad 触控，我们把常用路径整理成一份可搜索的网页说明书。
              </p>
            </div>
            <button className="button-primary" type="button" onClick={() => setManualOpen(true)}>
              打开说明书 <ArrowRight size={18} />
            </button>
          </Reveal>
        </section>
      </main>

      <footer className="product-footer">
        <div className="footer-brand">
          <span className="brand-mark">轻</span>
          <div>
            <strong>轻设</strong>
            <small>IMAGE WORKSPACE</small>
          </div>
        </div>
        <div className="footer-links">
          <a href="#overview">产品概览</a>
          <a href="#downloads">下载</a>
          <button type="button" onClick={() => setManualOpen(true)}>
            说明书
          </button>
          <a href="/admin/asset-admin.html">
            云素材面板 <ArrowUpRight size={14} />
          </a>
        </div>
        <span className="footer-copy">© 2026 轻设</span>
      </footer>

      {manualOpen && <ManualDrawer onClose={() => setManualOpen(false)} />}
    </div>
  )
}

const root = document.getElementById("product-root")
if (root !== null) createRoot(root).render(<ProductPage />)
