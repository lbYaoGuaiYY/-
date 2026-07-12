import { CaretDown, CaretRight, CloudArrowDown, Trash } from "@phosphor-icons/react"

import type { OfflineAssetPackageDefinition } from "../assets/asset-packages"
import type { OfflineCachedAsset, OfflineCacheSummary } from "../assets/cloud-asset-cache"

export type PackageDownloadProgress = {
  readonly completed: number
  readonly packageId: string
  readonly total: number
}

export function OfflineAssetPackageSection({
  busy,
  collapsed = false,
  onClear,
  onDownload,
  onToggle,
  packages,
  progress,
  projectIds,
  summary,
  title,
}: {
  readonly busy: boolean
  readonly collapsed?: boolean
  readonly onClear: (definition: OfflineAssetPackageDefinition) => Promise<void>
  readonly onDownload: (definition: OfflineAssetPackageDefinition) => Promise<void>
  readonly onToggle?: () => void
  readonly packages: readonly OfflineAssetPackageDefinition[]
  readonly progress: PackageDownloadProgress | null
  readonly projectIds: ReadonlySet<string>
  readonly summary: OfflineCacheSummary
  readonly title: string
}) {
  const headingId = `package-section-${title}`
  return (
    <section className="offline-asset-manager__package-section" aria-labelledby={headingId}>
      <header className="offline-asset-manager__package-section-header">
        <h3 id={headingId}>{title}</h3>
        {onToggle !== undefined && (
          <button
            className="offline-asset-manager__section-toggle"
            type="button"
            aria-expanded={!collapsed}
            onClick={onToggle}
          >
            {collapsed ? (
              <CaretRight size={14} aria-hidden="true" />
            ) : (
              <CaretDown size={14} aria-hidden="true" />
            )}
            <span>{collapsed ? `展开 ${packages.length} 个` : "收起"}</span>
          </button>
        )}
      </header>
      {!collapsed && (
        <ul className="offline-asset-manager__package-list">
          {packages.map((definition) => {
            const assets = cachedPackageAssets(definition, summary, projectIds)
            const activeProgress = progress?.packageId === definition.id ? progress : null
            const status = packageStatus(definition, assets)
            return (
              <li key={definition.id} className="offline-asset-manager__package">
                <div className="offline-asset-manager__package-head">
                  <strong>{definition.name}</strong>
                  <span className={`offline-asset-manager__package-status is-${status.tone}`}>
                    {status.label}
                  </span>
                </div>
                <p className="offline-asset-manager__package-description">
                  {definition.description}
                </p>
                <span className="offline-asset-manager__package-meta">
                  {`${assets.length} 项 · ${formatBytes(assets.reduce((total, asset) => total + asset.bytes, 0))}`}
                </span>
                {activeProgress !== null && (
                  <progress value={activeProgress.completed} max={activeProgress.total} />
                )}
                <div className="offline-asset-manager__package-actions">
                  {definition.kind !== "cache" && (
                    <button
                      className="text-button"
                      type="button"
                      disabled={busy}
                      onClick={() => void onDownload(definition)}
                    >
                      <CloudArrowDown size={15} aria-hidden="true" />
                      <span>{assets.length > 0 ? "更新" : "下载"}</span>
                    </button>
                  )}
                  <button
                    className="text-button is-subtle"
                    type="button"
                    disabled={busy || assets.length === 0}
                    onClick={() => void onClear(definition)}
                  >
                    <Trash size={15} aria-hidden="true" />
                    <span>清理</span>
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function cachedPackageAssets(
  definition: OfflineAssetPackageDefinition,
  summary: OfflineCacheSummary,
  projectIds: ReadonlySet<string>,
): readonly OfflineCachedAsset[] {
  return summary.assets.filter((asset) => {
    if (definition.kind === "cache") return projectIds.has(asset.id)
    if (definition.kind === "base") return asset.favorite
    if (definition.kind === "category") return asset.category === definition.category
    return true
  })
}

export function cachedPackageAssetIds(
  definition: OfflineAssetPackageDefinition,
  summary: OfflineCacheSummary,
  projectIds: ReadonlySet<string>,
): readonly string[] {
  return cachedPackageAssets(definition, summary, projectIds).map((asset) => asset.id)
}

function packageStatus(
  definition: OfflineAssetPackageDefinition,
  assets: readonly OfflineCachedAsset[],
): { readonly label: string; readonly tone: "auto" | "empty" | "ready" } {
  if (definition.kind === "cache") {
    return assets.length === 0
      ? { label: "拖拽后自动缓存", tone: "auto" }
      : { label: "自动缓存", tone: "auto" }
  }
  return assets.length === 0
    ? { label: "未下载", tone: "empty" }
    : { label: `已缓存 ${assets.length} 项`, tone: "ready" }
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_024 ** 2) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / 1_024 ** 2).toFixed(1)} MB`
}
