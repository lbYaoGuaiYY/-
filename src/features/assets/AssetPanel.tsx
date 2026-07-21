import { ArrowClockwise, FilePlus, HardDrive, MagnifyingGlass } from "@phosphor-icons/react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useEffect, useRef, useState } from "react"
import type { LibraryAsset } from "./asset-library"
import { type AssetServiceHealth, readAssetServiceHealth } from "./asset-service-health"
import { DraggableAssetTile } from "./DraggableAssetTile"
import { ASSET_CATEGORIES, type AssetCategory } from "./demo-assets"
import { MySubmissionsList } from "./MySubmissionsList"
import type { SubmissionDialogInitialValues } from "./SubmissionDialog"
import { SubmissionDialog } from "./SubmissionDialog"
import { useSubmissions } from "./use-submissions"

export type AssetPanelProps = {
  readonly assets: readonly LibraryAsset[]
  readonly category: AssetCategory | ""
  readonly hasMore: boolean
  readonly isLoadingMore: boolean
  readonly isRefreshing: boolean
  readonly onAddAsset: (asset: LibraryAsset) => void
  readonly onCategoryChange: (category: AssetCategory | "") => void
  readonly onLoadMore: () => void
  readonly onOpenOfflineAssets: () => void
  readonly onQueryChange: (query: string) => void
  readonly onRefresh: () => void
  readonly onSubmissionApproved?: () => void
  readonly query: string
  readonly status: "loading" | "ready" | "error"
}

