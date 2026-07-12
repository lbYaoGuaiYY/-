import type { ServiceAsset } from "./asset-service-client"
import { ASSET_CATEGORIES, type AssetCategory } from "./demo-assets"

export type OfflineAssetPackageKind = "base" | "full" | "category" | "cache"
export type OfflineAssetPackageId =
  | "base"
  | "full"
  | `category:${AssetCategory}`
  | "cache:current-project"

export type OfflineAssetPackageDefinition = {
  readonly id: OfflineAssetPackageId
  readonly kind: OfflineAssetPackageKind
  readonly name: string
  readonly description: string
  readonly category?: AssetCategory
}

export const DOWNLOADABLE_ASSET_PACKAGES: readonly OfflineAssetPackageDefinition[] = [
  {
    id: "base",
    kind: "base",
    name: "基础包",
    description: "素材后台精选的常用素材",
  },
  {
    id: "full",
    kind: "full",
    name: "完整包",
    description: "下载全部已发布素材",
  },
  ...ASSET_CATEGORIES.map((category) => ({
    id: `category:${category}` as const,
    kind: "category" as const,
    name: `${category}包`,
    description: `只下载${category}分类素材`,
    category,
  })),
]

export const CURRENT_PROJECT_CACHE_PACKAGE: OfflineAssetPackageDefinition = {
  id: "cache:current-project",
  kind: "cache",
  name: "当前项目缓存包",
  description: "拖拽未下载素材后自动生成",
}

export function selectAssetsForPackage(
  packageDefinition: OfflineAssetPackageDefinition,
  assets: readonly ServiceAsset[],
): readonly ServiceAsset[] {
  switch (packageDefinition.kind) {
    case "base":
      return assets.filter((asset) => asset.favorite)
    case "category":
      return assets.filter((asset) => asset.category === packageDefinition.category)
    case "full":
    case "cache":
      return assets
    default: {
      const unreachable: never = packageDefinition.kind
      return unreachable
    }
  }
}
