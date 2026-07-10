import { describe, expect, it } from "vitest"

import { createLayerId } from "../src/features/editor/editor-model"
import { reorderLayersFromPanel, toLayerPanelOrder } from "../src/features/editor/layer-order"

const back = createLayerId("back")
const middle = createLayerId("middle")
const front = createLayerId("front")

describe("layer display order", () => {
  it("shows document layers from front to back without mutating the document order", () => {
    // Given
    const documentOrder = [back, middle, front] as const

    // When
    const displayOrder = toLayerPanelOrder(documentOrder)

    // Then
    expect(displayOrder).toEqual([front, middle, back])
    expect(documentOrder).toEqual([back, middle, front])
  })

  it("maps a panel reorder back to the document back-to-front order", () => {
    // Given
    const documentOrder = [back, middle, front] as const

    // When
    const reordered = reorderLayersFromPanel(documentOrder, back, front)

    // Then
    expect(reordered).toEqual([middle, front, back])
  })

  it("returns the original order when either layer is unknown", () => {
    // Given
    const documentOrder = [back, middle, front] as const
    const unknown = createLayerId("unknown")

    // When
    const reordered = reorderLayersFromPanel(documentOrder, unknown, front)

    // Then
    expect(reordered).toBe(documentOrder)
  })

  it("returns the original order for a no-op panel drop", () => {
    // Given
    const documentOrder = [back, middle, front] as const

    // When
    const reordered = reorderLayersFromPanel(documentOrder, middle, middle)

    // Then
    expect(reordered).toBe(documentOrder)
  })
})