export function AssetPanel({
  assets,
  category,
  hasMore,
  isLoadingMore,
  isRefreshing,
  onAddAsset,
  onCategoryChange,
  onLoadMore,
  onOpenOfflineAssets,
  onQueryChange,
  onRefresh,
  onSubmissionApproved,
  query,
  status,
}: AssetPanelProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [health, setHealth] = useState<AssetServiceHealth | null>(null)
  const [submissionDialogOpen, setSubmissionDialogOpen] = useState(false)
  const [retrySubmission, setRetrySubmission] = useState<SubmissionDialogInitialValues | null>(null)
  const [activeView, setActiveView] = useState<"library" | "submissions">("library")
  const submissionState = useSubmissions(onSubmissionApproved)
  const openSubmissionDialog = (initialValues?: SubmissionDialogInitialValues): void => {
    setRetrySubmission(initialValues ?? null)
    setSubmissionDialogOpen(true)
  }
  const closeSubmissionDialog = (): void => {
    setSubmissionDialogOpen(false)
    setRetrySubmission(null)
  }
  useEffect(() => {
    const refreshHealth = (): void => {
      void readAssetServiceHealth().then(setHealth)
    }
    refreshHealth()
    const timer = window.setInterval(refreshHealth, 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const assetVirtualizer = useVirtualizer({
    count: assets.length,
    estimateSize: () => 232,
    gap: 8,
    getScrollElement: () => gridRef.current,
    lanes: 2,
    overscan: 8,
  })

  return (
    <aside className="asset-panel" aria-labelledby="asset-panel-title">
      <header className="asset-panel__header">
        <div className="asset-panel__heading">
          <h2 id="asset-panel-title">素材</h2>
          <span className="asset-panel__heading-actions">
            <span className={`asset-panel__connection is-${health?.connection ?? "checking"}`}>
              {health === null
                ? "检测中"
                : health.connection === "online"
                  ? "云素材在线"
                  : health.connection === "slow"
                    ? "云素材较慢"
                    : "使用本地缓存"}
            </span>
            <span className="asset-panel__count">{assets.length} 项</span>
            <button
              className="icon-button"
              data-testid="asset-library-refresh"
              type="button"
              title="刷新素材库"
              aria-label="刷新素材库"
              disabled={isRefreshing}
              onClick={onRefresh}
            >
              <ArrowClockwise size={16} aria-hidden="true" />
            </button>
            <button
              className="primary-button asset-panel__submit-button"
              type="button"
              data-testid="asset-submit-open"
              onClick={() => openSubmissionDialog()}
            >
              <FilePlus size={16} aria-hidden="true" />
              <span>提交素材</span>
            </button>
            <button
              className="icon-button"
              type="button"
              title="离线素材管理"
              aria-label="离线素材管理"
              onClick={onOpenOfflineAssets}
            >
              <HardDrive size={16} aria-hidden="true" />
            </button>
          </span>
        </div>
      </header>

      <nav className="asset-panel__views" aria-label="素材视图">
        <button
          className={`text-button${activeView === "library" ? " is-active" : ""}`}
          type="button"
          aria-pressed={activeView === "library"}
          onClick={() => setActiveView("library")}
        >
          素材库
        </button>
        <button
          className={`text-button${activeView === "submissions" ? " is-active" : ""}`}
          type="button"
          aria-pressed={activeView === "submissions"}
          onClick={() => setActiveView("submissions")}
        >
          我的提交
          {submissionState.submissions.length > 0 && (
            <span className="asset-panel__submission-count">
              {submissionState.submissions.length}
            </span>
          )}
        </button>
      </nav>

      {activeView === "submissions" ? (
        <MySubmissionsList
          submissions={submissionState.submissions}
          onRefresh={submissionState.refresh}
          onOpenInLibrary={() => {
            setActiveView("library")
            onRefresh()
          }}
          onRetry={(submission) =>
            openSubmissionDialog({
              name: submission.name,
              ...(submission.category === undefined ? {} : { category: submission.category }),
              mode: submission.mode,
            })
          }
        />
      ) : (
        <div className="asset-panel__library-view">
          <div className="asset-panel__filters">
            <label className="asset-panel__search">
              <span className="asset-panel__search-label">搜索素材</span>
              <span className="asset-panel__search-control">
                <MagnifyingGlass aria-hidden="true" size={16} />
                <input
                  type="search"
                  value={query}
                  placeholder="名称/编号/标签"
                  onChange={(event) => onQueryChange(event.currentTarget.value)}
                />
              </span>
            </label>
            <label className="sr-only" htmlFor="asset-category-filter">
              素材分类
            </label>
            <select
              id="asset-category-filter"
              className="asset-panel__category-filter"
              aria-label="素材分类"
              value={category}
              onChange={(event) =>
                onCategoryChange(
                  event.currentTarget.value === ""
                    ? ""
                    : (ASSET_CATEGORIES.find(
                        (candidate) => candidate === event.currentTarget.value,
                      ) ?? ""),
                )
              }
            >
              <option value="">全部分类</option>
              {ASSET_CATEGORIES.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          </div>

          <div className="asset-panel__content">
            {status === "error" && (
              <p className="asset-panel__notice notice-error" role="status">
                云端素材服务暂时不可用，已显示内置素材。
              </p>
            )}

            {assets.length > 0 ? (
              <div ref={gridRef} className="asset-panel__virtual-scroll">
                <ul
                  className="asset-panel__grid is-virtual"
                  aria-label="素材库"
                  style={{ height: assetVirtualizer.getTotalSize() }}
                >
                  {assetVirtualizer.getVirtualItems().flatMap((item) => {
                    const asset = assets[item.index]
                    return asset === undefined
                      ? []
                      : [
                          <li
                            key={asset.id}
                            ref={assetVirtualizer.measureElement}
                            data-index={item.index}
                            style={{
                              left: `calc(${item.lane * 50}% + ${item.lane * 4}px)`,
                              top: 0,
                              transform: `translateY(${item.start}px)`,
                              width: "calc(50% - 4px)",
                            }}
                          >
                            <DraggableAssetTile asset={asset} onAdd={onAddAsset} />
                          </li>,
                        ]
                  })}
                </ul>
                {hasMore && (
                  <button
                    className="asset-panel__load-more text-button"
                    type="button"
                    disabled={isLoadingMore}
                    onClick={onLoadMore}
                  >
                    {isLoadingMore ? "加载中…" : "加载更多素材"}
                  </button>
                )}
              </div>
            ) : (
              <p className="asset-panel__empty" role="status">
                {status === "loading"
                  ? "正在读取素材库…"
                  : query.trim() === "" && category === ""
                    ? "暂无可用素材"
                    : "没有符合条件的素材"}
              </p>
            )}
          </div>
        </div>
      )}
      {submissionDialogOpen && (
        <SubmissionDialog
          open
          {...(retrySubmission === null ? {} : { initialValues: retrySubmission })}
          isSubmitting={submissionState.isSubmitting}
          onClose={closeSubmissionDialog}
          onSubmit={async (file, input, onProgress) => {
            const result = await submissionState.submit(file, input, onProgress)
            setActiveView("submissions")
            return {
              submissionId: result.submissionId,
              status: result.status,
              error: result.error,
            }
          }}
        />
      )}
    </aside>
  )
}
