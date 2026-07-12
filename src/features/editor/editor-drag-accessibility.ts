import type { Announcements, ScreenReaderInstructions } from "@dnd-kit/core"

import type { LibraryAsset } from "../assets/asset-library"
import { EDITOR_CANVAS_DROP_ID, parseAssetDragPayload } from "./drag-placement"

export const EDITOR_SCREEN_READER_INSTRUCTIONS = {
  draggable:
    "焦点位于婚礼素材时，按空格键或回车键拿起素材。按方向键先移动到设计画布中央，再继续调整位置。再次按空格键或回车键放置，按 Escape 键取消。",
} satisfies ScreenReaderInstructions

export function createEditorDragAnnouncements(assets: readonly LibraryAsset[]): Announcements {
  return {
    onDragStart({ active }) {
      const asset = findLibraryAssetFromDragData(active.data.current, assets)
      return asset === null ? undefined : `已拿起${asset.name}，请用方向键移动到设计画布。`
    },
    onDragOver({ active, over }) {
      const asset = findLibraryAssetFromDragData(active.data.current, assets)
      if (asset === null) return undefined
      return over?.id === EDITOR_CANVAS_DROP_ID
        ? `${asset.name}已进入设计画布，可以放置。`
        : `${asset.name}当前不在设计画布内。`
    },
    onDragEnd({ active, over }) {
      const asset = findLibraryAssetFromDragData(active.data.current, assets)
      if (asset === null) return undefined
      return over?.id === EDITOR_CANVAS_DROP_ID
        ? `已将${asset.name}放到设计画布。`
        : `${asset.name}未放置。`
    },
    onDragCancel({ active }) {
      const asset = findLibraryAssetFromDragData(active.data.current, assets)
      return asset === null ? undefined : `已取消放置${asset.name}。`
    },
  }
}

export function findLibraryAssetFromDragData(
  value: unknown,
  assets: readonly LibraryAsset[],
): LibraryAsset | null {
  const payload = parseAssetDragPayload(value)
  if (payload === null) return null
  return assets.find((asset) => asset.assetId === payload.assetId) ?? null
}
