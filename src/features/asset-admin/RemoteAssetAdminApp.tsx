import {
  ArrowClockwise,
  CloudArrowUp,
  Cpu,
  DownloadSimple,
  Laptop,
  Play,
  SignOut,
  UploadSimple,
  X,
} from "@phosphor-icons/react"
import { useCallback, useEffect, useRef, useState } from "react"

import { ASSET_CATEGORIES, type AssetCategory } from "../assets/demo-assets"
import { CloudOperationsPanel } from "./CloudOperationsPanel"
import { splitProcessingTasks } from "./processing-task-summary"
import {
  approveRemoteAsset,
  buildExtensionPairingMessage,
  buildProcessorLaunchUrl,
  createProcessedAsset,
  createRemoteProcessingTask,
  ensureProcessorPanelClientId,
  extensionPairingRequested,
  isRemoteAdminAuthError,
  loginRemoteAssetAdmin,
  logoutRemoteAssetAdmin,
  pairRemoteExtensionDevice,
  processingAgentDownloadUrl,
  processingNodePlatformLabel,
  type RemotePendingReviewAsset,
  type RemoteProcessingDashboard,
  readRemoteProcessingDashboard,
  selectLocalProcessingNode,
} from "./remote-processing-client"

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp"

type StagedExtensionFile = {
  readonly id: string
  readonly file: File
  readonly preview: string
}

type ReviewItem = {
  readonly reviewKey: string
  readonly asset_id: string
  readonly name: string
  readonly category: string
}

function fileFromExtensionMessage(value: unknown): StagedExtensionFile | null {
  if (typeof value !== "object" || value === null) return null
  const payload = value as { name?: unknown; type?: unknown; dataUrl?: unknown }
  if (
    typeof payload.name !== "string" ||
    typeof payload.type !== "string" ||
    typeof payload.dataUrl !== "string" ||
    !payload.dataUrl.startsWith("data:")
  ) {
    return null
  }
  const comma = payload.dataUrl.indexOf(",")
  if (comma < 0) return null
  try {
    const bytes = Uint8Array.from(atob(payload.dataUrl.slice(comma + 1)), (character) =>
      character.charCodeAt(0),
    )
    return {
      id: crypto.randomUUID(),
      file: new File([bytes], payload.name, { type: payload.type }),
      preview: payload.dataUrl,
    }
  } catch {
    return null
  }
}

