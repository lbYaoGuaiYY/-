import { useMemo, useState } from "react"

import { BUILT_IN_LIBRARY_ASSETS, type LibraryAsset } from "./asset-library"
import type { AssetCategory } from "./demo-assets"
import { type ManagedAssetsState, useManagedAssets } from "./use-managed-assets"

export type EditorAssetLibraryOptions = {
  readonly enabled?: boolean
}

export type EditorAssetLibrary = {
  readonly assets: readonly LibraryAsset[]
  readonly category: AssetCategory | ""
  readonly hasMore: boolean
  readonly isLoadingMore: boolean
  readonly loadMore: () => void
  readonly query: string
  readonly refresh: () => void
  readonly setCategory: (category: AssetCategory | "") => void
  readonly setQuery: (query: string) => void
  readonly status: "loading" | "ready" | "error"
}

export function useEditorAssetLibrary(options: EditorAssetLibraryOptions = {}): EditorAssetLibrary {
  const enabled = options.enabled ?? true
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<AssetCategory | "">("")
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN")
  const managed = useManagedAssets({ search: query.trim(), category }, { enabled })
  const builtInAssets = useMemo(
    () =>
      BUILT_IN_LIBRARY_ASSETS.filter((asset) => {
        if (category !== "" && asset.category !== category) return false
        return `${asset.name} ${asset.category}`
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedQuery)
      }),
    [category, normalizedQuery],
  )
  const assets = useMemo(
    () =>
      selectEditorAssetSource(enabled ? managed.status : "error", builtInAssets, managed.assets),
    [builtInAssets, enabled, managed.assets, managed.status],
  )

  return {
    assets,
    category,
    hasMore: managed.hasMore,
    isLoadingMore: managed.isLoadingMore,
    loadMore: managed.loadMore,
    query,
    refresh: managed.refresh,
    setCategory,
    setQuery,
    status: managed.status,
  }
}

export function selectEditorAssetSource(
  status: ManagedAssetsState["status"],
  builtInAssets: readonly LibraryAsset[],
  managedAssets: readonly LibraryAsset[],
): readonly LibraryAsset[] {
  return status === "error" ? builtInAssets : managedAssets
}
