import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { createAssetId, createLayerId, type ImageLayer } from "../src/features/editor/editor-model"
import { LayerContextMenu } from "../src/features/editor/LayerContextMenu"

const layer: ImageLayer = {
  id: createLayerId("layer-1"),
  assetId: createAssetId("asset-1"),
  name: "花艺",
  visible: true,
  locked: false,
  transform: {
    x: 10,
    y: 20,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    perspectiveX: 0,
    angle: 0,
    flipX: false,
    flipY: false,
    opacity: 1,
  },
}

describe("layer context menu keyboard behavior", () => {
  it("supports arrow navigation, Escape, and restores the trigger focus", () => {
    const trigger = document.createElement("button")
    trigger.textContent = "图层操作"
    document.body.append(trigger)
    trigger.focus()
    const onClose = vi.fn()
    const view = render(
      <LayerContextMenu
        canPaste
        layer={layer}
        x={40}
        y={40}
        onClose={onClose}
        onCopy={() => undefined}
        onCut={() => undefined}
        onDelete={() => undefined}
        onDuplicate={() => undefined}
        onMove={() => undefined}
        onPaste={() => undefined}
      />,
    )

    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "剪切" }))
    fireEvent.keyDown(document, { key: "ArrowDown" })
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "复制" }))
    fireEvent.keyDown(document, { key: "End" })
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "删除" }))
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)

    view.unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})
