import { describe, expect, it, vi } from "vitest"

vi.mock("fabric", () => ({
  ActiveSelection: class MockActiveSelection {
    readonly objects: readonly unknown[]

    constructor(objects: readonly unknown[]) {
      this.objects = objects
    }
  },
  Canvas: class MockCanvas {},
  FabricImage: class MockFabricImage {},
  Line: class MockLine {},
}))

import type { Canvas, FabricObject } from "fabric"
import { createAssetId, createLayerId } from "../src/features/editor/editor-model"
import { moveFabricSelection } from "../src/features/editor/fabric-layer-order"
import { updateFabricLayerState } from "../src/features/editor/fabric-layer-state"
import { FabricRuntime } from "../src/features/editor/fabric-runtime"

function fakeObject(): Record<string, unknown> {
  return {
    visible: true,
    selectable: true,
    evented: true,
    set(values: Record<string, unknown>) {
      Object.assign(this, values)
    },
  }
}

describe("locked layer protection", () => {
  it("removes a locked layer from a multi-selection", () => {
    const locked = fakeObject()
    const editable = fakeObject()
    let active: unknown[] = [locked, editable]
    const canvas = {
      getActiveObjects: () => active,
      discardActiveObject: () => {
        active = []
      },
      setActiveObject: (next: { readonly objects?: readonly unknown[] } | unknown) => {
        active = Array.isArray((next as { readonly objects?: readonly unknown[] }).objects)
          ? [...((next as { readonly objects: readonly unknown[] }).objects ?? [])]
          : [next]
      },
      requestRenderAll: () => undefined,
    } as unknown as Canvas
    const lockedId = createLayerId("locked")
    const editableId = createLayerId("editable")
    const layerObjects = new Map([
      [lockedId, locked],
      [editableId, editable],
    ]) as unknown as ReadonlyMap<typeof lockedId, never>
    const layerMeta = new Map([
      [
        lockedId,
        { assetId: createAssetId("asset:locked"), name: "Locked", visible: true, locked: false },
      ],
      [
        editableId,
        {
          assetId: createAssetId("asset:editable"),
          name: "Editable",
          visible: true,
          locked: false,
        },
      ],
    ])

    const changed = updateFabricLayerState(canvas, layerObjects, layerMeta, lockedId, {
      locked: true,
    })

    expect(changed).toBe(true)
    expect(active).toEqual([editable])
    expect(locked).toMatchObject({ selectable: false, evented: false })
  })

  it("keeps fixed layers in place when moving an editable selection", () => {
    const back = {}
    const locked = {}
    const front = {}
    let order: FabricObject[] = [
      back as FabricObject,
      locked as FabricObject,
      front as FabricObject,
    ]
    const canvas = {
      getActiveObjects: () => [back as FabricObject],
      getObjects: () => order,
      moveObjectTo: (object: FabricObject, index: number) => {
        order = order.filter((candidate) => candidate !== object)
        order.splice(index, 0, object)
      },
      requestRenderAll: () => undefined,
    } as unknown as Canvas

    const changed = moveFabricSelection(
      canvas,
      "front",
      [back as FabricObject],
      new Set([locked as FabricObject]),
    )

    expect(changed).toBe(true)
    expect(order).toEqual([front, locked, back])
  })

  it("rejects panel reorders that move a locked layer's slot", () => {
    const editableBack = {}
    const locked = {}
    const editableFront = {}
    let order: unknown[] = [editableBack, locked, editableFront]
    const canvas = {
      getObjects: () => order,
      moveObjectTo: (object: unknown, index: number) => {
        order = order.filter((candidate) => candidate !== object)
        order.splice(index, 0, object)
      },
      requestRenderAll: () => undefined,
    }
    const backId = createLayerId("back")
    const lockedId = createLayerId("locked")
    const frontId = createLayerId("front")
    const runtime = Object.create(FabricRuntime.prototype) as {
      canvas: typeof canvas
      layerObjects: Map<ReturnType<typeof createLayerId>, object>
      layerMeta: Map<ReturnType<typeof createLayerId>, { locked: boolean }>
      objectIds: WeakMap<object, ReturnType<typeof createLayerId>>
      reorderLayers: (next: readonly ReturnType<typeof createLayerId>[]) => boolean
    }
    runtime.canvas = canvas
    runtime.layerObjects = new Map([
      [backId, editableBack],
      [lockedId, locked],
      [frontId, editableFront],
    ])
    runtime.layerMeta = new Map([
      [backId, { locked: false }],
      [lockedId, { locked: true }],
      [frontId, { locked: false }],
    ])
    runtime.objectIds = new WeakMap([
      [editableBack, backId],
      [locked, lockedId],
      [editableFront, frontId],
    ])

    expect(runtime.reorderLayers([frontId, lockedId, backId])).toBe(true)
    expect(order).toEqual([editableFront, locked, editableBack])
    expect(runtime.reorderLayers([lockedId, frontId, backId])).toBe(false)
    expect(order).toEqual([editableFront, locked, editableBack])
  })

  it("keeps multi-selection transform and nudge operations on the selection wrapper", () => {
    const first = {}
    const second = {}
    const activeSelection = {
      set: vi.fn(),
      setCoords: vi.fn(),
      getCenterPoint: vi.fn(() => ({ x: 100, y: 200 })),
    }
    const canvas = {
      getActiveObjects: () => [first, second],
      getActiveObject: () => activeSelection,
      requestRenderAll: vi.fn(),
    }
    const firstId = createLayerId("first")
    const secondId = createLayerId("second")
    const runtime = Object.create(FabricRuntime.prototype) as {
      canvas: typeof canvas
      layerObjects: Map<ReturnType<typeof createLayerId>, object>
      layerMeta: Map<ReturnType<typeof createLayerId>, { visible: boolean; locked: boolean }>
      updateSelection: (transform: { readonly opacity: number }) => boolean
      nudgeSelection: (deltaX: number, deltaY: number) => boolean
    }
    runtime.canvas = canvas
    runtime.layerObjects = new Map([
      [firstId, first],
      [secondId, second],
    ])
    runtime.layerMeta = new Map([
      [firstId, { visible: true, locked: false }],
      [secondId, { visible: true, locked: false }],
    ])

    expect(runtime.updateSelection({ opacity: 0.5 })).toBe(true)
    expect(activeSelection.set).toHaveBeenCalledWith({ opacity: 0.5 })
    expect(runtime.nudgeSelection(10, -20)).toBe(true)
    expect(activeSelection.set).toHaveBeenCalledWith({ left: 110, top: 180 })
    expect(activeSelection.setCoords).toHaveBeenCalledTimes(2)
  })
})
