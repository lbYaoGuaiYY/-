import { describe, expect, it } from "vitest"

import { createLayerId } from "../src/features/editor/editor-model"
import {
  canRedo,
  canUndo,
  commitHistory,
  createHistory,
  redoHistory,
  undoHistory,
} from "../src/features/editor/history-store"
import {
  moveLayerDown,
  moveLayerToBack,
  moveLayerToFront,
  moveLayerUp,
} from "../src/features/editor/layer-order"
import {
  EDITOR_SHORTCUT,
  resolveEditorShortcut,
  type ShortcutKeyEvent,
} from "../src/features/editor/shortcuts"

type Revision = {
  readonly value: number
}

class EditableShortcutTarget extends EventTarget {
  closest(): EventTarget {
    return this
  }
}

function shortcutEvent(overrides: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return {
    key: "",
    code: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target: null,
    ...overrides,
  }
}

describe("history store", () => {
  it("moves snapshots through past, present and future", () => {
    // Given
    const first: Revision = { value: 0 }
    const second: Revision = { value: 1 }
    const third: Revision = { value: 2 }
    const committed = commitHistory(commitHistory(createHistory(first), second), third)

    // When
    const undone = undoHistory(committed)
    const redone = redoHistory(undone)

    // Then
    expect(undone).toEqual({ past: [first], present: second, future: [third] })
    expect(redone).toEqual({ past: [first, second], present: third, future: [] })
    expect(canUndo(redone)).toBe(true)
    expect(canRedo(redone)).toBe(false)
  })

  it("clears the redo branch after committing from an undone state", () => {
    // Given
    const first: Revision = { value: 0 }
    const second: Revision = { value: 1 }
    const abandoned: Revision = { value: 2 }
    const replacement: Revision = { value: 3 }
    const undone = undoHistory(
      commitHistory(commitHistory(createHistory(first), second), abandoned),
    )

    // When
    const branched = commitHistory(undone, replacement)

    // Then
    expect(branched).toEqual({ past: [first, second], present: replacement, future: [] })
    expect(canRedo(branched)).toBe(false)
  })

  it("keeps the same state at undo and redo boundaries", () => {
    // Given
    const initial = createHistory<Revision>({ value: 0 })

    // When
    const undoBoundary = undoHistory(initial)
    const redoBoundary = redoHistory(initial)

    // Then
    expect(undoBoundary).toBe(initial)
    expect(redoBoundary).toBe(initial)
    expect(canUndo(initial)).toBe(false)
    expect(canRedo(initial)).toBe(false)
  })
})

describe("layer order", () => {
  const back = createLayerId("back")
  const middle = createLayerId("middle")
  const front = createLayerId("front")
  const order = [back, middle, front]

  it("moves a layer one position toward the front or back", () => {
    // When
    const movedUp = moveLayerUp(order, middle)
    const movedDown = moveLayerDown(order, middle)

    // Then
    expect(movedUp).toEqual([back, front, middle])
    expect(movedDown).toEqual([middle, back, front])
  })

  it("moves a layer directly to the front or back", () => {
    // When
    const movedToFront = moveLayerToFront(order, back)
    const movedToBack = moveLayerToBack(order, front)

    // Then
    expect(movedToFront).toEqual([middle, front, back])
    expect(movedToBack).toEqual([front, back, middle])
  })

  it("preserves the original order at boundaries and for unknown layers", () => {
    // Given
    const unknown = createLayerId("unknown")

    // When
    const raisedBoundary = moveLayerUp(order, front)
    const loweredBoundary = moveLayerDown(order, back)
    const frontBoundary = moveLayerToFront(order, front)
    const backBoundary = moveLayerToBack(order, back)
    const missingLayer = moveLayerUp(order, unknown)

    // Then
    expect(raisedBoundary).toBe(order)
    expect(loweredBoundary).toBe(order)
    expect(frontBoundary).toBe(order)
    expect(backBoundary).toBe(order)
    expect(missingLayer).toBe(order)
  })
})

describe("editor shortcuts", () => {
  it("maps platform undo and redo combinations", () => {
    // When
    const controlUndo = resolveEditorShortcut(shortcutEvent({ key: "z", ctrlKey: true }))
    const commandUndo = resolveEditorShortcut(shortcutEvent({ key: "Z", metaKey: true }))
    const shiftRedo = resolveEditorShortcut(
      shortcutEvent({ key: "z", metaKey: true, shiftKey: true }),
    )
    const controlRedo = resolveEditorShortcut(shortcutEvent({ key: "y", ctrlKey: true }))

    // Then
    expect(controlUndo).toBe(EDITOR_SHORTCUT.undo)
    expect(commandUndo).toBe(EDITOR_SHORTCUT.undo)
    expect(shiftRedo).toBe(EDITOR_SHORTCUT.redo)
    expect(controlRedo).toBe(EDITOR_SHORTCUT.redo)
  })

  it("maps deletion and layer ordering combinations", () => {
    // When
    const deletion = resolveEditorShortcut(shortcutEvent({ key: "Delete" }))
    const raised = resolveEditorShortcut(shortcutEvent({ code: "BracketRight", ctrlKey: true }))
    const sentBack = resolveEditorShortcut(
      shortcutEvent({ code: "BracketLeft", metaKey: true, shiftKey: true }),
    )

    // Then
    expect(deletion).toBe(EDITOR_SHORTCUT.deleteSelection)
    expect(raised).toBe(EDITOR_SHORTCUT.layerUp)
    expect(sentBack).toBe(EDITOR_SHORTCUT.layerToBack)
  })

  it("leaves native editing shortcuts to editable targets", () => {
    // Given
    const input = new EditableShortcutTarget()
    const editableChild = new EditableShortcutTarget()

    // When
    const inputShortcut = resolveEditorShortcut(
      shortcutEvent({ key: "z", ctrlKey: true, target: input }),
    )
    const editableShortcut = resolveEditorShortcut(
      shortcutEvent({ key: "Delete", target: editableChild }),
    )

    // Then
    expect(inputShortcut).toBeNull()
    expect(editableShortcut).toBeNull()
  })

  it("ignores unrelated and modified delete keys", () => {
    // When
    const unrelated = resolveEditorShortcut(shortcutEvent({ key: "a" }))
    const modifiedDelete = resolveEditorShortcut(shortcutEvent({ key: "Backspace", ctrlKey: true }))
    const alternateUndo = resolveEditorShortcut(
      shortcutEvent({ key: "z", ctrlKey: true, altKey: true }),
    )

    // Then
    expect(unrelated).toBeNull()
    expect(modifiedDelete).toBeNull()
    expect(alternateUndo).toBeNull()
  })
})
