import { Image, Stack, X } from "@phosphor-icons/react"

import type { ImageLayer, LayerId } from "./editor-model"

export type LayerPanelProps = {
  readonly layers: readonly ImageLayer[]
  readonly selectedLayerId: LayerId | null
  readonly onClose: () => void
  readonly onSelect: (id: LayerId) => void
}

export function LayerPanel({ layers, selectedLayerId, onClose, onSelect }: LayerPanelProps) {
  const displayLayers = [...layers].reverse()

  return (
    <section className="panel-section" aria-labelledby="layers-title">
      <header className="panel-header">
        <h2 className="panel-title" id="layers-title">
          图层 <span className="panel-count">{layers.length}</span>
        </h2>
        <button
          className="icon-button mobile-panel-close"
          type="button"
          aria-label="关闭图层面板"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      {displayLayers.length === 0 ? (
        <div className="empty-state layer-empty">
          <Stack size={28} weight="thin" aria-hidden="true" />
          <p>添加的素材会按前后顺序显示在这里</p>
        </div>
      ) : (
        <ul className="layer-list" data-testid="layer-list" aria-label="素材图层">
          {displayLayers.map((layer) => {
            const selected = layer.id === selectedLayerId
            return (
              <li
                key={layer.id}
                className={`layer-row${selected ? " is-selected" : ""}`}
                data-testid={layerTestId(layer)}
              >
                <Image size={16} aria-hidden="true" />
                <button
                  className="layer-select"
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(layer.id)}
                >
                  <span className="layer-name" title={layer.name}>
                    {layer.name}
                  </span>
                </button>
                <span className="layer-meta">图片</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function layerTestId(layer: ImageLayer): string {
  const assetId = String(layer.assetId)
  if (assetId.startsWith("built-in:")) {
    return `layer-item-${assetId.slice("built-in:".length)}`
  }
  return `layer-item-${String(layer.id)}`
}
