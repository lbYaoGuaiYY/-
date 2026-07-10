import { Canvas, type FabricImage, type FabricObject } from "fabric"

import type { AssetRecord, AssetRegistry } from "./asset-registry"
import { clampAssetCenter, type LayerPlacementRequest } from "./drag-placement"
import type {
  CanvasSize,
  EditorDocument,
  ImageLayer,
  LayerId,
  LayerTransform,
} from "./editor-model"
import { configureFabricImage, loadFabricImage, readFabricTransform } from "./fabric-image"
import { type LayerDirection, moveFabricSelection, reorderFabricLayers } from "./fabric-layer-order"

export type { LayerDirection } from "./fabric-layer-order"

type LayerMeta = {
  readonly assetId: ImageLayer["assetId"]
  readonly name: string
  readonly visible: boolean
  readonly locked: boolean
}

export class FabricRuntime {
  private readonly canvas: Canvas
  private readonly objectIds = new WeakMap<FabricObject, LayerId>()
  private readonly layerObjects = new Map<LayerId, FabricImage>()
  private readonly layerMeta = new Map<LayerId, LayerMeta>()
  private readonly accentColor: string
  private viewportWidth = 960
  private viewportHeight = 640

  constructor(element: HTMLCanvasElement) {
    const styles = getComputedStyle(element)
    this.accentColor = styles.getPropertyValue("--accent-primary").trim() || "#5B8DEF"
    this.canvas = new Canvas(element, {
      width: 1200,
      height: 800,
      preserveObjectStacking: true,
      selection: false,
      selectionBorderColor: this.accentColor,
      selectionColor: `${this.accentColor}22`,
    })
  }

  onSelectionChange(listener: () => void): () => void {
    const removeCreated = this.canvas.on("selection:created", listener)
    const removeUpdated = this.canvas.on("selection:updated", listener)
    const removeCleared = this.canvas.on("selection:cleared", listener)
    return () => {
      removeCreated()
      removeUpdated()
      removeCleared()
    }
  }

  onObjectModified(listener: () => void): () => void {
    return this.canvas.on("object:modified", listener)
  }

  async importBackground(record: AssetRecord): Promise<CanvasSize | null> {
    const image = await loadFabricImage(record)
    if (image.width <= 0 || image.height <= 0) return null

    const size = { width: image.width, height: image.height } satisfies CanvasSize
    this.canvas.setDimensions(size)
    image.set({
      left: size.width / 2,
      top: size.height / 2,
      originX: "center",
      originY: "center",
      selectable: false,
      evented: false,
    })
    this.canvas.backgroundImage = image
    this.applyDisplaySize()
    this.canvas.requestRenderAll()
    return size
  }

  async addLayer(
    record: AssetRecord,
    id: LayerId,
    { canvasSize: size, center }: LayerPlacementRequest,
  ): Promise<boolean> {
    const image = await loadFabricImage(record)
    if (image.width <= 0 || image.height <= 0) return false

    const scale = Math.min(
      (size.width * 0.36) / image.width,
      (size.height * 0.52) / image.height,
      1,
    )
    const placement = clampAssetCenter(
      center ?? { x: size.width / 2, y: size.height / 2 },
      { width: image.width * scale, height: image.height * scale },
      size,
    )
    if (placement.kind === "invalid") return false
    configureFabricImage(
      image,
      {
        x: placement.point.x,
        y: placement.point.y,
        scaleX: scale,
        scaleY: scale,
        angle: 0,
        flipX: false,
        flipY: false,
        opacity: 1,
      },
      this.accentColor,
    )
    this.registerLayer(image, id, {
      assetId: record.id,
      name: record.name,
      visible: true,
      locked: false,
    })
    this.canvas.add(image)
    this.canvas.setActiveObject(image)
    this.canvas.requestRenderAll()
    return true
  }

