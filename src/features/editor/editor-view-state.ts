import type { EditorDocument, LayerId } from "./editor-model"
import { canRedo, canUndo, type HistoryState } from "./history-store"

export type EditorViewState = {
  readonly document: EditorDocument
  readonly selectedLayerId: LayerId | null
  readonly selectedLayerIds: readonly LayerId[]
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly hasClipboard: boolean
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
  hasClipboard: boolean,
  selectedLayerIds: readonly LayerId[] = selectedLayerId === null ? [] : [selectedLayerId],
): EditorViewState {
  return {
    document: history.present,
    selectedLayerId,
    selectedLayerIds,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    hasClipboard,
    isBusy,
    errorMessage,
    zoomPercent,
  }
}
