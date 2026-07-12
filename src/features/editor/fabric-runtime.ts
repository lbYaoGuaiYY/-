import { ActiveSelection, Canvas, FabricImage, type FabricObject, Line } from "fabric"
import {
  type AlignmentMode,
  calculateAlignment,
  calculateDistribution,
  calculateSnap,
  type DistributionMode,
  type PositionDelta,
} from "./alignment-geometry"
import type { AssetRecord, AssetRegistry } from "./asset-registry"
import { clampAssetCenter, type LayerPlacementRequest } from "./drag-placement"
import type {
  AssetId,
  CanvasSize,
  EditorDocument,
  ImageLayer,
  LayerId,
  LayerTransform,
} from "./editor-model"
import { applyFabricDisplaySize, clampDisplayScale } from "./fabric-display"
import { reconcileFabricDocument } from "./fabric-document-reconcile"
import {
  configureFabricImage,
  loadFabricImage,
  loadFabricLayerImage,
  readFabricTransform,
} from "./fabric-image"
import { type LayerDirection, moveFabricSelection, reorderFabricLayers } from "./fabric-layer-order"
import { type FabricLayerMeta, updateFabricLayerState } from "./fabric-layer-state"
import {
  applyFabricPerspective,
  applyFabricPerspectivePreview,
  disposeFabricPerspective,
} from "./fabric-perspective"

export type { AlignmentMode, DistributionMode } from "./alignment-geometry"
export type { LayerDirection } from "./fabric-layer-order"
export type ExportImageFormat = "png" | "jpeg"
export type FlipAxis = "horizontal" | "vertical"

export class FabricRuntime {
  private readonly canvas: Canvas
  private readonly objectIds = new WeakMap<FabricObject, LayerId>()
  private readonly layerObjects = new Map<LayerId, FabricImage>()
  private readonly layerMeta = new Map<LayerId, FabricLayerMeta>()
  private readonly accentColor: string
  private viewportWidth = 960
  private viewportHeight = 640
  private displayScale = 1
  private displayMode: "fit" | "manual" = "fit"
  private backgroundAssetId: AssetId | null = null
  private snapGuideObjects: readonly Line[] = []

  constructor(element: HTMLCanvasElement) {
    const styles = getComputedStyle(element)
    this.accentColor = styles.getPropertyValue("--accent-primary").trim() || "#5B8DEF"
    this.canvas = new Canvas(element, {
      width: 1200,
      height: 800,
      preserveObjectStacking: true,
      selection: true,
      selectionBorderColor: this.accentColor,
      selectionColor: `${this.accentColor}22`,
    })
    this.canvas.on("object:moving", ({ target }) => this.snapMovingObject(target))
    this.canvas.on("object:modified", ({ target }) => this.snapMovingObject(target))
    this.canvas.on("mouse:up", () => this.clearSnapGuides())
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
    this.backgroundAssetId = record.id
    this.displayMode = "fit"
    this.displayScale = this.applyDisplaySize()
    this.canvas.requestRenderAll()
    return size
  }

