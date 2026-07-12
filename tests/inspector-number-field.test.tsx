import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { createAssetId, createLayerId, type ImageLayer } from "../src/features/editor/editor-model"
import { InspectorPanel } from "../src/features/editor/InspectorPanel"

const layer: ImageLayer = {
  id: createLayerId("layer:1"),
  assetId: createAssetId("local:1"),
  name: "测试素材",
  visible: true,
  locked: false,
  transform: {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    flipX: false,
    flipY: false,
    opacity: 1,
  },
}

describe("InspectorPanel number fields", () => {
  it("clamps scale and opacity before updating editor state", () => {
    // Given
    const onUpdate = vi.fn()
    const { container } = render(
      <InspectorPanel
        layer={layer}
        readOnly={false}
        selectionCount={1}
        onClose={() => undefined}
        onPreview={() => undefined}
        onToggleFlip={() => undefined}
        onUpdate={onUpdate}
      />,
    )
    const numberInputs = container.querySelectorAll<HTMLInputElement>('input[type="number"]')
    const scale = numberInputs.item(2)
    const opacity = numberInputs.item(4)

    // When
    fireEvent.change(scale, { target: { value: "600" } })
    fireEvent.change(opacity, { target: { value: "-20" } })

    // Then
    expect(onUpdate).toHaveBeenNthCalledWith(1, { scaleX: 5, scaleY: 5 })
    expect(onUpdate).toHaveBeenNthCalledWith(2, { opacity: 0 })
  })
})
