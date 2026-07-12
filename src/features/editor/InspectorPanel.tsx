import { FlipHorizontal, FlipVertical, SlidersHorizontal, X } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"

import type { ImageLayer, LayerTransform } from "./editor-model"
import {
  applyPerspectiveAngle,
  applyPerspectivePreset,
  getActivePerspectivePreset,
  PERSPECTIVE_PRESETS,
} from "./perspective-presets"

type FlipAxis = "horizontal" | "vertical"

export type InspectorPanelProps = {
  readonly layer: ImageLayer | null
  readonly readOnly: boolean
  readonly selectionCount: number
  readonly onClose: () => void
  readonly onPreview: (transform: Partial<LayerTransform>) => void
  readonly onToggleFlip: (axis: FlipAxis) => void
  readonly onUpdate: (transform: Partial<LayerTransform>) => void
}

export function InspectorPanel({
  layer,
  readOnly,
  selectionCount,
  onClose,
  onPreview,
  onToggleFlip,
  onUpdate,
}: InspectorPanelProps) {
  const [perspectiveDraft, setPerspectiveDraft] = useState<number | null>(null)
  const perspectiveDraftRef = useRef<number | null>(null)
  const draftLayerIdRef = useRef(layer?.id ?? null)
  const perspectiveTransform =
    layer === null || perspectiveDraft === null
      ? (layer?.transform ?? null)
      : { ...layer.transform, perspectiveX: perspectiveDraft }
  const activePerspective =
    perspectiveTransform === null ? null : getActivePerspectivePreset(perspectiveTransform)

  useEffect(() => {
    if (draftLayerIdRef.current === (layer?.id ?? null)) return
    draftLayerIdRef.current = layer?.id ?? null
    perspectiveDraftRef.current = null
    setPerspectiveDraft(null)
  }, [layer?.id])

  function handlePerspectiveChange(value: number): void {
    if (layer === null) return
    draftLayerIdRef.current = layer.id
    perspectiveDraftRef.current = value
    setPerspectiveDraft(value)
    onPreview(applyPerspectiveAngle(value))
  }

  function commitPerspective(): void {
    const value = perspectiveDraftRef.current
    if (value === null) return
    perspectiveDraftRef.current = null
    setPerspectiveDraft(null)
    onUpdate(applyPerspectiveAngle(value))
  }

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
      {layer === null && selectionCount === 0 ? (
        <div className="empty-state inspector-empty">
          <SlidersHorizontal size={28} weight="thin" aria-hidden="true" />
          <p>选择一个素材后调整位置、比例和角度</p>
        </div>
      ) : layer === null ? (
        <div className="panel-body">
          <div className="selected-object-name">已选 {selectionCount} 个素材</div>
          <fieldset className="inspector-actions">
            <legend className="sr-only">批量翻转素材</legend>
            <button
              className="text-button"
              type="button"
              aria-label="批量水平翻转"
              disabled={readOnly}
              onClick={() => onToggleFlip("horizontal")}
            >
              <FlipHorizontal size={16} aria-hidden="true" />
              批量水平翻转
            </button>
            <button
              className="text-button"
              type="button"
              aria-label="批量垂直翻转"
              disabled={readOnly}
              onClick={() => onToggleFlip("vertical")}
            >
              <FlipVertical size={16} aria-hidden="true" />
              批量垂直翻转
            </button>
          </fieldset>
        </div>
      ) : (
        <div className="panel-body">
          <div className="selected-object-name" title={layer.name}>
            {layer.name}
          </div>
          {readOnly && <p className="locked-layer-note">请先显示并解锁图层再进行编辑</p>}
          <div className="property-grid">
            <NumberField
              label="X"
              value={Math.round(layer.transform.x)}
              disabled={readOnly}
              onValue={(x) => onUpdate({ x })}
            />
            <NumberField
              label="Y"
              value={Math.round(layer.transform.y)}
              disabled={readOnly}
              onValue={(y) => onUpdate({ y })}
            />
            <NumberField
              label="缩放"
              value={Math.round(layer.transform.scaleX * 100)}
              min={1}
              max={500}
              suffix="%"
              disabled={readOnly}
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
              disabled={readOnly}
              onValue={(angle) => onUpdate({ angle })}
            />
            <NumberField
              label="透明度"
              value={Math.round(layer.transform.opacity * 100)}
              min={0}
              max={100}
              suffix="%"
              disabled={readOnly}
              onValue={(opacityPercent) => onUpdate({ opacity: opacityPercent / 100 })}
            />
          </div>
          <span className="field-label">立体朝向</span>
          <label className="field-group">
            <span className="field-label">
              左右朝向（{Math.round(perspectiveDraft ?? layer.transform.perspectiveX ?? 0)}°）
            </span>
            <input
              type="range"
              min={-60}
              max={60}
              step={1}
              value={perspectiveDraft ?? layer.transform.perspectiveX ?? 0}
              disabled={readOnly}
              aria-label="左右朝向角度"
              onChange={(event) => handlePerspectiveChange(event.currentTarget.valueAsNumber)}
              onPointerUp={commitPerspective}
              onPointerCancel={commitPerspective}
              onKeyUp={commitPerspective}
              onBlur={commitPerspective}
            />
          </label>
          <fieldset className="inspector-actions">
            <legend className="sr-only">调整素材立体朝向</legend>
            {PERSPECTIVE_PRESETS.map((preset) => (
              <button
                className={`text-button${activePerspective === preset.id ? " is-active" : ""}`}
                type="button"
                key={preset.id}
                aria-label={preset.ariaLabel}
                aria-pressed={activePerspective === preset.id}
                disabled={readOnly}
                onClick={() => onUpdate(applyPerspectivePreset(layer.transform, preset.id))}
              >
                {preset.label}
              </button>
            ))}
          </fieldset>
          <fieldset className="inspector-actions">
            <legend className="sr-only">翻转素材</legend>
            <button
              className={`text-button${layer.transform.flipX ? " is-active" : ""}`}
              type="button"
              disabled={readOnly}
              onClick={() => onUpdate({ flipX: !layer.transform.flipX })}
            >
              <FlipHorizontal size={16} aria-hidden="true" />
              水平翻转
            </button>
            <button
              className={`text-button${layer.transform.flipY ? " is-active" : ""}`}
              type="button"
              disabled={readOnly}
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
  readonly disabled?: boolean
  readonly onValue: (value: number) => void
}

function NumberField({ label, value, min, max, suffix, disabled, onValue }: NumberFieldProps) {
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
        disabled={disabled}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber
          if (!Number.isFinite(next)) return
          const boundedMin = min ?? Number.NEGATIVE_INFINITY
          const boundedMax = max ?? Number.POSITIVE_INFINITY
          onValue(Math.min(boundedMax, Math.max(boundedMin, next)))
        }}
      />
    </label>
  )
}
