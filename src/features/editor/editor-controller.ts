import type { DemoAsset } from "../assets/demo-assets"
import { captureProjectSnapshot } from "../projects/editor-project-assets"
import type { ProjectSnapshot } from "../projects/project-format"
import { type AssetRecord, AssetRegistry } from "./asset-registry"
import type { ClientPoint } from "./drag-placement"
import {
  addRuntimeLayer,
  downloadRuntimePng,
  restoreRuntimeProject,
} from "./editor-controller-operations"
import {
  type AssetId,
  type EditorDocument,
  type ImageLayer,
  INITIAL_EDITOR_DOCUMENT,
  type LayerId,
  type LayerTransform,
} from "./editor-model"
import { createEditorViewState, type EditorViewState } from "./editor-view-state"
import { FabricRuntime, type LayerDirection } from "./fabric-runtime"
import {
  canRedo,
  canUndo,
  commitHistory,
  createHistory,
  type HistoryState,
  redoHistory,
  undoHistory,
} from "./history-store"
import { imageResultMessage, validateImageFile } from "./image-import"
import { reorderLayersFromPanel } from "./layer-order"

export class EditorController {
  private readonly runtime: FabricRuntime
  private readonly assets = new AssetRegistry()
  private readonly listeners = new Set<() => void>()
  private readonly eventDisposers: readonly (() => void)[]
  private history: HistoryState<EditorDocument> = createHistory(INITIAL_EDITOR_DOCUMENT)
  private state: EditorViewState

  constructor(element: HTMLCanvasElement) {
    this.runtime = new FabricRuntime(element)
    this.state = createEditorViewState(this.history, null, false, null, 100)
    this.eventDisposers = [
      this.runtime.onSelectionChange(() => this.syncSelection()),
      this.runtime.onObjectModified(() => this.commitRuntimeLayers()),
    ]
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): EditorViewState => this.state

  captureProject = (): ProjectSnapshot | null =>
    captureProjectSnapshot(this.history.present, this.assets)

  getAssetSource = (id: AssetId): string | undefined => this.assets.get(id)?.src

  async restoreProject(snapshot: ProjectSnapshot): Promise<boolean> {
    if (this.state.isBusy) return false
    this.state = createEditorViewState(this.history, null, true, null, this.state.zoomPercent)
    this.emit()
    const restored = await restoreRuntimeProject(this.runtime, this.assets, snapshot)
    this.history = createHistory(restored ?? INITIAL_EDITOR_DOCUMENT)
    this.state = createEditorViewState(this.history, null, false, null, this.state.zoomPercent)
    this.emit()
    return restored !== null
  }

  resizeDisplay(width: number, height: number): void {
    const zoomPercent = Math.round(this.runtime.resizeDisplay(width, height) * 100)
    this.state = createEditorViewState(
      this.history,
      this.state.selectedLayerId,
      this.state.isBusy,
      this.state.errorMessage,
      zoomPercent,
    )
    this.emit()
  }

  async importBackground(file: File): Promise<void> {
    const validation = validateImageFile(file)
    if (validation.kind !== "valid") {
      this.setError(imageResultMessage(validation.kind))
      return
    }

    await this.runBusy(async () => {
      const record = this.assets.registerFile(file)
      const size = await this.runtime.importBackground(record)
      if (size === null) {
        this.setError("图片无法读取，请确认文件没有损坏")
        return
      }
      this.commit({ ...this.history.present, canvasSize: size, backgroundAssetId: record.id })
    })
  }

  async addBuiltInAsset(asset: DemoAsset, center: ClientPoint | null = null): Promise<void> {
    await this.runBusy(() => this.addRecord(this.assets.registerBuiltIn(asset), center))
  }

  async addLocalAssets(files: readonly File[]): Promise<void> {
    await this.runBusy(async () => {
      for (const file of files) {
        const validation = validateImageFile(file)
        if (validation.kind === "valid") {
          await this.addRecord(this.assets.registerFile(file))
        } else {
          this.setError(imageResultMessage(validation.kind))
        }
      }
    })
  }

  deleteSelection = (): void => this.commitRuntimeChange(this.runtime.deleteSelection())

  selectLayer(id: LayerId): void {
    if (this.runtime.selectLayer(id)) this.syncSelection()
    else {
      this.state = createEditorViewState(
        this.history,
        id,
        this.state.isBusy,
        this.state.errorMessage,
        this.state.zoomPercent,
      )
      this.emit()
    }
  }