export function RemoteAssetAdminApp() {
  const inputRef = useRef<HTMLInputElement>(null)
  const processedInputRef = useRef<HTMLInputElement>(null)
  const ingestionRef = useRef<HTMLElement>(null)
  const extensionPairing = useRef(extensionPairingRequested(window.location.search)).current
  const [processorClientId] = useState(() => ensureProcessorPanelClientId())
  const [dashboard, setDashboard] = useState<RemoteProcessingDashboard | null>(null)
  const [authState, setAuthState] = useState<"checking" | "signed-out" | "signed-in">("checking")
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const [category, setCategory] = useState<AssetCategory | "">("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("把素材放进云库。需要抠图时，本机轻抠会自动处理。")
  const [stagedExtensionFiles, setStagedExtensionFiles] = useState<StagedExtensionFile[]>([])
  const [reviewCategories, setReviewCategories] = useState<Readonly<Record<string, AssetCategory>>>(
    {},
  )
  const [extensionPairingState, setExtensionPairingState] = useState<
    "idle" | "busy" | "complete" | "error"
  >("idle")
  const [processorLaunchState, setProcessorLaunchState] = useState<
    "idle" | "launching" | "connected" | "missing"
  >("idle")

  const refresh = useCallback(async () => {
    try {
      setDashboard(await readRemoteProcessingDashboard())
      setAuthState("signed-in")
      setAuthMessage(null)
    } catch (error) {
      if (isRemoteAdminAuthError(error)) {
        setAuthState("signed-out")
        setDashboard(null)
        setAuthMessage("云端连接正常，请输入管理台账号密码。")
        return
      }
      // A transient API/configuration failure must not leave the login form
      // permanently disabled behind the initial "checking" state.
      setAuthState("signed-out")
      setDashboard(null)
      const detail = error instanceof Error ? error.message : "云端处理状态暂时不可读取"
      setAuthMessage(`云端连接失败：${detail}`)
      setMessage(detail)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (authState !== "checking") return
    // A network path or a stale service worker must never leave the form
    // permanently disabled. The login request itself remains available after
    // this short health-check grace period.
    const timer = window.setTimeout(() => {
      setAuthState((current) => (current === "checking" ? "signed-out" : current))
      setAuthMessage((current) => current ?? "云端连接超时，请直接输入账号密码登录。")
    }, 7_000)
    return () => window.clearTimeout(timer)
  }, [authState])

  useEffect(() => {
    if (authState !== "signed-in") return
    const timer = window.setInterval(() => void refresh(), 5_000)
    return () => window.clearInterval(timer)
  }, [authState, refresh])

  const localProcessor = selectLocalProcessingNode(dashboard?.nodes ?? [], processorClientId)

  useEffect(() => {
    if (localProcessor?.status === "online") setProcessorLaunchState("connected")
  }, [localProcessor?.status])

  useEffect(() => {
    if (processorLaunchState !== "launching") return
    const poll = window.setInterval(() => void refresh(), 1_000)
    const timeout = window.setTimeout(() => setProcessorLaunchState("missing"), 10_000)
    return () => {
      window.clearInterval(poll)
      window.clearTimeout(timeout)
    }
  }, [processorLaunchState, refresh])

  useEffect(() => {
    const onExtensionUpload = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin ||
        typeof event.data !== "object" ||
        event.data === null
      )
        return
      const payload = event.data as { source?: unknown; type?: unknown; file?: unknown }
      if (payload.source !== "qingshe-extension" || payload.type !== "qingshe-extension-upload")
        return
      const stagedFile = fileFromExtensionMessage(payload.file)
      if (stagedFile === null) {
        setMessage("插件传入的图片无效，请重新发送。")
        return
      }
      setStagedExtensionFiles((current) => [...current, stagedFile])
      setMessage(`已从浏览器插件接收：${stagedFile.file.name}，确认后开始抠图。`)
    }
    window.addEventListener("message", onExtensionUpload)
    window.postMessage(
      { source: "qingshe-panel", type: "qingshe-extension-ready" },
      window.location.origin,
    )
    return () => window.removeEventListener("message", onExtensionUpload)
  }, [])

  useEffect(() => {
    if (authState !== "signed-in" || stagedExtensionFiles.length === 0) return
    window.requestAnimationFrame(() =>
      ingestionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    )
  }, [authState, stagedExtensionFiles.length])

  async function uploadForRemoval(files: FileList | null): Promise<void> {
    if (files === null || files.length === 0) return
    const pendingFiles = Array.from(files)
    const hasOnlineProcessor = (dashboard?.nodes ?? []).some((node) => node.status === "online")
    setBusy(true)
    let succeeded = 0
    try {
      for (const file of pendingFiles) {
        await createRemoteProcessingTask(file, category)
        succeeded += 1
        setMessage(`已创建 ${succeeded} / ${pendingFiles.length} 个入库任务。`)
      }
      await refresh()
      if (!hasOnlineProcessor) {
        setMessage(`已创建 ${succeeded} 个入库任务。轻抠未在线，启动本机轻抠后会自动处理。`)
      }
    } catch (error) {
      setMessage(error instanceof Error ? `任务提交失败：${error.message}` : "任务提交失败")
    } finally {
      setBusy(false)
    }
  }

  async function uploadProcessed(files: FileList | null): Promise<void> {
    if (files === null || files.length === 0) return
    const pendingFiles = Array.from(files)
    setBusy(true)
    let succeeded = 0
    try {
      for (const file of pendingFiles) {
        await createProcessedAsset(file, category)
        succeeded += 1
        setMessage(`已直接入库 ${succeeded} / ${pendingFiles.length} 个透明 PNG 成品。`)
      }
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? `成品入库失败：${error.message}` : "成品入库失败")
    } finally {
      setBusy(false)
    }
  }

  async function confirmStagedExtensionFiles(): Promise<void> {
    if (stagedExtensionFiles.length === 0) return
    const pending = stagedExtensionFiles
    const completed = new Set<string>()
    setBusy(true)
    try {
      for (const item of pending) {
        try {
          await createRemoteProcessingTask(item.file, category)
          completed.add(item.id)
          setMessage(`已创建 ${completed.size} / ${pending.length} 个入库任务。`)
        } catch (error) {
          setMessage(error instanceof Error ? `任务提交失败：${error.message}` : "任务提交失败")
        }
      }
      setStagedExtensionFiles((current) => current.filter((item) => !completed.has(item.id)))
      if (completed.size > 0) await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function confirmReview(task: ReviewItem): Promise<void> {
    const category = reviewCategories[task.reviewKey] ?? readTaskCategory(task.category)
    setBusy(true)
    try {
      await approveRemoteAsset(task.asset_id, category)
      setMessage(`已确认入库：${task.name}`)
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? `确认入库失败：${error.message}` : "确认入库失败")
    } finally {
      setBusy(false)
    }
  }

  async function confirmExtensionPairing(): Promise<void> {
    if (!extensionPairing || extensionPairingState === "busy") return
    setExtensionPairingState("busy")
    try {
      const platform = navigator.userAgent.includes("Firefox") ? "firefox" : "chrome"
      const paired = await pairRemoteExtensionDevice(
        `${platform === "firefox" ? "Firefox" : "Chrome"} on ${navigator.platform || "Desktop"}`,
        platform,
      )
      window.postMessage(buildExtensionPairingMessage(paired), window.location.origin)
      setExtensionPairingState("complete")
      setMessage("浏览器插件已连接，可以回到插件开始全自动任务。")
      window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`)
      await refresh()
    } catch (error) {
      setExtensionPairingState("error")
      setMessage(
        error instanceof Error ? `浏览器插件连接失败：${error.message}` : "浏览器插件连接失败",
      )
    }
  }

  function launchLocalProcessor(): void {
    setProcessorLaunchState("launching")
    setMessage("正在检查并启动此电脑的轻抠…")
    window.location.href = buildProcessorLaunchUrl(processorClientId)
  }

  async function logout(): Promise<void> {
    setBusy(true)
    try {
      await logoutRemoteAssetAdmin()
      setAuthMessage("已退出登录")
    } catch (error) {
      setAuthMessage(error instanceof Error ? `退出登录失败：${error.message}` : "退出登录失败")
    } finally {
      setDashboard(null)
      setAuthState("signed-out")
      setBusy(false)
    }
  }

  if (authState !== "signed-in") {
    return (
      <AssetAdminLogin
        checking={authState === "checking"}
        statusMessage={authMessage}
        onLoggedIn={() => void refresh()}
      />
    )
  }

  const taskSummary = splitProcessingTasks(dashboard?.tasks ?? [])
  const reviewTaskItems: ReviewItem[] =
    dashboard?.tasks
      .filter((task) => task.status === "ready" && task.asset_id !== null && task.needs_review)
      .map((task) => ({
        reviewKey: task.id,
        asset_id: task.asset_id as string,
        name: task.name,
        category: task.category,
      })) ?? []
  const pendingReviewItems: ReviewItem[] =
    dashboard?.pending_review_assets.map((asset: RemotePendingReviewAsset) => ({
      reviewKey: `asset:${asset.id}`,
      asset_id: asset.id,
      name: asset.name,
      category: asset.category,
    })) ?? []
  const reviewTasks = [...reviewTaskItems, ...pendingReviewItems].filter(
    (item, index, items) =>
      items.findIndex((candidate) => candidate.asset_id === item.asset_id) === index,
  )
  const readyAssets = new Set([
    ...(dashboard?.tasks.flatMap((task) => (task.asset_id === null ? [] : [task.asset_id])) ?? []),
    ...(dashboard?.pending_review_assets.map((asset) => asset.id) ?? []),
  ]).size
  const processingNodes = dashboard?.nodes ?? []
  const onlineProcessingNodes = processingNodes.filter((node) => node.status === "online")
  const localProcessorIsOnline = localProcessor?.status === "online"
  const firstExtensionDevice = dashboard?.extension_devices[0]
  const latestAutomationRun = dashboard?.automation_runs[0]

  return (
    <main className="material-panel">
      <header className="material-panel__topbar">
        <div className="material-panel__identity">
          <strong>轻设</strong>
          <span aria-hidden="true" />
          <h1>素材面板</h1>
        </div>
        <div className="material-panel__topbar-actions">
          <span className="material-panel__connection">
            <i aria-hidden="true" />
            云端已连接
          </span>
          <button
            className="material-panel__icon-button"
            type="button"
            title="刷新素材状态"
            aria-label="刷新素材状态"
            onClick={() => void refresh()}
          >
            <ArrowClockwise size={18} aria-hidden="true" />
          </button>
          <button
            className="material-panel__icon-button"
            type="button"
            title="退出登录"
            aria-label="退出登录"
            disabled={busy}
            onClick={() => void logout()}
          >
            <SignOut size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <section className="material-panel__summary" aria-label="素材概览">
        <article>
          <span>已入库</span>
          <strong>{readyAssets}</strong>
        </article>
        <article>
          <span>处理中</span>
          <strong>{taskSummary.active.length}</strong>
        </article>
        <article className={reviewTasks.length > 0 ? "needs-attention" : ""}>
          <span>待检查</span>
          <strong>{reviewTasks.length}</strong>
        </article>
        <article className={localProcessorIsOnline ? "is-online" : "is-offline"}>
          <span>此电脑轻抠</span>
          <strong>{localProcessorIsOnline ? "在线" : "未连接"}</strong>
        </article>
      </section>

      <div className="material-panel__primary-grid">
        <section
          ref={ingestionRef}
          className="material-panel__section material-panel__ingest"
          aria-labelledby="remote-ingestion-title"
        >
          <header className="material-panel__section-header">
            <div>
              <span>01</span>
              <h2 id="remote-ingestion-title">把素材放进云库</h2>
            </div>
            <p>上传原图交给轻抠处理，或直接上传透明 PNG。</p>
          </header>
          <div className="material-panel__section-body">
            {extensionPairing && extensionPairingState !== "complete" && (
              <section
                className="material-panel__callout"
                aria-labelledby="extension-pairing-title"
              >
                <div>
                  <h3 id="extension-pairing-title">连接浏览器插件</h3>
                  <p>插件只会获得创建和查看自身任务的权限。</p>
                </div>
                <button
                  className="material-panel__button is-primary"
                  type="button"
                  disabled={extensionPairingState === "busy"}
                  onClick={() => void confirmExtensionPairing()}
                >
                  {extensionPairingState === "busy" ? "正在连接…" : "确认连接浏览器插件"}
                </button>
              </section>
            )}

            {stagedExtensionFiles.length > 0 && (
              <section className="material-panel__staged" aria-labelledby="extension-stage-title">
                <header>
                  <h3 id="extension-stage-title">插件待上传 · {stagedExtensionFiles.length} 张</h3>
                  <button type="button" disabled={busy} onClick={() => setStagedExtensionFiles([])}>
                    清空
                  </button>
                </header>
                <ul>
                  {stagedExtensionFiles.map((item) => (
                    <li key={item.id}>
                      <img src={item.preview} alt="" />
                      <span title={item.file.name}>{item.file.name}</span>
                      <button
                        type="button"
                        aria-label={`移除 ${item.file.name}`}
                        disabled={busy}
                        onClick={() =>
                          setStagedExtensionFiles((current) =>
                            current.filter((candidate) => candidate.id !== item.id),
                          )
                        }
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  className="material-panel__button is-primary"
                  type="button"
                  disabled={busy}
                  onClick={() => void confirmStagedExtensionFiles()}
                >
                  <UploadSimple size={18} aria-hidden="true" />
                  {busy ? "正在创建任务…" : "确认上传并抠图"}
                </button>
              </section>
            )}

            <label className="material-panel__category">
              <span>素材分类</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.currentTarget.value as AssetCategory | "")}
              >
                <option value="">自动识别（推荐）</option>
                {ASSET_CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <small>选择分类会覆盖自动识别结果。</small>
            </label>

            <div className="material-panel__upload-actions">
              <button
                className="material-panel__button is-primary"
                type="button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                <UploadSimple size={19} aria-hidden="true" />
                {busy ? "正在创建任务…" : "上传原图并抠图"}
              </button>
              <button
                className="material-panel__button"
                type="button"
                disabled={busy}
                onClick={() => processedInputRef.current?.click()}
              >
                <CloudArrowUp size={18} aria-hidden="true" />
                上传透明 PNG 成品
              </button>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={IMAGE_ACCEPT}
              multiple
              hidden
              onChange={(event) => {
                void uploadForRemoval(event.currentTarget.files)
                event.currentTarget.value = ""
              }}
            />
            <input
              ref={processedInputRef}
              type="file"
              accept="image/png"
              multiple
              hidden
              onChange={(event) => {
                void uploadProcessed(event.currentTarget.files)
                event.currentTarget.value = ""
              }}
            />
            <p className="material-panel__notice" role="status">
              {message}
            </p>
          </div>
        </section>

        <section
          className="material-panel__section material-panel__local-processor"
          aria-labelledby="local-processor-title"
        >
          <header className="material-panel__section-header">
            <div>
              <span>02</span>
              <h2 id="local-processor-title">此电脑轻抠</h2>
            </div>
            <p>启动后自动领取等待中的抠图任务。</p>
          </header>
          <div className="material-panel__section-body">
            <button
              type="button"
              className="material-panel__processor-control"
              aria-label="检查并启动此电脑轻抠"
              title="点击或双击检查并启动轻抠"
              onClick={launchLocalProcessor}
            >
              <div className="material-panel__processor-icon" aria-hidden="true">
                <Laptop size={22} />
              </div>
              <div>
                <strong>{localProcessorIsOnline ? "已连接" : "未连接"}</strong>
                <span>
                  {localProcessorIsOnline
                    ? `${localProcessor.name} · ${processingNodePlatformLabel(localProcessor.platform)}`
                    : processorLaunchState === "launching"
                      ? "正在检查是否已安装并启动…"
                      : processorLaunchState === "missing"
                        ? "此电脑还没下载轻抠"
                        : processingNodes.length > 0
                          ? "其他电脑在线，此电脑尚未关联"
                          : "双击这里检查并启动"}
                </span>
              </div>
            </button>
            <button
              className="material-panel__button is-primary"
              type="button"
              onClick={launchLocalProcessor}
            >
              <Play size={17} aria-hidden="true" />
              {localProcessorIsOnline ? "打开轻抠" : "检测并启动"}
            </button>
            {!localProcessorIsOnline && (
              <a className="material-panel__text-link" href={processingAgentDownloadUrl()} download>
                <DownloadSimple size={16} aria-hidden="true" />
                下载此电脑版本
              </a>
            )}
            <p className="material-panel__processor-note">
              {localProcessorIsOnline
                ? "轻抠正在后台运行，可以直接上传原图。"
                : onlineProcessingNodes.length > 0
                  ? `另有 ${onlineProcessingNodes.length} 台电脑在线，仍可继续处理任务。`
                  : "轻抠未在线时，上传的原图会保留在队列中。"}
            </p>
            {processorLaunchState === "missing" && (
              <p className="material-panel__warning" role="status">
                未收到此电脑轻抠的连接，请先下载安装。
              </p>
            )}
          </div>
        </section>
      </div>

      <section className="material-panel__workflow" aria-label="素材处理流程">
        <section className="material-panel__section" aria-labelledby="review-tasks-title">
          <header className="material-panel__section-header is-compact">
            <div>
              <span>03</span>
              <h2 id="review-tasks-title">待检查</h2>
            </div>
            <strong>{reviewTasks.length}</strong>
          </header>
          <div className="material-panel__list-body">
            {reviewTasks.length === 0 ? (
              <p className="material-panel__empty">暂无待检查素材</p>
            ) : (
              reviewTasks.map((task) => {
                const selectedCategory =
                  reviewCategories[task.reviewKey] ?? readTaskCategory(task.category)
                return (
                  <div className="material-panel__review-row" key={task.reviewKey}>
                    <span>
                      <strong>{task.name}</strong>
                      <small>当前分类：{task.category}</small>
                    </span>
                    <label>
                      <span className="sr-only">{task.name} 分类</span>
                      <select
                        aria-label={`${task.name} 分类`}
                        value={selectedCategory}
                        onChange={(event) => {
                          const nextCategory = readTaskCategory(event.currentTarget.value)
                          setReviewCategories((current) => ({
                            ...current,
                            [task.reviewKey]: nextCategory,
                          }))
                        }}
                      >
                        {ASSET_CATEGORIES.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="material-panel__button"
                      type="button"
                      disabled={busy}
                      onClick={() => void confirmReview(task)}
                    >
                      确认入库
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </section>

        <section className="material-panel__section" aria-labelledby="processing-tasks-title">
          <header className="material-panel__section-header is-compact">
            <div>
              <span>04</span>
              <h2 id="processing-tasks-title">处理队列</h2>
            </div>
            <strong>{taskSummary.active.length}</strong>
          </header>
          <div className="material-panel__list-body">
            {taskSummary.active.length === 0 ? (
              <p className="material-panel__empty">暂无处理中的任务</p>
            ) : (
              taskSummary.active.map((task) => (
                <div className="material-panel__task-row" key={task.id}>
                  <span>
                    <strong>{task.name}</strong>
                    <small>{task.category}</small>
                  </span>
                  <em>{task.status === "pending" ? "等待轻抠" : "正在抠图"}</em>
                </div>
              ))
            )}
            {taskSummary.recent.length > 0 && (
              <details className="material-panel__recent">
                <summary>最近完成 {taskSummary.recent.length} 个</summary>
                {taskSummary.recent.map((task) => (
                  <div key={task.id}>{task.name} · 已入库</div>
                ))}
              </details>
            )}
          </div>
        </section>
      </section>

      <section
        className="material-panel__section material-panel__tools"
        aria-labelledby="companion-tools-title"
      >
        <header className="material-panel__section-header">
          <div>
            <span>05</span>
            <h2 id="companion-tools-title">配套工具</h2>
          </div>
          <p>查看全部轻抠和浏览器插件的连接状态。</p>
        </header>
        <div className="material-panel__tools-grid">
          <article className="material-panel__tool material-panel__processors">
            <header>
              <div>
                <Cpu size={18} aria-hidden="true" />
                <h3>全部轻抠</h3>
              </div>
              <span>{processingNodes.length} 台</span>
            </header>
            {processingNodes.length === 0 ? (
              <p className="material-panel__empty">还没有电脑上报轻抠</p>
            ) : (
              <ul>
                {processingNodes.map((node) => {
                  const isLocal = node.client_id === processorClientId
                  return (
                    <li key={node.id}>
                      <span>
                        <strong>{node.name}</strong>
                        <small>
                          {isLocal ? "此电脑" : "其他电脑"} ·{" "}
                          {processingNodePlatformLabel(node.platform)}
                        </small>
                      </span>
                      <em className={node.status === "online" ? "is-online" : "is-offline"}>
                        {node.status === "online" ? "在线" : "离线"}
                      </em>
                    </li>
                  )
                })}
              </ul>
            )}
          </article>

          <article className="material-panel__tool" aria-labelledby="extension-automation-title">
            <header>
              <div>
                <CloudArrowUp size={18} aria-hidden="true" />
                <h3 id="extension-automation-title">浏览器插件</h3>
              </div>
              <em
                className={firstExtensionDevice?.status === "online" ? "is-online" : "is-offline"}
              >
                {firstExtensionDevice?.status === "online" ? "在线" : "未连接"}
              </em>
            </header>
            {firstExtensionDevice !== undefined && (
              <p className="material-panel__device-name">{firstExtensionDevice.name}</p>
            )}
            {latestAutomationRun === undefined ? (
              <p className="material-panel__empty">尚未运行全自动任务</p>
            ) : (
              <div className="material-panel__automation-run">
                <span>
                  <strong>{latestAutomationRun.prompt}</strong>
                  <small>
                    {latestAutomationRun.provider === "chatgpt" ? "ChatGPT" : "Gemini"} ·{" "}
                    {latestAutomationRun.status}
                  </small>
                </span>
                <b>
                  {latestAutomationRun.ready} / {latestAutomationRun.total}
                </b>
                <progress value={latestAutomationRun.ready} max={latestAutomationRun.total} />
                {latestAutomationRun.failed > 0 && <em>{latestAutomationRun.failed} 张失败</em>}
              </div>
            )}
          </article>
        </div>
      </section>

      <section className="material-panel__diagnostics" aria-label="高级设置">
        <CloudOperationsPanel compact />
      </section>
    </main>
  )
}

function readTaskCategory(value: string): AssetCategory {
  return ASSET_CATEGORIES.find((category) => category === value) ?? "其他"
}

function AssetAdminLogin({
  checking,
  statusMessage,
  onLoggedIn,
}: {
  readonly checking: boolean
  readonly statusMessage: string | null
  readonly onLoggedIn: () => void
}) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(statusMessage ?? (checking ? "正在验证登录状态…" : ""))

  useEffect(() => {
    if (statusMessage !== null) setMessage(statusMessage)
  }, [statusMessage])

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setBusy(true)
    try {
      await loginRemoteAssetAdmin(username, password)
      setMessage("登录成功，正在进入素材管理台…")
      onLoggedIn()
    } catch (error) {
      setMessage(isRemoteAdminAuthError(error) ? "账号或密码错误" : "暂时无法登录，请稍后重试")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="asset-admin-login-shell">
      <form className="asset-admin-login" onSubmit={(event) => void submit(event)}>
        <div className="asset-admin-login__brand">轻设</div>
        <h1>云素材面板</h1>
        <p>登录后管理入库、审核，以及轻抠与插件状态。</p>
        <label>
          账号
          <input
            value={username}
            autoComplete="username"
            onChange={(event) => setUsername(event.currentTarget.value)}
            required
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.currentTarget.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy || checking}>
          {busy ? "正在登录" : "登录素材面板"}
        </button>
        {message !== "" && (
          <p className="asset-admin-login__message" role="status">
            {message}
          </p>
        )}
      </form>
    </main>
  )
}
