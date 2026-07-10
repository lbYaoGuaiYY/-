export type HistoryState<T extends object> = {
  readonly past: readonly T[]
  readonly present: T
  readonly future: readonly T[]
}

export function createHistory<T extends object>(present: T): HistoryState<T> {
  return { past: [], present, future: [] }
}

export function commitHistory<T extends object>(state: HistoryState<T>, next: T): HistoryState<T> {
  return {
    past: [...state.past, state.present],
    present: next,
    future: [],
  }
}

export function undoHistory<T extends object>(state: HistoryState<T>): HistoryState<T> {
  const previous = state.past.at(-1)
  if (previous === undefined) {
    return state
  }

  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future],
  }
}

export function redoHistory<T extends object>(state: HistoryState<T>): HistoryState<T> {
  const next = state.future.at(0)
  if (next === undefined) {
    return state
  }

  return {
    past: [...state.past, state.present],
    present: next,
    future: state.future.slice(1),
  }
}

export function canUndo<T extends object>(state: HistoryState<T>): boolean {
  return state.past.length > 0
}

export function canRedo<T extends object>(state: HistoryState<T>): boolean {
  return state.future.length > 0
}