  clearSelection = (): void => {
    if (this.runtime.clearSelection()) this.syncSelection()
  }

  moveSelection = (direction: LayerDirection): void =>
    this.commitRuntimeChange(this.runtime.moveSelection(direction))

  reorderLayers(activeId: LayerId, targetId: LayerId): void {
    const order = this.history.present.layers.map((layer) => layer.id)
    const reordered = reorderLayersFromPanel(order, activeId, targetId)
    if (reordered !== order && this.runtime.reorderLayers(reordered)) this.commitRuntimeLayers()
  }

  updateLayerState(id: LayerId, changes: Partial<Pick<ImageLayer, "visible" | "locked">>): void {
    const preserveRowSelection = this.state.selectedLayerId === id
    if (!this.runtime.updateLayerState(id, changes)) return
    this.commitRuntimeLayers()
    if (preserveRowSelection) {
      if (this.runtime.selectLayer(id)) {
        this.syncSelection()
        return
      }
      this.state = createEditorViewState(
        this.history,
        id,
        this.state.isBusy,
        this.state.errorMessage,
        this.state.zoomPercent,
      )
      this.emit()
    }
  }

  updateSelection = (transform: Partial<LayerTransform>): void =>
    this.commitRuntimeChange(this.runtime.updateSelection(transform))

  nudgeSelection = (deltaX: number, deltaY: number): void =>
    this.commitRuntimeChange(this.runtime.nudgeSelection(deltaX, deltaY))

  async undo(): Promise<void> {
    if (this.state.isBusy || !canUndo(this.history)) return
    this.history = undoHistory(this.history)
    await this.restoreHistory()
  }

  async redo(): Promise<void> {
    if (this.state.isBusy || !canRedo(this.history)) return
    this.history = redoHistory(this.history)
    await this.restoreHistory()
  }

  async downloadPng(): Promise<void> {
    if (this.history.present.backgroundAssetId === null) {
      this.setError("请先导入底图")
      return
    }

    await this.runBusy(async () => {
      if (!(await downloadRuntimePng(this.runtime))) this.setError("图片导出失败，请重试")
    })
  }

  clearError = (): void => this.setError(null)

  async dispose(): Promise<void> {
    for (const disposeEvent of this.eventDisposers) disposeEvent()
    this.assets.dispose()
    await this.runtime.dispose()
    this.listeners.clear()
  }

  private async addRecord(record: AssetRecord, center: ClientPoint | null = null): Promise<void> {
    const added = await addRuntimeLayer(
      this.runtime,
      record,
      this.history.present.canvasSize,
      center,
    )
    if (added) this.commitRuntimeLayers()
    else this.setError("素材无法读取，请确认文件没有损坏")
  }

  private commitRuntimeLayers(): void {
    this.commit({ ...this.history.present, layers: this.runtime.captureLayers() })
  }

  private commitRuntimeChange(changed: boolean): void {
    if (changed) this.commitRuntimeLayers()
  }

  private commit(documentState: EditorDocument): void {
    this.history = commitHistory(this.history, documentState)
    this.syncSelection()
  }

  private async restoreHistory(): Promise<void> {
    await this.runBusy(async () => this.runtime.restore(this.history.present, this.assets))
    this.syncSelection()
  }

  private syncSelection(): void {
    this.state = createEditorViewState(
      this.history,
      this.runtime.getSelectedLayerId(),
      this.state.isBusy,
      this.state.errorMessage,
      this.state.zoomPercent,
    )
    this.emit()
  }

  private setError(errorMessage: string | null): void {
    this.state = createEditorViewState(
      this.history,
      this.state.selectedLayerId,
      this.state.isBusy,
      errorMessage,
      this.state.zoomPercent,
    )
    this.emit()
  }

  private async runBusy(operation: () => Promise<void>): Promise<void> {
    if (this.state.isBusy) return
    this.state = createEditorViewState(
      this.history,
      this.state.selectedLayerId,
      true,
      null,
      this.state.zoomPercent,
    )
    this.emit()
    try {
      await operation()
    } catch (error) {
      this.setError(error instanceof Error ? "操作失败，请确认图片有效后重试" : "操作失败，请重试")
    } finally {
      this.state = createEditorViewState(
        this.history,
        this.state.selectedLayerId,
        false,
        this.state.errorMessage,
        this.state.zoomPercent,
      )
      this.emit()
    }
  }

  private emit = (): void => this.listeners.forEach((listener) => void listener())
}
