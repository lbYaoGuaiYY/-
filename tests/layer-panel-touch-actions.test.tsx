import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ImageLayer } from "../src/features/editor/editor-model"
import { LayerPanel } from "../src/features/editor/LayerPanel"

const layer = {
  id: "layer-1",
  assetId: "built-in:arch",
  name: "花艺拱门",
  visible: true,
  locked: false,
  transform: {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    opacity: 1,
    perspectiveX: 0,
    flipX: false,
    flipY: false,
  },
} as unknown as ImageLayer

describe("touch layer actions", () => {
  it("exposes a touch multi-select mode and a per-layer more-actions button", () => {
    const onSelect = vi.fn()
    render(
      <LayerPanel
        canPaste={false}
        getAssetSource={() => undefined}
        layers={[layer]}
        selectedLayerIds={[]}
        onClose={() => undefined}
        onCopy={vi.fn()}
        onCut={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onLayerStateChange={() => undefined}
        onMove={() => undefined}
        onPaste={() => undefined}
        onReorder={() => undefined}
        onSelect={onSelect}
      />,
    )

    expect(screen.getByRole("button", { name: "启用多选" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "更多花艺拱门操作" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "启用多选" }))
    fireEvent.click(screen.getByRole("button", { name: "花艺拱门" }))
    expect(onSelect).toHaveBeenLastCalledWith("layer-1", true)

    fireEvent.click(screen.getByRole("button", { name: "更多花艺拱门操作" }))
    expect(screen.getByRole("menu", { name: "花艺拱门图层操作" })).toBeTruthy()
  })
})
