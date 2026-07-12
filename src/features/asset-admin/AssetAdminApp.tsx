import {
  ArrowClockwise,
  ArrowLeft,
  CheckSquare,
  CloudArrowUp,
  FolderOpen,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react"
import type { ChangeEvent } from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  deleteServiceAssetsFromCloud,
  isCloudAssetSyncConfigured,
  isCloudAutoSyncCandidate,
  syncServiceAssetsToCloud,
} from "../assets/asset-cloud-client"
import {
  backupServiceCatalog,
  deleteServiceAsset,
  getServiceAsset,
  importServiceAssets,
  listServiceAssets,
  listServiceJobs,
  patchServiceAsset,
  repairServiceCatalog,
  restoreServiceAsset,
  retryServiceJob,
  type ServiceAsset,
  type ServiceAssetEvent,
  type ServiceJob,
  serviceAssetMediaUrl,
  subscribeToAssetEvents,
} from "../assets/asset-service-client"
import { ASSET_CATEGORIES, type AssetCategory } from "../assets/demo-assets"
import { isDesktopRuntime } from "../projects/tauri-runtime"

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp"
type CatalogView = "ready" | "review" | "deleted"
type AssetAdminOperation = "apply" | "restore" | "backup" | "repair"

const OPERATION_FAILURE_LABELS = {
  apply: "分类修改失败",
  restore: "素材恢复失败",
  backup: "目录备份失败",
  repair: "索引修复失败",
} as const satisfies Readonly<Record<AssetAdminOperation, string>>

export function formatAssetAdminError(operation: AssetAdminOperation, error: Error): string {
  return `${OPERATION_FAILURE_LABELS[operation]}：${error.message}`
}

