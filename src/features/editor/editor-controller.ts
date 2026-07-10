import type { DemoAsset } from "../assets/demo-assets"
import { captureProjectSnapshot, registerProjectAssets } from "../projects/editor-project-assets"
import type { ProjectSnapshot } from "../projects/project-format"
import { type AssetRecord, AssetRegistry } from "./asset-registry"
import type { ClientPoint } from "./drag-placement"
import {
  createLayerId,
  type EditorDocument,
  INITIAL_EDITOR_DOCUMENT,
  type LayerId,
  type LayerTransform,
} from "./editor-model"
import type { EditorViewState } from "./editor-view-state"
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

export class EditorController {
  private readonly runtime: FabricRuntime
  private readonly assets = new AssetRegistry()
  private readonly listeners = new Set<() => void>()
  private readonly eventDisposers: readonly (() => void)[]
  private history: HistoryState<EditorDocument> = createHistory(INITIAL_EDITOR_DOCUMENT)
  private state: EditorViewState

  constructor(element: HTMLCanvasElement) {
    this.runtime = new FabricRuntime(element)
    this.state = this.createState(null, false, null, 100)
    this.eventDisposers = [
      this.runtime.onSelectionChange(() => this.syncSelection()),
      this.runtime.onObjectModified(() => this.commitRuntimeLayers()),
    ]
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): EditorViewState {
    return this.state
  }

  captureProject(): ProjectSnapshot | null {
    return captureProjectSnapshot(this.history.present, this.assets)
  }

  async restoreProject(snapshot: ProjectSnapshot): Promise<boolean> {
    if (this.state.isBusy || !registerProjectAssets(snapshot, this.assets)) return false
    this.state = this.createState(null, true, null, this.state.zoomPercent)
    this.emit()
    try {
      await this.runtime.restore(snapshot.document, this.assets)
      this.history = createHistory(snapshot.document)
      return true
    } catch (error) {
      if (!(error instanceof Error)) throw error
      this.history = createHistory(INITIAL_EDITOR_DOCUMENT)
      await this.runtime.restore(INITIAL_EDITOR_DOCUMENT, this.assets)
      return false
    } finally {
      this.state = this.createState(null, false, null, this.state.zoomPercent)
      this.emit()
    }
  }

  resizeDisplay(width: number, height: number): void {
    const zoomPercent = Math.round(this.runtime.resizeDisplay(width, height) * 100)
    this.state = this.createState(
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

  deleteSelection(): void {
    if (this.runtime.deleteSelection()) this.commitRuntimeLayers()
  }

  selectLayer(id: LayerId): void {
    this.runtime.selectLayer(id)
    this.syncSelection()
  }

  clearSelection(): void {
    if (this.runtime.clearSelection()) this.syncSelection()
  }

  moveSelection(direction: LayerDirection): void {
    if (this.runtime.moveSelection(direction)) this.commitRuntimeLayers()
  }

  updateSelection(transform: Partial<LayerTransform>): void {
    if (this.runtime.updateSelection(transform)) this.commitRuntimeLayers()
  }

  nudgeSelection(deltaX: number, deltaY: number): void {
    if (this.runtime.nudgeSelection(deltaX, deltaY)) this.commitRuntimeLayers()
  }

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
      const blob = await this.runtime.exportPng()
      if (blob === null) {
        this.setError("图片导出失败，请重试")
        return
      }
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `轻设设计-${new Date().toISOString().slice(0, 10)}.png`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    })
  }

  clearError(): void {
    this.setError(null)
  }

  async dispose(): Promise<void> {
    for (const disposeEvent of this.eventDisposers) disposeEvent()
    this.assets.dispose()
    await this.runtime.dispose()
    this.listeners.clear()
  }

  private async addRecord(record: AssetRecord, center: ClientPoint | null = null): Promise<void> {
    const id = createLayerId(crypto.randomUUID())
    const added = await this.runtime.addLayer(record, id, {
      canvasSize: this.history.present.canvasSize,
      center,
    })
    if (added) this.commitRuntimeLayers()
    else this.setError("素材无法读取，请确认文件没有损坏")
  }

  private commitRuntimeLayers(): void {
    this.commit({ ...this.history.present, layers: this.runtime.captureLayers() })
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
    this.state = this.createState(
      this.runtime.getSelectedLayerId(),
      this.state.isBusy,
      this.state.errorMessage,
      this.state.zoomPercent,
    )
    this.emit()
  }

  private createState(
    selectedLayerId: LayerId | null,
    isBusy: boolean,
    errorMessage: string | null,
    zoomPercent: number,
  ): EditorViewState {
    return {
      document: this.history.present,
      selectedLayerId,
      canUndo: canUndo(this.history),
      canRedo: canRedo(this.history),
      isBusy,
      errorMessage,
      zoomPercent,
    }
  }

  private setError(errorMessage: string | null): void {
    this.state = this.createState(
      this.state.selectedLayerId,
      this.state.isBusy,
      errorMessage,
      this.state.zoomPercent,
    )
    this.emit()
  }

  private async runBusy(operation: () => Promise<void>): Promise<void> {
    if (this.state.isBusy) return
    this.state = this.createState(this.state.selectedLayerId, true, null, this.state.zoomPercent)
    this.emit()
    try {
      await operation()
    } catch (error) {
      this.setError(error instanceof Error ? "操作失败，请确认图片有效后重试" : "操作失败，请重试")
    } finally {
      this.state = this.createState(
        this.state.selectedLayerId,
        false,
        this.state.errorMessage,
        this.state.zoomPercent,
      )
      this.emit()
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
