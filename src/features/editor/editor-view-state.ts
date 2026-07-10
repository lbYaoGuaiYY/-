import type { EditorDocument, LayerId } from "./editor-model"
import { canRedo, canUndo, type HistoryState } from "./history-store"

export type EditorViewState = {
  readonly document: EditorDocument
  readonly selectedLayerId: LayerId | null
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly isBusy: boolean
  readonly errorMessage: string | null
  readonly zoomPercent: number
}

export function createEditorViewState(
  history: HistoryState<EditorDocument>,
  selectedLayerId: LayerId | null,
  isBusy: boolean,
  errorMessage: string | null,
  zoomPercent: number,
): EditorViewState {
  return {
    document: history.present,
    selectedLayerId,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    isBusy,
    errorMessage,
    zoomPercent,
  }
}
