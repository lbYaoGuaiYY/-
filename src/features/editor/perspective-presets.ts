import type { LayerTransform } from "./editor-model"

type PerspectivePresetDefinition = {
  readonly id: "front" | "left" | "right"
  readonly label: string
  readonly ariaLabel: string
}

export const PERSPECTIVE_PRESETS = [
  { id: "front", label: "正面", ariaLabel: "正面视图" },
  { id: "left", label: "左侧", ariaLabel: "左侧视图" },
  { id: "right", label: "右侧", ariaLabel: "右侧视图" },
] as const satisfies readonly PerspectivePresetDefinition[]

export type PerspectivePresetId = (typeof PERSPECTIVE_PRESETS)[number]["id"]

type PerspectiveTransform = Pick<LayerTransform, "perspectiveX" | "skewX" | "skewY">

type PerspectivePresetValues = {
  readonly perspectiveX: number
}

const PRESET_VALUES = {
  front: { perspectiveX: 0 },
  left: { perspectiveX: -35 },
  right: { perspectiveX: 35 },
} as const satisfies Record<PerspectivePresetId, PerspectivePresetValues>

export function applyPerspectivePreset(
  _transform: LayerTransform,
  preset: PerspectivePresetId,
): PerspectiveTransform {
  const values = PRESET_VALUES[preset]
  return applyPerspectiveAngle(values.perspectiveX)
}

export function applyPerspectiveAngle(perspectiveX: number): PerspectiveTransform {
  return {
    perspectiveX: Math.min(60, Math.max(-60, perspectiveX)),
    skewX: 0,
    skewY: 0,
  }
}

export function getActivePerspectivePreset(transform: LayerTransform): PerspectivePresetId | null {
  for (const preset of PERSPECTIVE_PRESETS) {
    const expected = applyPerspectivePreset(transform, preset.id)
    if (
      nearlyEqual(transform.perspectiveX ?? 0, expected.perspectiveX ?? 0) &&
      nearlyEqual(transform.skewX ?? 0, expected.skewX ?? 0) &&
      nearlyEqual(transform.skewY ?? 0, expected.skewY ?? 0)
    ) {
      return preset.id
    }
  }
  return null
}

function nearlyEqual(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) < 0.01
}
