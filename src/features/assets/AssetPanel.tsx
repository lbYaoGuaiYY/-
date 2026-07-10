import { MagnifyingGlass, Plus, UploadSimple } from "@phosphor-icons/react"
import type { ChangeEvent } from "react"
import { useId, useRef, useState } from "react"
import type { DemoAsset } from "./demo-assets"
import { DEMO_ASSETS } from "./demo-assets"

const LOCAL_ASSET_ACCEPT = "image/png,image/webp,image/jpeg"

export type AssetPanelProps = {
  readonly onAddAsset: (asset: DemoAsset) => void
  readonly onImportFiles: (files: readonly File[]) => void
}

export function AssetPanel({ onAddAsset, onImportFiles }: AssetPanelProps) {
  const [query, setQuery] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileInputId = useId()
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN")
  const visibleAssets = DEMO_ASSETS.filter((asset) => {
    const searchableText = `${asset.name} ${asset.category}`.toLocaleLowerCase("zh-CN")
    return searchableText.includes(normalizedQuery)
  })

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>): void {
    const input = event.currentTarget
    const files = input.files === null ? [] : Array.from(input.files)

    if (files.length > 0) {
      onImportFiles(files)
    }

    input.value = ""
  }

  return (
    <aside className="asset-panel" aria-labelledby="asset-panel-title">
      <header className="asset-panel__header">
        <div className="asset-panel__heading">
          <h2 id="asset-panel-title">素材</h2>
          <span className="asset-panel__count">{DEMO_ASSETS.length} 项</span>
        </div>

        <button
          className="asset-panel__import-button"
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadSimple aria-hidden="true" size={16} weight="bold" />
          <span>导入本地素材</span>
        </button>
        <input
          ref={fileInputRef}
          id={fileInputId}
          data-testid="asset-file-input"
          type="file"
          accept={LOCAL_ASSET_ACCEPT}
          multiple
          hidden
          onChange={handleFileSelection}
        />
      </header>

      <label className="asset-panel__search">
        <span className="asset-panel__search-label">搜索素材</span>
        <span className="asset-panel__search-control">
          <MagnifyingGlass aria-hidden="true" size={16} />
          <input
            type="search"
            value={query}
            placeholder="名称或分类"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </span>
      </label>

      {visibleAssets.length > 0 ? (
        <ul className="asset-panel__grid" aria-label="内置素材">
          {visibleAssets.map((asset) => (
            <li key={asset.id}>
              <button
                className="asset-tile"
                data-testid={`asset-card-${asset.id}`}
                type="button"
                title={`添加${asset.name}`}
                aria-label={`添加素材：${asset.name}`}
                onClick={() => onAddAsset(asset)}
              >
                <span className="asset-tile__preview">
                  <img src={asset.src} alt="" draggable={false} />
                </span>
                <span className="asset-tile__details">
                  <span className="asset-tile__name">{asset.name}</span>
                  <span className="asset-tile__category">{asset.category}</span>
                </span>
                <Plus className="asset-tile__add-icon" aria-hidden="true" size={16} weight="bold" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="asset-panel__empty" role="status">
          没有找到“{query.trim()}”
        </p>
      )}
    </aside>
  )
}
