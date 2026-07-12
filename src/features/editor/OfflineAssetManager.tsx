import { ArrowClockwise, HardDrive, X } from "@phosphor-icons/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  CURRENT_PROJECT_CACHE_PACKAGE,
  DOWNLOADABLE_ASSET_PACKAGES,
  type OfflineAssetPackageDefinition,
  selectAssetsForPackage,
} from "../assets/asset-packages"
import { listServiceAssets, readServiceAssetFile } from "../assets/asset-service-client"
import { CloudAssetCache, type OfflineCacheSummary } from "../assets/cloud-asset-cache"
import {
  cachedPackageAssetIds,
  cachedPackageAssets,
  OfflineAssetPackageSection,
  type PackageDownloadProgress,
} from "./OfflineAssetPackageSection"

type OfflineAssetManagerProps = {
  readonly variant?: "modal" | "panel"
  readonly onClose: () => void
  readonly projectAssetIds: readonly string[]
}

type OfflineAssetManagerState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly summary: OfflineCacheSummary }
  | { readonly kind: "error"; readonly message: string }

export function OfflineAssetManager({
  onClose,
  projectAssetIds,
  variant = "modal",
}: OfflineAssetManagerProps) {
  const cacheRef = useRef<CloudAssetCache | null>(null)
  if (cacheRef.current === null) cacheRef.current = new CloudAssetCache()
  const [state, setState] = useState<OfflineAssetManagerState>({ kind: "loading" })
  const [progress, setProgress] = useState<PackageDownloadProgress | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const projectIds = useMemo(() => new Set(projectAssetIds), [projectAssetIds])

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" })
    try {
      const summary = await cacheRef.current?.getOfflineCacheSummary()
      if (summary === undefined) throw new OfflineAssetCacheUnavailableError()
      setState({ kind: "ready", summary })
    } catch (error) {
      setState({ kind: "error", message: offlineAssetCacheErrorMessage(error) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const summary = state.kind === "ready" ? state.summary : null
  const currentProjectDefinition = CURRENT_PROJECT_CACHE_PACKAGE
  const currentProjectCachedCount =
    summary === null ? 0 : cachedPackageAssets(currentProjectDefinition, summary, projectIds).length
  const primaryPackages = DOWNLOADABLE_ASSET_PACKAGES.filter(
    (definition) => definition.kind !== "category",
  )
  const categoryPackages = DOWNLOADABLE_ASSET_PACKAGES.filter(
    (definition) => definition.kind === "category",
  )

  const runPackageDownload = useCallback(
    async (definition: OfflineAssetPackageDefinition): Promise<void> => {
      if (definition.kind === "cache") return
      setIsBusy(true)
      try {
        const assets = await listServiceAssets("", definition.category ?? "", "ready", true, false)
        const selected = selectAssetsForPackage(definition, assets)
        if (selected.length === 0) throw new EmptyAssetPackageError(definition.name)
        await cacheRef.current?.saveCatalog(selected)
        const cached = await cacheRef.current?.readProcessed(selected)
        setProgress({ packageId: definition.id, completed: 0, total: selected.length })
        for (const asset of selected) {
          if (!cached?.has(asset.id)) {
            await cacheRef.current?.saveProcessed(
              asset,
              await readServiceAssetFile(asset.id, "processed"),
            )
          }
          setProgress((current) =>
            current === null
              ? current
              : { ...current, completed: Math.min(current.completed + 1, current.total) },
          )
        }
        await load()
      } catch (error) {
        setState({ kind: "error", message: offlineAssetCacheErrorMessage(error) })
      } finally {
        setProgress(null)
        setIsBusy(false)
      }
    },
    [load],
  )

  const clearPackage = useCallback(
    async (definition: OfflineAssetPackageDefinition): Promise<void> => {
      if (summary === null) return
      const ids = cachedPackageAssetIds(definition, summary, projectIds)
      if (ids.length === 0) return
      setIsBusy(true)
      try {
        await cacheRef.current?.clearAssets(ids)
        await load()
      } catch (error) {
        setState({ kind: "error", message: offlineAssetCacheErrorMessage(error) })
      } finally {
        setIsBusy(false)
      }
    },
    [load, projectIds, summary],
  )

  return (
    <div className={`offline-asset-manager__backdrop is-${variant}`}>
      <section
        className={`offline-asset-manager is-${variant}`}
        role="dialog"
        aria-modal={variant === "modal"}
        aria-labelledby="offline-asset-manager-title"
      >
        <header className="offline-asset-manager__header">
          <div>
            <h2 id="offline-asset-manager-title">离线素材</h2>
            <p>按素材包下载；拖拽缩略图后自动加入当前项目缓存包。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭离线素材管理"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        {summary !== null && (
          <div className="offline-asset-manager__summary" aria-live="polite">
            <HardDrive size={20} aria-hidden="true" />
            <div>
              <strong>{`${currentProjectCachedCount} / ${projectAssetIds.length} 项当前项目已缓存`}</strong>
              <span>{`${formatBytes(summary.bytes)} 总缓存 · ${summary.assets.length} 项素材`}</span>
            </div>
          </div>
        )}
        {state.kind === "loading" && (
          <p className="offline-asset-manager__status">正在读取素材包…</p>
        )}
        {state.kind === "error" && (
          <p className="offline-asset-manager__status is-error">{state.message}</p>
        )}
        {summary !== null && (
          <div className="offline-asset-manager__packages">
            <OfflineAssetPackageSection
              title="当前项目缓存"
              packages={[CURRENT_PROJECT_CACHE_PACKAGE]}
              busy={isBusy}
              progress={progress}
              summary={summary}
              projectIds={projectIds}
              onClear={clearPackage}
              onDownload={runPackageDownload}
            />
            <OfflineAssetPackageSection
              title="下载素材包"
              packages={primaryPackages}
              busy={isBusy}
              progress={progress}
              summary={summary}
              projectIds={projectIds}
              onClear={clearPackage}
              onDownload={runPackageDownload}
            />
            <OfflineAssetPackageSection
              title="分类包"
              packages={categoryPackages}
              collapsed={!categoriesOpen}
              busy={isBusy}
              progress={progress}
              summary={summary}
              projectIds={projectIds}
              onToggle={() => setCategoriesOpen((open) => !open)}
              onClear={clearPackage}
              onDownload={runPackageDownload}
            />
          </div>
        )}
        <footer className="offline-asset-manager__actions">
          <span className="offline-asset-manager__status">包内素材会在编辑器中直接可用。</span>
          <button
            className="icon-button"
            type="button"
            aria-label="刷新离线素材包"
            disabled={isBusy}
            onClick={() => void load()}
          >
            <ArrowClockwise size={16} aria-hidden="true" />
          </button>
        </footer>
      </section>
    </div>
  )
}

class OfflineAssetCacheUnavailableError extends Error {
  readonly name = "OfflineAssetCacheUnavailableError"
}

class EmptyAssetPackageError extends Error {
  readonly name = "EmptyAssetPackageError"
}

function offlineAssetCacheErrorMessage(error: unknown): string {
  if (error instanceof EmptyAssetPackageError) return `${error.message}暂时没有可下载内容。`
  return error instanceof Error ? "离线素材包操作失败，请重试。" : "离线素材暂时不可用。"
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_024 ** 2) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / 1_024 ** 2).toFixed(1)} MB`
}