  async restore(documentState: EditorDocument, assets: AssetRegistry): Promise<void> {
    this.canvas.discardActiveObject()
    this.canvas.remove(...this.canvas.getObjects())
    delete this.canvas.backgroundImage
    this.layerObjects.clear()
    this.layerMeta.clear()
    this.canvas.setDimensions(documentState.canvasSize)

    if (documentState.backgroundAssetId !== null) {
      const background = assets.get(documentState.backgroundAssetId)
      if (background !== undefined) {
        await this.restoreBackground(background, documentState.canvasSize)
      }
    }

    for (const layer of documentState.layers) {
      const record = assets.get(layer.assetId)
      if (record !== undefined) {
        const image = await loadFabricImage(record)
        configureFabricImage(image, layer.transform, this.accentColor)
        this.registerLayer(image, layer.id, {
          assetId: layer.assetId,
          name: layer.name,
          visible: layer.visible,
          locked: layer.locked,
        })
        this.canvas.add(image)
      }
    }

    this.applyDisplaySize()
    this.canvas.requestRenderAll()
  }

  captureLayers(): readonly ImageLayer[] {
    const layers: ImageLayer[] = []
    for (const object of this.canvas.getObjects()) {
      const id = this.objectIds.get(object)
      const meta = id === undefined ? undefined : this.layerMeta.get(id)
      if (id !== undefined && meta !== undefined) {
        layers.push({ id, ...meta, transform: readFabricTransform(object) })
      }
    }
    return layers
  }

  getSelectedLayerId(): LayerId | null {
    const active = this.canvas.getActiveObject()
    return active === undefined ? null : (this.objectIds.get(active) ?? null)
  }

  selectLayer(id: LayerId): void {
    const object = this.layerObjects.get(id)
    if (object === undefined) return
    this.canvas.setActiveObject(object)
    this.canvas.requestRenderAll()
  }

  clearSelection(): boolean {
    if (this.canvas.getActiveObject() === undefined) return false
    this.canvas.discardActiveObject()
    this.canvas.requestRenderAll()
    return true
  }

  deleteSelection(): boolean {
    const object = this.canvas.getActiveObject()
    if (object === undefined) return false
    this.canvas.remove(object)
    this.canvas.discardActiveObject()
    this.canvas.requestRenderAll()
    return true
  }

  moveSelection(direction: LayerDirection): boolean {
    return moveFabricSelection(this.canvas, direction)
  }

  reorderLayers(order: readonly LayerId[]): boolean {
    return reorderFabricLayers(this.canvas, this.layerObjects, order)
  }

  updateSelection(transform: Partial<LayerTransform>): boolean {
    const object = this.canvas.getActiveObject()
    if (object === undefined) return false
    object.set(transform)
    object.setCoords()
    this.canvas.requestRenderAll()
    return true
  }

  nudgeSelection(deltaX: number, deltaY: number): boolean {
    const object = this.canvas.getActiveObject()
    if (object === undefined) return false
    const center = object.getCenterPoint()
    object.set({ left: center.x + deltaX, top: center.y + deltaY })
    object.setCoords()
    this.canvas.requestRenderAll()
    return true
  }

  resizeDisplay(width: number, height: number): number {
    this.viewportWidth = width
    this.viewportHeight = height
    return this.applyDisplaySize()
  }

  async exportPng(): Promise<Blob | null> {
    return this.canvas.toBlob({ format: "png", multiplier: 1, enableRetinaScaling: false })
  }

  async dispose(): Promise<void> {
    await this.canvas.dispose()
  }

  private async restoreBackground(record: AssetRecord, size: CanvasSize): Promise<void> {
    const image = await loadFabricImage(record)
    image.set({
      left: size.width / 2,
      top: size.height / 2,
      originX: "center",
      originY: "center",
      scaleX: size.width / image.width,
      scaleY: size.height / image.height,
      selectable: false,
      evented: false,
    })
    this.canvas.backgroundImage = image
  }

  private registerLayer(image: FabricImage, id: LayerId, meta: LayerMeta): void {
    this.objectIds.set(image, id)
    this.layerObjects.set(id, image)
    this.layerMeta.set(id, meta)
  }

  private applyDisplaySize(): number {
    const width = this.canvas.getWidth()
    const height = this.canvas.getHeight()
    const scale = Math.min(
      Math.max(this.viewportWidth - 96, 160) / width,
      Math.max(this.viewportHeight - 64, 120) / height,
      1,
    )
    this.canvas.setDimensions(
      { width: `${Math.round(width * scale)}px`, height: `${Math.round(height * scale)}px` },
      { cssOnly: true },
    )
    this.canvas.calcOffset()
    return scale
  }
}