  async addLayer(
    record: AssetRecord,
    id: LayerId,
    { canvasSize: size, center }: LayerPlacementRequest,
  ): Promise<boolean> {
    const { image, sourceWidth, sourceHeight } = await loadFabricLayerImage(record)
    if (image.width <= 0 || image.height <= 0) return false

    const scale = Math.min(
      (size.width * 0.36) / sourceWidth,
      (size.height * 0.52) / sourceHeight,
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
      { visible: true, locked: false },
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

  async addDocumentLayer(record: AssetRecord, layer: ImageLayer): Promise<boolean> {
    const { image } = await loadFabricLayerImage(record)
    if (image.width <= 0 || image.height <= 0) return false

    configureFabricImage(image, layer.transform, this.accentColor, layer)
    this.registerLayer(image, layer.id, {
      assetId: layer.assetId,
      name: layer.name,
      visible: layer.visible,
      locked: layer.locked,
    })
    this.canvas.add(image)
    if (layer.visible && !layer.locked) this.canvas.setActiveObject(image)
    this.canvas.requestRenderAll()
    return true
  }

  async restore(documentState: EditorDocument, assets: AssetRegistry): Promise<void> {
    this.backgroundAssetId = await reconcileFabricDocument(
      {
        accentColor: this.accentColor,
        assets,
        canvas: this.canvas,
        layerMeta: this.layerMeta,
        layerObjects: this.layerObjects,
        objectIds: this.objectIds,
        backgroundAssetId: this.backgroundAssetId,
      },
      documentState,
    )
    this.displayScale = this.applyDisplaySize()
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
    const selected = this.getSelectedLayerIds()
    return selected.length === 1 ? (selected[0] ?? null) : null
  }

  getSelectedLayerIds(): readonly LayerId[] {
    return this.canvas.getActiveObjects().flatMap((object) => {
      const id = this.objectIds.get(object)
      return id === undefined ? [] : [id]
    })
  }

  hasObjectAtPointer(event: PointerEvent): boolean {
    return this.canvas.findTarget(event).target !== undefined
  }

  selectLayer(id: LayerId, additive = false): boolean {
    const object = this.layerObjects.get(id)
    const meta = this.layerMeta.get(id)
    if (object === undefined || meta === undefined) return false
    if (!meta.visible || meta.locked) {
      this.canvas.discardActiveObject()
      this.canvas.requestRenderAll()
      return false
    }
    if (!additive) {
      this.canvas.setActiveObject(object)
      this.canvas.requestRenderAll()
      return true
    }
    const selected = this.canvas.getActiveObjects()
    const next = selected.includes(object)
      ? selected.filter((candidate) => candidate !== object)
      : [...selected, object]
    this.setActiveObjects(next)
    this.canvas.requestRenderAll()
    return true
  }

  selectLayers(ids: readonly LayerId[]): boolean {
    const objects = ids.flatMap((id) => {
      const object = this.layerObjects.get(id)
      const meta = this.layerMeta.get(id)
      return object !== undefined && meta?.visible === true && !meta.locked ? [object] : []
    })
    if (objects.length === 0) return false
    this.setActiveObjects(objects)
    this.canvas.requestRenderAll()
    return true
  }

  clearSelection(): boolean {
    if (this.canvas.getActiveObject() === undefined) return false
    this.canvas.discardActiveObject()
    this.canvas.requestRenderAll()
    return true
  }

  deleteSelection(): boolean {
    const objects = this.canvas.getActiveObjects()
    if (objects.length === 0) return false
    for (const object of objects) {
      if (object instanceof FabricImage) disposeFabricPerspective(object)
    }
    this.canvas.remove(...objects)
    this.canvas.discardActiveObject()
    this.canvas.requestRenderAll()
    return true
  }

  moveSelection(direction: LayerDirection): boolean {
    return moveFabricSelection(this.canvas, direction)
  }

  alignSelection(mode: AlignmentMode): boolean {
    const objects = this.canvas.getActiveObjects()
    if (objects.length < 2) return false
    return this.applySelectionLayout(
      objects,
      calculateAlignment(
        objects.map((object) => object.getBoundingRect()),
        mode,
      ),
    )
  }

  distributeSelection(mode: DistributionMode): boolean {
    const objects = this.canvas.getActiveObjects()
    if (objects.length < 3) return false
    return this.applySelectionLayout(
      objects,
      calculateDistribution(
        objects.map((object) => object.getBoundingRect()),
        mode,
      ),
    )
  }

  reorderLayers(order: readonly LayerId[]): boolean {
    return reorderFabricLayers(this.canvas, this.layerObjects, order)
  }

  updateLayerState(id: LayerId, changes: Partial<Pick<ImageLayer, "visible" | "locked">>): boolean {
    return updateFabricLayerState(this.canvas, this.layerObjects, this.layerMeta, id, changes)
  }

  updateSelection(transform: Partial<LayerTransform>): boolean {
    return this.applySelectionTransform(transform, false)
  }

  toggleSelectionFlip(axis: FlipAxis): boolean {
    let changed = false
    for (const object of this.canvas.getActiveObjects()) {
      if (!(object instanceof FabricImage)) continue
      object.set(axis === "horizontal" ? { flipX: !object.flipX } : { flipY: !object.flipY })
      object.setCoords()
      changed = true
    }
    if (changed) this.canvas.requestRenderAll()
    return changed
  }

  previewSelection(transform: Partial<LayerTransform>): boolean {
    return this.applySelectionTransform(transform, true)
  }

  private applySelectionTransform(transform: Partial<LayerTransform>, preview: boolean): boolean {
    const object = this.canvas.getActiveObject()
    if (object === undefined) return false
    const { perspectiveX, x, y, ...fabricTransform } = transform
    object.set(fabricTransform)
    if (x !== undefined) object.set("left", x)
    if (y !== undefined) object.set("top", y)
    if (perspectiveX !== undefined && object instanceof FabricImage) {
      if (preview) applyFabricPerspectivePreview(object, perspectiveX)
      else applyFabricPerspective(object, perspectiveX)
    }
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
    this.displayScale = this.applyDisplaySize()
    return this.displayScale
  }

  setDisplayScale(scale: number): number {
    this.displayMode = "manual"
    this.displayScale = clampDisplayScale(scale)
    this.displayScale = this.applyDisplaySize()
    return this.displayScale
  }

  fitDisplay(): number {
    this.displayMode = "fit"
    this.displayScale = this.applyDisplaySize()
    return this.displayScale
  }

  async exportImage(format: ExportImageFormat): Promise<Blob | null> {
    return this.canvas.toBlob({
      format,
      quality: format === "jpeg" ? 0.92 : 1,
      multiplier: 1,
      enableRetinaScaling: false,
    })
  }

  private applyDisplaySize(): number {
    return applyFabricDisplaySize(
      this.canvas,
      this.viewportWidth,
      this.viewportHeight,
      this.displayMode === "manual" ? this.displayScale : undefined,
    )
  }

  private setActiveObjects(objects: readonly FabricObject[]): void {
    if (objects.length === 0) {
      this.canvas.discardActiveObject()
      return
    }
    const object = objects[0]
    if (objects.length === 1 && object !== undefined) {
      this.canvas.setActiveObject(object)
      return
    }
    this.canvas.setActiveObject(new ActiveSelection([...objects], { canvas: this.canvas }))
  }

  private snapMovingObject(target: FabricObject): void {
    const selected = new Set(this.canvas.getActiveObjects())
    const references = this.canvas
      .getObjects()
      .filter(
        (object) =>
          object !== target &&
          this.objectIds.has(object) &&
          object.visible &&
          !selected.has(object),
      )
      .map((object) => object.getBoundingRect())
    const result = calculateSnap(
      target.getBoundingRect(),
      references,
      { left: 0, top: 0, width: this.canvas.getWidth(), height: this.canvas.getHeight() },
      8 / this.displayScale,
    )
    if (result.deltaX !== 0 || result.deltaY !== 0) {
      target.set({ left: target.left + result.deltaX, top: target.top + result.deltaY })
      target.setCoords()
    }
    this.replaceSnapGuides(
      result.guides.map(
        (guide) =>
          new Line(
            guide.axis === "x"
              ? [guide.position, guide.start, guide.position, guide.end]
              : [guide.start, guide.position, guide.end, guide.position],
            {
              evented: false,
              excludeFromExport: true,
              selectable: false,
              stroke: this.accentColor,
              strokeDashArray: [4 / this.displayScale, 4 / this.displayScale],
              strokeWidth: 1 / this.displayScale,
            },
          ),
      ),
    )
    this.canvas.requestRenderAll()
  }

  private applySelectionLayout(
    objects: readonly FabricObject[],
    deltas: readonly PositionDelta[],
  ): boolean {
    if (deltas.every((delta) => delta.deltaX === 0 && delta.deltaY === 0)) return false
    this.canvas.discardActiveObject()
    for (const delta of deltas) {
      const object = objects[delta.index]
      if (object === undefined) continue
      object.set({ left: object.left + delta.deltaX, top: object.top + delta.deltaY })
      object.setCoords()
    }
    this.setActiveObjects(objects)
    this.canvas.requestRenderAll()
    return true
  }

  private clearSnapGuides(): void {
    if (this.snapGuideObjects.length === 0) return
    this.canvas.remove(...this.snapGuideObjects)
    this.snapGuideObjects = []
    this.canvas.requestRenderAll()
  }

  private replaceSnapGuides(guides: readonly Line[]): void {
    if (this.snapGuideObjects.length > 0) this.canvas.remove(...this.snapGuideObjects)
    this.snapGuideObjects = guides
    if (guides.length > 0) this.canvas.add(...guides)
  }

  async dispose(): Promise<void> {
    for (const object of this.canvas.getObjects()) {
      if (object instanceof FabricImage) disposeFabricPerspective(object)
    }
    await this.canvas.dispose()
  }

  private registerLayer(image: FabricImage, id: LayerId, meta: FabricLayerMeta): void {
    this.objectIds.set(image, id)
    this.layerObjects.set(id, image)
    this.layerMeta.set(id, meta)
  }
}
