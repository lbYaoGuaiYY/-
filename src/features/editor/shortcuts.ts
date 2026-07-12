export const EDITOR_SHORTCUT = {
  undo: "undo",
  redo: "redo",
  copySelection: "copy-selection",
  pasteSelection: "paste-selection",
  cutSelection: "cut-selection",
  duplicateSelection: "duplicate-selection",
  deleteSelection: "delete-selection",
  layerUp: "layer-up",
  layerDown: "layer-down",
  layerToFront: "layer-to-front",
  layerToBack: "layer-to-back",
} as const

export type EditorShortcut = (typeof EDITOR_SHORTCUT)[keyof typeof EDITOR_SHORTCUT]

export type ShortcutKeyEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "target"
>

type ClosestEventTarget = EventTarget & {
  readonly closest: (selector: string) => EventTarget | null
}

function supportsClosest(target: EventTarget): target is ClosestEventTarget {
  return "closest" in target && typeof target.closest === "function"
}

export function isEditorTextTarget(target: EventTarget | null): boolean {
  if (target === null || !supportsClosest(target)) {
    return false
  }

  const selector =
    "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"
  return target.closest(selector) !== null
}

export function resolveEditorShortcut(event: ShortcutKeyEvent): EditorShortcut | null {
  if (event.altKey || isEditorTextTarget(event.target)) {
    return null
  }

  const key = event.key.toLowerCase()
  const hasPrimaryModifier = event.ctrlKey || event.metaKey

  if (hasPrimaryModifier && key === "z") {
    return event.shiftKey ? EDITOR_SHORTCUT.redo : EDITOR_SHORTCUT.undo
  }

  if (event.ctrlKey && !event.metaKey && !event.shiftKey && key === "y") {
    return EDITOR_SHORTCUT.redo
  }

  if (hasPrimaryModifier && !event.shiftKey && key === "c") {
    return EDITOR_SHORTCUT.copySelection
  }

  if (hasPrimaryModifier && !event.shiftKey && key === "v") {
    return EDITOR_SHORTCUT.pasteSelection
  }

  if (hasPrimaryModifier && !event.shiftKey && key === "x") {
    return EDITOR_SHORTCUT.cutSelection
  }

  if (hasPrimaryModifier && !event.shiftKey && key === "d") {
    return EDITOR_SHORTCUT.duplicateSelection
  }

  if (hasPrimaryModifier && event.code === "BracketRight") {
    return event.shiftKey ? EDITOR_SHORTCUT.layerToFront : EDITOR_SHORTCUT.layerUp
  }

  if (hasPrimaryModifier && event.code === "BracketLeft") {
    return event.shiftKey ? EDITOR_SHORTCUT.layerToBack : EDITOR_SHORTCUT.layerDown
  }

  if (!hasPrimaryModifier && !event.shiftKey && (key === "delete" || key === "backspace")) {
    return EDITOR_SHORTCUT.deleteSelection
  }

  return null
}
