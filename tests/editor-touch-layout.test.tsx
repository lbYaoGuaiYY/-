import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  getPinchGestureTarget,
  getPinchPanScrollPosition,
  getPinchZoomPercent,
  getTouchGestureMode,
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

  it("gives a second touch priority over an object transform", () => {
    expect(getTouchGestureMode(1, true)).toBe("fabric")
    expect(getTouchGestureMode(1, false)).toBe("pan")
    expect(getTouchGestureMode(2, true)).toBe("pinch")
    expect(getTouchGestureMode(2, false)).toBe("pinch")
  })

  it("scales only the selected material when the gesture begins on a material", () => {
    expect(getPinchGestureTarget(true, true)).toBe("selection")
    expect(getPinchGestureTarget(true, false)).toBe("viewport")
    expect(getPinchGestureTarget(false, true)).toBe("viewport")
  })

  it("pans with the midpoint while a two-finger gesture is active", () => {
    expect(
      getPinchPanScrollPosition({ left: 160, top: 90, x: 300, y: 200 }, { x: 248, y: 236 }),
    ).toEqual({ left: 212, top: 54 })
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
    expect(screen.getByRole("button", { name: "删除所选素材" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "更多编辑操作" })).toBeTruthy()
  })
})
