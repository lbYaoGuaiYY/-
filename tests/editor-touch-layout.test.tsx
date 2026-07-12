import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  getPinchZoomPercent,
  getTouchPanScrollPosition,
} from "../src/features/editor/editor-touch-gestures"
import { MobileTabbar } from "../src/features/editor/MobileTabbar"

describe("touch-first editor surface", () => {
  it("translates a blank-canvas drag into scroll coordinates", () => {
    expect(
      getTouchPanScrollPosition({ left: 100, top: 80, x: 240, y: 160 }, { x: 180, y: 220 }),
    ).toEqual({ left: 160, top: 20 })
  })

  it("scales pinch zoom from the gesture start and clamps the result", () => {
    expect(getPinchZoomPercent(100, 150, 100)).toBe(150)
    expect(getPinchZoomPercent(100, 10, 100)).toBe(25)
    expect(getPinchZoomPercent(100, 600, 100)).toBe(400)
  })

  it("keeps the mobile editor actions labeled and reachable", () => {
    render(
      <MobileTabbar
        activePanel={null}
        onExport={() => undefined}
        onOpenAssets={() => undefined}
        onOpenLayers={() => undefined}
        onOpenProperties={() => undefined}
      />,
    )

    expect(screen.getByRole("button", { name: "素材" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "图层" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "属性" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "导出" })).toBeTruthy()
  })
})
