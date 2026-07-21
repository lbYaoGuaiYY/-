import { useCallback, useEffect, useRef, useState } from "react"

import type { LibraryAsset } from "./asset-library"
import {
  createManagedLibraryAsset,
  createServiceLibraryAsset,
  revokeUnusedServiceAssetObjectUrls,
  type ServiceAssetObjectUrlCache,
  serviceAssetVersionKey,
} from "./asset-library"
import {
  ASSET_PAGE_SIZE,
  getServiceCatalogRevision,
  listServiceAssetPage,
  subscribeToAssetEvents,
} from "./asset-service-client"
import { startVisibleCatalogPolling } from "./catalog-refresh-scheduler"
import { CloudAssetCache } from "./cloud-asset-cache"
import type { AssetCategory } from "./demo-assets"
import { ManagedAssetStore } from "./managed-asset-store"

export type ManagedAssetQuery = {
  readonly search: string
  readonly category: AssetCategory | ""
}

export type ManagedAssetsState = {
  readonly assets: readonly LibraryAsset[]
  readonly hasMore: boolean
  readonly isLoadingMore: boolean
  readonly loadMore: () => void
  readonly refresh: () => void
  readonly status: "loading" | "ready" | "error"
}

export type ManagedAssetsOptions = {
  readonly enabled?: boolean
}

const DEFAULT_QUERY = { search: "", category: "" } as const satisfies ManagedAssetQuery
const cloudAssetCache = new CloudAssetCache()
export const ASSET_SEARCH_DEBOUNCE_MS = 250

