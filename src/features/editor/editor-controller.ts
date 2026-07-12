import type { LibraryAsset } from "../assets/asset-library"
import type { DemoAsset } from "../assets/demo-assets"
import { captureProjectSnapshot as captureSnapshot } from "../projects/editor-project-assets"
import type { ProjectSnapshot } from "../projects/project-format"
import { type AssetRecord, AssetRegistry } from "./asset-registry"
import type { ClientPoint } from "./drag-placement"
import {
  addRuntimeLayer,
  downloadRuntimeImage,
  importRuntimeBackground,
  restoreRuntimeProject,
} from "./editor-controller-operations"
import { copyLayerWithOffset } from "./editor-layer-copy"
import {
  type AssetId,
  createLayerId,
  type EditorDocument,
  type ImageLayer,
  INITIAL_EDITOR_DOCUMENT,
  type LayerId,
  type LayerTransform,
} from "./editor-model"
import { createEditorViewState, type EditorViewState } from "./editor-view-state"
import {
  type AlignmentMode,
  type DistributionMode,
  type ExportImageFormat,
  FabricRuntime,
  type FlipAxis,
  type LayerDirection,
} from "./fabric-runtime"
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
  private clipboard: readonly ImageLayer[] | null = null
  private initialized = false
  private readonly initializedPromise: Promise<void>
  private resolveInitialization: () => void = () => undefined
  private operationQueue: Promise<void> = Promise.resolve()
  private pasteCount = 0
  private pendingPreview: Partial<LayerTransform> | null = null
  private previewFrame: number | null = null
  private state: EditorViewState

  constructor(element: HTMLCanvasElement) {
    this.runtime = new FabricRuntime(element)
    this.initializedPromise = new Promise((resolve) => {
      this.resolveInitialization = resolve
    })
    this.state = createEditorViewState(this.history, null, true, null, 100, false)
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

  captureProject = (): ProjectSnapshot | null => captureSnapshot(this.history.present, this.assets)

  getAssetSource = (id: AssetId): string | undefined => this.assets.get(id)?.src

  async restoreProject(snapshot: ProjectSnapshot): Promise<boolean> {
    this.state = createEditorViewState(
      this.history,
      null,
      true,
      null,
      this.state.zoomPercent,
      this.clipboard !== null,
    )
    this.emit()
    const restored = await restoreRuntimeProject(this.runtime, this.assets, snapshot)
    const zoomPercent = Math.round(this.runtime.fitDisplay() * 100)
    this.history = createHistory(restored ?? INITIAL_EDITOR_DOCUMENT)
    this.state = createEditorViewState(
      this.history,
      null,
      true,
      null,
      zoomPercent,
      this.clipboard !== null,
    )
    this.emit()
    return restored !== null
  }

  finishInitialization(): void {
    if (this.initialized) return
    this.initialized = true
    this.state = createEditorViewState(
      this.history,
      this.state.selectedLayerId,
      false,
      this.state.errorMessage,
      this.state.zoomPercent,
      this.clipboard !== null,
      this.state.selectedLayerIds,
    )
    this.emit()
    this.resolveInitialization()
  }

  resizeDisplay(width: number, height: number): void {
    this.updateZoomState(this.runtime.resizeDisplay(width, height))
  }

  zoomBy(deltaPercent: number): void {
    this.updateZoomState(
      this.runtime.setDisplayScale((this.state.zoomPercent + deltaPercent) / 100),
    )
  }

  fitDisplay(): void {
    this.updateZoomState(this.runtime.fitDisplay())
  }

  private updateZoomState(scale: number): void {
    const zoomPercent = Math.round(scale * 100)
    this.state = createEditorViewState(
      this.history,
      this.state.selectedLayerId,
      this.state.isBusy,
      this.state.errorMessage,
      zoomPercent,
      this.clipboard !== null,
      this.state.selectedLayerIds,
    )
    this.emit()
  }

  async importBackground(file: File): Promise<void> {
    await this.runBusy(async () => {
      const result = await importRuntimeBackground(this.runtime, this.assets, file)
      if (result.kind === "invalid") this.setError(imageResultMessage(result.reason))
      else if (result.kind === "failed") this.setError("图片无法读取，请确认文件没有损坏")
      else {
        this.commit({
          ...this.history.present,
          canvasSize: result.size,
          backgroundAssetId: result.assetId,
        })
        this.updateZoomState(this.runtime.fitDisplay())
      }
    })
  }

  async addBuiltInAsset(asset: DemoAsset, center: ClientPoint | null = null): Promise<void> {
    await this.runBusy(() => this.addRecord(this.assets.registerBuiltIn(asset), center))
  }

  async addLibraryAsset(asset: LibraryAsset, center: ClientPoint | null = null): Promise<void> {
    await this.runBusy(async () =>
      this.addRecord(await this.assets.registerLibraryAsset(asset), center),
    )
  }

  async addLocalAssets(files: readonly File[]): Promise<void> {
    await this.runBusy(async () => {
      for (const file of files) {
        const validation = await validateImageFile(file)
        if (validation.kind === "valid") {
          await this.addRecord(this.assets.registerFile(file))
        } else {
          this.setError(imageResultMessage(validation.kind))
        }
      }
    })
  }

  deleteSelection = (): void => this.commitRuntimeChange(this.runtime.deleteSelection())

  copySelection = (): boolean => {
    const layers = this.selectedLayers()
    if (layers.length === 0) return false
    this.clipboard = layers.map((layer) => ({ ...layer, transform: { ...layer.transform } }))
    this.pasteCount = 0
    this.refreshState()
    return true
  }

  cutSelection = (): void => {
    if (this.copySelection()) this.deleteSelection()
  }

  pasteSelection = async (): Promise<void> => {
    const source = this.clipboard
    if (source === null || this.state.isBusy) return
    this.pasteCount += 1
    await this.insertLayerCopies(source, this.pasteCount * 12)
  }

  duplicateSelection = async (): Promise<void> => {
    const source = this.selectedLayers()
    if (source.length === 0 || this.state.isBusy) return
    await this.insertLayerCopies(source, 12)
  }

  selectLayer(id: LayerId, additive = false): void {
    if (this.runtime.selectLayer(id, additive)) this.syncSelection()
    else {
      this.state = createEditorViewState(
        this.history,
        id,
        this.state.isBusy,
        this.state.errorMessage,
        this.state.zoomPercent,
        this.clipboard !== null,
      )
      this.emit()
    }
  }

  clearSelection = (): void => {
    if (this.runtime.clearSelection()) this.syncSelection()
  }

  moveSelection = (direction: LayerDirection): void =>
    this.commitRuntimeChange(this.runtime.moveSelection(direction))

  alignSelection = (mode: AlignmentMode): void =>
    this.commitRuntimeChange(this.runtime.alignSelection(mode))

  distributeSelection = (mode: DistributionMode): void =>
    this.commitRuntimeChange(this.runtime.distributeSelection(mode))

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
        this.clipboard !== null,
      )
      this.emit()
    }
  }

  updateSelection = (transform: Partial<LayerTransform>): void => this.commitSelection(transform)

  toggleSelectionFlip = (axis: FlipAxis): void =>
    this.commitRuntimeChange(this.runtime.toggleSelectionFlip(axis))

  previewSelection = (transform: Partial<LayerTransform>): void => {
    this.pendingPreview = transform
    if (this.previewFrame !== null) return
    this.previewFrame = window.requestAnimationFrame(() => {
      this.previewFrame = null
      const nextPreview = this.pendingPreview
      this.pendingPreview = null
      if (nextPreview !== null) this.runtime.previewSelection(nextPreview)
    })
  }

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

  async downloadImage(format: ExportImageFormat): Promise<void> {
    if (this.history.present.backgroundAssetId === null) {
      this.setError("请先导入底图")
      return
    }

    await this.runBusy(async () => {
      if (!(await downloadRuntimeImage(this.runtime, format))) this.setError("图片导出失败，请重试")
    })
  }

  async downloadPng(): Promise<void> {
    await this.downloadImage("png")
  }

  showError(message: string): void {
    this.setError(message)
  }

  clearError = (): void => this.setError(null)

  async dispose(): Promise<void> {
    this.cancelPendingPreview()
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
    else {
      this.assets.discard(record.id)
      this.setError("素材无法读取，请确认文件没有损坏")
    }
  }

  private async insertLayerCopies(source: readonly ImageLayer[], offset: number): Promise<void> {
    await this.runBusy(async () => {
      const inserted: LayerId[] = []
      for (const sourceLayer of source) {
        const record = this.assets.get(sourceLayer.assetId)
        if (record === undefined) {
          this.setError("素材来源已丢失，无法粘贴")
          return
        }
        const layer = copyLayerWithOffset(sourceLayer, createLayerId(crypto.randomUUID()), offset)
        if (!(await this.runtime.addDocumentLayer(record, layer))) {
          this.setError("素材无法读取，请确认文件没有损坏")
          return
        }
        inserted.push(layer.id)
      }
      this.runtime.selectLayers(inserted)
      this.commitRuntimeLayers()
    })
  }

  private commitRuntimeLayers(): void {
    this.commit({ ...this.history.present, layers: this.runtime.captureLayers() })
  }

  private commitRuntimeChange(changed: boolean): void {
    if (changed) this.commitRuntimeLayers()
  }

  private commitSelection(transform: Partial<LayerTransform>): void {
    this.cancelPendingPreview()
    this.commitRuntimeChange(this.runtime.updateSelection(transform))
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
    const selectedLayerIds = this.runtime.getSelectedLayerIds()
    this.state = createEditorViewState(
      this.history,
      this.runtime.getSelectedLayerId(),
      this.state.isBusy,
      this.state.errorMessage,
      this.state.zoomPercent,
      this.clipboard !== null,
      selectedLayerIds,
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
      this.clipboard !== null,
      this.state.selectedLayerIds,
    )
    this.emit()
  }

  private async runBusy(operation: () => Promise<void>): Promise<void> {
    const scheduled = this.operationQueue.then(async () => {
      await this.initializedPromise
      this.state = createEditorViewState(
        this.history,
        this.state.selectedLayerId,
        true,
        null,
        this.state.zoomPercent,
        this.clipboard !== null,
        this.state.selectedLayerIds,
      )
      this.emit()
      try {
        await operation()
      } catch (error) {
        this.setError(
          error instanceof Error ? "操作失败，请确认图片有效后重试" : "操作失败，请重试",
        )
      } finally {
        this.state = createEditorViewState(
          this.history,
          this.state.selectedLayerId,
          false,
          this.state.errorMessage,
          this.state.zoomPercent,
          this.clipboard !== null,
          this.state.selectedLayerIds,
        )
        this.emit()
      }
    })
    this.operationQueue = scheduled.catch(() => undefined)
    await scheduled
  }

  private selectedLayers(): readonly ImageLayer[] {
    const selected = new Set(this.state.selectedLayerIds)
    return this.history.present.layers.filter((layer) => selected.has(layer.id))
  }

  private refreshState(): void {
    this.state = createEditorViewState(
      this.history,
      this.state.selectedLayerId,
      this.state.isBusy,
      this.state.errorMessage,
      this.state.zoomPercent,
      this.clipboard !== null,
      this.state.selectedLayerIds,
    )
    this.emit()
  }

  private emit = (): void => this.listeners.forEach((listener) => void listener())

  private cancelPendingPreview(): void {
    if (this.previewFrame !== null) {
      window.cancelAnimationFrame(this.previewFrame)
      this.previewFrame = null
    }
    this.pendingPreview = null
  }
}
