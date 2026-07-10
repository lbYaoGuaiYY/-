import { FlipHorizontal, FlipVertical, SlidersHorizontal, X } from "@phosphor-icons/react"

import type { ImageLayer, LayerTransform } from "./editor-model"

export type InspectorPanelProps = {
  readonly layer: ImageLayer | null
  readonly onClose: () => void
  readonly onUpdate: (transform: Partial<LayerTransform>) => void
}

export function InspectorPanel({ layer, onClose, onUpdate }: InspectorPanelProps) {
  return (
    <section className="panel-section" aria-labelledby="inspector-title">
      <header className="panel-header">
        <h2 className="panel-title" id="inspector-title">
          属性
        </h2>
        <button
          className="icon-button mobile-panel-close"
          type="button"
          aria-label="关闭属性面板"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      {layer === null ? (
        <div className="empty-state inspector-empty">
          <SlidersHorizontal size={28} weight="thin" aria-hidden="true" />
          <p>选择一个素材后调整位置、比例和角度</p>
        </div>
      ) : (
        <div className="panel-body">
          <div className="selected-object-name" title={layer.name}>
            {layer.name}
          </div>
          <div className="property-grid">
            <NumberField
              label="X"
              value={Math.round(layer.transform.x)}
              onValue={(x) => onUpdate({ x })}
            />
            <NumberField
              label="Y"
              value={Math.round(layer.transform.y)}
              onValue={(y) => onUpdate({ y })}
            />
            <NumberField
              label="缩放"
              value={Math.round(layer.transform.scaleX * 100)}
              min={1}
              max={500}
              suffix="%"
              onValue={(scalePercent) => {
                const scale = scalePercent / 100
                onUpdate({ scaleX: scale, scaleY: scale })
              }}
            />
            <NumberField
              label="旋转"
              value={Math.round(layer.transform.angle)}
              min={-360}
              max={360}
              suffix="°"
              onValue={(angle) => onUpdate({ angle })}
            />
            <NumberField
              label="透明度"
              value={Math.round(layer.transform.opacity * 100)}
              min={0}
              max={100}
              suffix="%"
              onValue={(opacityPercent) => onUpdate({ opacity: opacityPercent / 100 })}
            />
          </div>
          <fieldset className="inspector-actions">
            <legend className="sr-only">翻转素材</legend>
            <button
              className={`text-button${layer.transform.flipX ? " is-active" : ""}`}
              type="button"
              onClick={() => onUpdate({ flipX: !layer.transform.flipX })}
            >
              <FlipHorizontal size={16} aria-hidden="true" />
              水平翻转
            </button>
            <button
              className={`text-button${layer.transform.flipY ? " is-active" : ""}`}
              type="button"
              onClick={() => onUpdate({ flipY: !layer.transform.flipY })}
            >
              <FlipVertical size={16} aria-hidden="true" />
              垂直翻转
            </button>
          </fieldset>
        </div>
      )}
    </section>
  )
}

type NumberFieldProps = {
  readonly label: string
  readonly value: number
  readonly min?: number
  readonly max?: number
  readonly suffix?: string
  readonly onValue: (value: number) => void
}

function NumberField({ label, value, min, max, suffix, onValue }: NumberFieldProps) {
  return (
    <label className="field-group">
      <span className="field-label">
        {label}
        {suffix === undefined ? "" : ` (${suffix})`}
      </span>
      <input
        className="numeric-input"
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber
          if (Number.isFinite(next)) onValue(next)
        }}
      />
    </label>
  )
}