export function useManagedAssets(
  query: ManagedAssetQuery = DEFAULT_QUERY,
  options: ManagedAssetsOptions = {},
): ManagedAssetsState {
  const enabled = options.enabled ?? true
  const [assets, setAssets] = useState<readonly LibraryAsset[]>([])
  const [status, setStatus] = useState<ManagedAssetsState["status"]>("loading")
  const [hasMore, setHasMore] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [revision, setRevision] = useState(0)
  const [debouncedSearch, setDebouncedSearch] = useState(query.search)
  const catalogRevisionRef = useRef<string | null>(null)
  const activeQuery = useRef("")
  const requestGenerationRef = useRef(0)
  const activeFilter = useRef("")
  const cachedObjectUrls = useRef<ServiceAssetObjectUrlCache>(new Map())
  const activeObjectUrlKeys = useRef(new Set<string>())
  useEffect(
    () => () => {
      revokeUnusedServiceAssetObjectUrls(cachedObjectUrls.current, new Set())
      activeObjectUrlKeys.current.clear()
    },
    [],
  )
  const refresh = useCallback(() => {
    setStatus("loading")
    setRevision((current) => current + 1)
  }, [])
  const refreshIfCatalogChanged = useCallback(() => {
    void getServiceCatalogRevision()
      .then((nextRevision) => {
        if (
          catalogRevisionRef.current === null ||
          catalogRevisionRef.current !== String(nextRevision)
        ) {
          refresh()
        }
      })
      .catch(() => refresh())
  }, [refresh])

  useEffect(() => {
    if (query.search === debouncedSearch) return
    const timer = window.setTimeout(
      () => setDebouncedSearch(query.search),
      ASSET_SEARCH_DEBOUNCE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [debouncedSearch, query.search])

  const filterKey = `${debouncedSearch}\u0000${query.category}`
  const queryKey = `${filterKey}\u0000${revision}`
  activeQuery.current = queryKey

  useEffect(() => {
    const requestQuery = queryKey
    const requestGeneration = ++requestGenerationRef.current
    if (!enabled) {
      revokeUnusedServiceAssetObjectUrls(cachedObjectUrls.current, new Set())
      activeObjectUrlKeys.current.clear()
      setAssets([])
      setHasMore(false)
      setIsLoadingMore(false)
      setStatus("error")
      return
    }
    const filterChanged = activeFilter.current !== filterKey
    activeFilter.current = filterKey
    let active = true
    const fallbackUrls: string[] = []
    // A fresh first-page request supersedes any in-flight pagination request.
    setIsLoadingMore(false)
    if (filterChanged) {
      revokeUnusedServiceAssetObjectUrls(cachedObjectUrls.current, new Set())
      activeObjectUrlKeys.current.clear()
      setAssets([])
      setHasMore(false)
      setIsLoadingMore(false)
    }
    setStatus("loading")
    void (async () => {
      try {
        const page = await listServiceAssetPage({
          search: debouncedSearch,
          category: query.category,
          status: "ready",
          needsReview: false,
          limit: ASSET_PAGE_SIZE,
          offset: 0,
        })
        await saveCatalogBestEffort(page.assets)
        const cachedProcessed = await readProcessedBestEffort(page.assets)
        if (
          !active ||
          requestGeneration !== requestGenerationRef.current ||
          activeQuery.current !== requestQuery
        )
          return
        const nextAssets = createServiceLibraryAssets(
          page.assets,
          cachedProcessed,
          cachedObjectUrls.current,
        )
        const nextKeys = new Set(
          page.assets.filter((asset) => cachedProcessed.has(asset.id)).map(serviceAssetVersionKey),
        )
        revokeUnusedServiceAssetObjectUrls(cachedObjectUrls.current, nextKeys)
        activeObjectUrlKeys.current = nextKeys
        setAssets(nextAssets)
        catalogRevisionRef.current = page.revision
        setHasMore(page.hasMore)
        setStatus("ready")
      } catch (error) {
        if (!(error instanceof Error)) throw error
        try {
          const cached = await cloudAssetCache.listCatalog({
            search: debouncedSearch,
            category: query.category,
            limit: ASSET_PAGE_SIZE,
            offset: 0,
          })
          const cachedProcessed = await readProcessedBestEffort(cached.assets)
          if (
            !active ||
            requestGeneration !== requestGenerationRef.current ||
            activeQuery.current !== requestQuery
          )
            return
          const offlineAssets = createOfflineServiceLibraryAssets(
            cached.assets,
            cachedProcessed,
            cachedObjectUrls.current,
          )
          if (offlineAssets.length > 0) {
            if (
              !active ||
              requestGeneration !== requestGenerationRef.current ||
              activeQuery.current !== requestQuery
            )
              return
            const nextKeys = new Set(
              cached.assets
                .filter((asset) => cachedProcessed.has(asset.id))
                .map(serviceAssetVersionKey),
            )
            revokeUnusedServiceAssetObjectUrls(cachedObjectUrls.current, nextKeys)
            activeObjectUrlKeys.current = nextKeys
            setAssets(offlineAssets)
            // Catalog metadata alone is not an offline asset. Only entries
            // with a locally cached processed blob are usable while the
            // service is unreachable, so there is no remote page to load.
            setHasMore(false)
            setStatus("ready")
            return
          }
          const legacy = await new ManagedAssetStore().list()
          if (
            !active ||
            requestGeneration !== requestGenerationRef.current ||
            activeQuery.current !== requestQuery
          )
            return
          const normalizedSearch = debouncedSearch.toLocaleLowerCase("zh-CN")
          const filtered = legacy.filter((record) => {
            if (query.category !== "" && record.category !== query.category) return false
            return `${record.name} ${record.category}`
              .toLocaleLowerCase("zh-CN")
              .includes(normalizedSearch)
          })
          const urls = filtered.map((record) => ({
            record,
            src: URL.createObjectURL(record.blob),
          }))
          fallbackUrls.push(...urls.map(({ src }) => src))
          revokeUnusedServiceAssetObjectUrls(cachedObjectUrls.current, new Set())
          activeObjectUrlKeys.current.clear()
          setAssets(urls.map(({ record, src }) => createManagedLibraryAsset(record, src)))
          setStatus(filtered.length === 0 ? "error" : "ready")
        } catch (fallbackError) {
          if (!(fallbackError instanceof Error)) throw fallbackError
          if (
            active &&
            requestGeneration === requestGenerationRef.current &&
            activeQuery.current === requestQuery
          )
            setStatus("error")
        }
      }
    })()
    return () => {
      active = false
      fallbackUrls.forEach((src) => {
        URL.revokeObjectURL(src)
      })
    }
  }, [debouncedSearch, enabled, filterKey, query.category, queryKey])

  const loadMore = useCallback(() => {
    if (!enabled || !hasMore || isLoadingMore || status !== "ready") return
    const requestQuery = queryKey
    const requestGeneration = requestGenerationRef.current
    const offset = assets.length
    setIsLoadingMore(true)
    void (async () => {
      try {
        const page = await listServiceAssetPage({
          search: debouncedSearch,
          category: query.category,
          status: "ready",
          needsReview: false,
          limit: ASSET_PAGE_SIZE,
          offset,
        })
        await saveCatalogBestEffort(page.assets)
        const cachedProcessed = await readProcessedBestEffort(page.assets)
        if (
          requestGeneration !== requestGenerationRef.current ||
          activeQuery.current !== requestQuery
        )
          return
        const nextAssets = createServiceLibraryAssets(
          page.assets,
          cachedProcessed,
          cachedObjectUrls.current,
        )
        const nextKeys = new Set(activeObjectUrlKeys.current)
        for (const asset of page.assets) {
          if (cachedProcessed.has(asset.id)) nextKeys.add(serviceAssetVersionKey(asset))
        }
        revokeUnusedServiceAssetObjectUrls(cachedObjectUrls.current, nextKeys)
        activeObjectUrlKeys.current = nextKeys
        setAssets((current) => [...current, ...nextAssets])
        catalogRevisionRef.current = page.revision
        setHasMore(page.hasMore)
      } catch (error) {
        if (!(error instanceof Error)) throw error
        if (
          requestGeneration === requestGenerationRef.current &&
          activeQuery.current === requestQuery
        )
          setStatus("error")
      } finally {
        if (
          requestGeneration === requestGenerationRef.current &&
          activeQuery.current === requestQuery
        )
          setIsLoadingMore(false)
      }
    })()
  }, [
    assets.length,
    enabled,
    hasMore,
    isLoadingMore,
    query.category,
    debouncedSearch,
    queryKey,
    status,
  ])

  useEffect(() => {
    if (!enabled) return
    return subscribeToAssetEvents(refresh)
  }, [enabled, refresh])
  useEffect(() => {
    if (!enabled) return
    const refreshWhenEditorReturns = (): void => {
      if (document.visibilityState === "visible") refreshIfCatalogChanged()
    }
    window.addEventListener("focus", refreshWhenEditorReturns)
    document.addEventListener("visibilitychange", refreshWhenEditorReturns)
    return () => {
      window.removeEventListener("focus", refreshWhenEditorReturns)
      document.removeEventListener("visibilitychange", refreshWhenEditorReturns)
    }
  }, [enabled, refreshIfCatalogChanged])
  useEffect(
    () => (enabled ? startVisibleCatalogPolling(refreshIfCatalogChanged) : undefined),
    [enabled, refreshIfCatalogChanged],
  )
  return { assets, hasMore, isLoadingMore, loadMore, refresh, status }
}

async function saveCatalogBestEffort(
  assets: Parameters<typeof cloudAssetCache.saveCatalog>[0],
): Promise<void> {
  try {
    await cloudAssetCache.saveCatalog(assets)
  } catch {
    // The online catalog remains authoritative; cache persistence is optional.
  }
}

async function readProcessedBestEffort(
  assets: Parameters<typeof cloudAssetCache.readProcessed>[0],
): Promise<ReadonlyMap<string, Blob>> {
  try {
    return await cloudAssetCache.readProcessed(assets)
  } catch {
    // A corrupt/unavailable cache must not hide online assets.
    return new Map()
  }
}

function createServiceLibraryAssets(
  assets: readonly Parameters<typeof createServiceLibraryAsset>[0][],
  cachedProcessed: ReadonlyMap<string, Blob>,
  objectUrls: ServiceAssetObjectUrlCache,
): readonly LibraryAsset[] {
  return assets.map((asset) => {
    const cached = cachedProcessed.get(asset.id)
    return createServiceLibraryAsset(asset, cached, objectUrls)
  })
}

export function createOfflineServiceLibraryAssets(
  assets: readonly Parameters<typeof createServiceLibraryAsset>[0][],
  cachedProcessed: ReadonlyMap<string, Blob>,
  objectUrls: ServiceAssetObjectUrlCache | Set<string>,
): readonly LibraryAsset[] {
  const cache = objectUrls instanceof Map ? objectUrls : new Map<string, string>()
  const result = createServiceLibraryAssets(
    assets.filter((asset) => cachedProcessed.has(asset.id)),
    cachedProcessed,
    cache,
  )
  if (objectUrls instanceof Set) {
    for (const asset of result) objectUrls.add(asset.src)
  }
  return result
}