export function AssetAdminApp() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [assets, setAssets] = useState<readonly ServiceAsset[]>([])
  const [jobs, setJobs] = useState<readonly ServiceJob[]>([])
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<AssetCategory | "">("")
  const [batchCategory, setBatchCategory] = useState<AssetCategory>("花艺")
  const [catalogView, setCatalogView] = useState<CatalogView>("ready")
  const [reviewCount, setReviewCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("选择图片后会自动排队、抠图、裁边、分类并入库。")

  const refresh = useCallback(async () => {
    const status = catalogView === "deleted" ? "deleted" : "ready"
    const needsReview = catalogView === "review" ? true : catalogView === "ready" ? false : null
    const [nextAssets, nextJobs, reviewAssets] = await Promise.all([
      listServiceAssets(query, category, status, false, needsReview),
      listServiceJobs(),
      listServiceAssets("", "", "ready", true, true),
    ])
    setAssets(nextAssets)
    setJobs(nextJobs)
    setReviewCount(reviewAssets.length)
  }, [catalogView, category, query])

  useEffect(() => {
    void refresh().catch(() => setMessage("本地素材服务未启动，请运行 pnpm assets:server。"))
  }, [refresh])

  const syncReadyAsset = useCallback(async (assetId: string): Promise<void> => {
    if (!isCloudAssetSyncConfigured()) return
    try {
      const asset = await getServiceAsset(assetId)
      if (!isCloudAutoSyncCandidate(asset)) return
      setMessage(`素材已入库，正在自动同步云端：${asset.name}`)
      const summary = await syncServiceAssetsToCloud([asset])
      setMessage(
        summary.failed === 0
          ? `素材已入库并同步云端：${asset.name}`
          : `素材已入库，但云端同步失败：${summary.firstError ?? "未知错误"}`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误"
      setMessage(`素材已入库，但云端同步失败：${message}`)
    }
  }, [])

  const handleAssetEvent = useCallback(
    (event: ServiceAssetEvent): void => {
      void refresh()
      if (event.type === "asset.ready") void syncReadyAsset(event.assetId)
    },
    [refresh, syncReadyAsset],
  )

  useEffect(() => subscribeToAssetEvents(handleAssetEvent), [handleAssetEvent])

  async function handleFiles(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = event.currentTarget.files === null ? [] : Array.from(event.currentTarget.files)
    event.currentTarget.value = ""
    if (files.length === 0) return
    setBusy(true)
    setMessage(`正在提交 0 / ${files.length} 张图片，本地服务会依次处理。`)
    const summary = await importServiceAssets(files, (progress) => {
      setMessage(
        `正在提交 ${progress.completed} / ${progress.total} 张图片，失败 ${progress.failed} 张。`,
      )
    })
    setMessage(
      summary.failed === 0
        ? `已加入 ${summary.succeeded} 张图片；处理完成后会自动出现。`
        : `已加入 ${summary.succeeded} 张，${summary.failed} 张失败；成功项会继续处理。`,
    )
    setBusy(false)
    await refresh().catch(() => setMessage("素材已提交，但暂时无法刷新目录。"))
  }

  function toggleSelection(assetId: string): void {
    if (!selected.has(assetId) && selected.size === 0) {
      const asset = assets.find((candidate) => candidate.id === assetId)
      if (asset !== undefined) setBatchCategory(asset.category)
    }
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
      return next
    })
  }

  async function applyCategory(): Promise<void> {
    setBusy(true)
    try {
      await Promise.all(
        [...selected].map((id) =>
          patchServiceAsset(id, { category: batchCategory, needs_review: false }),
        ),
      )
      setSelected(new Set())
      await refresh()
      setMessage(catalogView === "review" ? "素材已确认入库。" : "已批量修改分类。")
    } catch (error) {
      if (!(error instanceof Error)) throw error
      setMessage(formatAssetAdminError("apply", error))
    } finally {
      setBusy(false)
    }
  }

  async function deleteSelected(): Promise<void> {
    setBusy(true)
    try {
      const selectedAssets = assets.filter((asset) => selected.has(asset.id))
      await deleteServiceAssetsFromCloud(selectedAssets)
      await Promise.all(selectedAssets.map((asset) => deleteServiceAsset(asset.id)))
      setSelected(new Set())
      await refresh()
      setMessage("素材已移入回收站，原图没有被永久删除。")
    } catch (error) {
      if (!(error instanceof Error)) throw error
      setMessage(`素材未移入回收站，云端下架失败：${error.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function restoreSelected(): Promise<void> {
    setBusy(true)
    try {
      await Promise.all([...selected].map(restoreServiceAsset))
      setSelected(new Set())
      await refresh()
      setMessage("素材已恢复到在库目录。")
    } catch (error) {
      if (!(error instanceof Error)) throw error
      setMessage(formatAssetAdminError("restore", error))
    } finally {
      setBusy(false)
    }
  }

  async function syncSelectedToCloud(): Promise<void> {
    if (!isCloudAssetSyncConfigured()) {
      setMessage("云端素材服务尚未配置。")
      return
    }
    const selectedAssets = assets.filter((asset) => selected.has(asset.id))
    setBusy(true)
    try {
      const summary = await syncServiceAssetsToCloud(selectedAssets, (progress) => {
        setMessage(
          `正在同步云端 ${progress.completed} / ${progress.total}，失败 ${progress.failed} 项。`,
        )
      })
      setMessage(
        summary.failed === 0
          ? `已同步 ${summary.succeeded} 项素材到云端。`
          : `已同步 ${summary.succeeded} 项，失败 ${summary.failed} 项：${summary.firstError ?? "未知错误"}`,
      )
    } finally {
      setBusy(false)
    }
  }

  async function backupCatalog(): Promise<void> {
    try {
      const path = await backupServiceCatalog()
      setMessage(`目录备份已保存：${path}`)
    } catch (error) {
      if (!(error instanceof Error)) throw error
      setMessage(formatAssetAdminError("backup", error))
    }
  }

  async function repairCatalog(): Promise<void> {
    try {
      await repairServiceCatalog()
      await refresh()
      setMessage("目录索引已检查并重建。")
    } catch (error) {
      if (!(error instanceof Error)) throw error
      setMessage(formatAssetAdminError("repair", error))
    }
  }

  const activeJobs = jobs.filter((job) => job.status !== "ready")
  function readCategory(value: string): AssetCategory | "" {
    if (value === "") return ""
    return ASSET_CATEGORIES.find((item) => item === value) ?? ""
  }

  function readRequiredCategory(value: string): AssetCategory {
    return ASSET_CATEGORIES.find((item) => item === value) ?? "其他"
  }

  return (
    <main className="asset-admin-shell">
      <header className="asset-admin-header">
        <div>
          <span className="asset-admin-product">轻素</span>
          <h1>素材管理</h1>
        </div>
        {!isDesktopRuntime() && (
          <a className="secondary-button asset-admin-back" href="/">
            <ArrowLeft size={16} aria-hidden="true" />
            返回设计编辑器
          </a>
        )}
      </header>

      <section
        className="asset-admin-section asset-admin-ingestion"
        aria-labelledby="ingestion-title"
      >
        <header className="asset-admin-section-header">
          <div>
            <h2 id="ingestion-title">自动入库</h2>
            <span>完全在本机处理</span>
          </div>
          <button
            className="icon-button"
            type="button"
            title="刷新"
            aria-label="刷新"
            onClick={() => void refresh()}
          >
            <ArrowClockwise size={17} aria-hidden="true" />
          </button>
        </header>
        <button
          className="asset-admin-file-button"
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <UploadSimple size={20} aria-hidden="true" />
          <span>{busy ? "正在加入队列" : "选择一张或多张原始图片"}</span>
        </button>
        <input
          ref={inputRef}
          data-testid="asset-admin-file-input"
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(event) => void handleFiles(event)}
        />
        <p className="asset-admin-note" role="status">
          {message}
        </p>
        <div className="asset-admin-maintenance-actions">
          <button className="secondary-button" type="button" onClick={() => void backupCatalog()}>
            备份目录
          </button>
          <button className="secondary-button" type="button" onClick={() => void repairCatalog()}>
            修复索引
          </button>
        </div>
        {activeJobs.length > 0 && (
          <section className="asset-admin-jobs" aria-label="处理队列">
            {activeJobs.map((job) => (
              <div key={job.id} className={`asset-admin-job is-${job.status}`}>
                <span>
                  {job.status === "pending"
                    ? "等待处理"
                    : job.status === "processing"
                      ? "正在处理"
                      : "处理失败"}
                </span>
                <span>{job.error ?? `第 ${job.attempts} 次处理`}</span>
                {job.status === "failed" && (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void retryServiceJob(job.id).then(refresh)}
                  >
                    重试
                  </button>
                )}
              </div>
            ))}
          </section>
        )}
      </section>

      <section className="asset-admin-section asset-admin-catalog" aria-labelledby="catalog-title">
        <header className="asset-admin-section-header">
          <div>
            <h2 id="catalog-title">素材目录</h2>
            <span>{assets.length} 项</span>
          </div>
          <div className="asset-admin-filters">
            <button
              className={
                catalogView === "ready" ? "secondary-button is-active" : "secondary-button"
              }
              type="button"
              onClick={() => {
                setCatalogView("ready")
                setSelected(new Set())
              }}
            >
              在库
            </button>
            <button
              className={
                catalogView === "review" ? "secondary-button is-active" : "secondary-button"
              }
              type="button"
              onClick={() => {
                setCatalogView("review")
                setSelected(new Set())
              }}
            >
              待检查（{reviewCount}）
            </button>
            <button
              className={
                catalogView === "deleted" ? "secondary-button is-active" : "secondary-button"
              }
              type="button"
              onClick={() => {
                setCatalogView("deleted")
                setSelected(new Set())
              }}
            >
              回收站
            </button>
            <input
              type="search"
              value={query}
              placeholder="名称或编号"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <select
              value={category}
              aria-label="筛选分类"
              onChange={(event) => setCategory(readCategory(event.currentTarget.value))}
            >
              <option value="">全部分类</option>
              {ASSET_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        </header>
        {selected.size > 0 && (
          <div className="asset-admin-batch-bar">
            <CheckSquare size={18} aria-hidden="true" />
            <span>已选 {selected.size} 项</span>
            {catalogView !== "deleted" ? (
              <>
                <select
                  value={batchCategory}
                  aria-label="批量分类"
                  onChange={(event) =>
                    setBatchCategory(readRequiredCategory(event.currentTarget.value))
                  }
                >
                  {ASSET_CATEGORIES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void applyCategory()}
                >
                  {catalogView === "review" ? "确认入库" : "应用分类"}
                </button>
                {catalogView === "ready" && (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void syncSelectedToCloud()}
                  >
                    <CloudArrowUp size={16} aria-hidden="true" />
                    重新同步云端
                  </button>
                )}
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void deleteSelected()}
                >
                  <Trash size={16} aria-hidden="true" />
                  移到回收站
                </button>
              </>
            ) : (
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => void restoreSelected()}
              >
                恢复所选
              </button>
            )}
          </div>
        )}
        {assets.length === 0 ? (
          <div className="asset-admin-empty">
            <FolderOpen size={32} aria-hidden="true" />
            <span>暂时没有符合条件的素材</span>
          </div>
        ) : (
          <ul className="asset-admin-catalog-grid" aria-label="素材目录">
            {assets.map((asset) => (
              <li key={asset.id} className={selected.has(asset.id) ? "is-selected" : ""}>
                <button
                  type="button"
                  aria-pressed={selected.has(asset.id)}
                  onClick={() => toggleSelection(asset.id)}
                >
                  <span className="asset-admin-catalog-preview">
                    <img src={serviceAssetMediaUrl(asset.id, "thumbnail", asset.version)} alt="" />
                  </span>
                  <span className="asset-admin-catalog-name">{asset.name}</span>
                  <span className="asset-admin-catalog-meta">
                    {asset.code} · {asset.category}
                    {asset.needs_review ? " · 待检查" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
