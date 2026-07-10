import type { EditorDocument, LayerId } from "./editor-model"

export type EditorViewState = {
  readonly document: EditorDocument
  readonly selectedLayerId: LayerId | null
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly isBusy: boolean
  readonly errorMessage: string | null
  readonly zoomPercent: number
}
