import { type Canvas, FabricImage, type FabricObject } from "fabric"

import type { AssetRecord, AssetRegistry } from "./asset-registry"
import type { AssetId, CanvasSize, EditorDocument, ImageLayer, LayerId } from "./editor-model"
import {
  configureFabricImage,
  loadFabricImage,
  loadFabricLayerImage,
  readFabricTransform,
} from "./fabric-image"
import type { FabricLayerMeta } from "./fabric-layer-state"
import { disposeFabricPerspective } from "./fabric-perspective"

export type FabricDocumentRestoreContext = {
  readonly accentColor: string
  readonly assets: AssetRegistry
  readonly canvas: Canvas
  readonly layerMeta: Map<LayerId, FabricLayerMeta>
  readonly layerObjects: Map<LayerId, FabricImage>
  readonly objectIds: WeakMap<FabricObject, LayerId>
  readonly backgroundAssetId: AssetId | null
}

export async function reconcileFabricDocument(
  context: FabricDocumentRestoreContext,
  documentState: EditorDocument,
): Promise<AssetId | null> {
  if (!hasMatchingBackground(context, documentState)) {
    await rebuildFabricDocument(context, documentState)
    return documentState.backgroundAssetId
  }

  await reconcileLayers(context, documentState.layers)
  return context.backgroundAssetId
}

function hasMatchingBackground(
  context: FabricDocumentRestoreContext,
  documentState: EditorDocument,
): boolean {
  return (
    context.backgroundAssetId === documentState.backgroundAssetId &&
    hasMatchingCanvasSize(context.canvas, documentState.canvasSize)
  )
}

function hasMatchingCanvasSize(canvas: Canvas, size: CanvasSize): boolean {
  return canvas.getWidth() === size.width && canvas.getHeight() === size.height
}

async function rebuildFabricDocument(
  context: FabricDocumentRestoreContext,
  documentState: EditorDocument,
): Promise<void> {
  context.canvas.discardActiveObject()
  for (const object of context.canvas.getObjects()) {
    if (object instanceof FabricImage) disposeFabricPerspective(object)
  }
  context.canvas.remove(...context.canvas.getObjects())
  delete context.canvas.backgroundImage
  context.layerObjects.clear()
  context.layerMeta.clear()
  context.canvas.setDimensions(documentState.canvasSize)

  const background = findAsset(context.assets, documentState.backgroundAssetId)
  if (background !== undefined)
    await restoreBackground(context.canvas, background, documentState.canvasSize)

  for (const layer of documentState.layers) await addDocumentLayer(context, layer)
  context.canvas.requestRenderAll()
}

async function reconcileLayers(
  context: FabricDocumentRestoreContext,
  layers: readonly ImageLayer[],
): Promise<void> {
  const targetLayerIds = new Set(layers.map((layer) => layer.id))
  let changed = false
  for (const [id, object] of context.layerObjects) {
    if (targetLayerIds.has(id)) continue
    disposeFabricPerspective(object)
    context.canvas.remove(object)
    context.objectIds.delete(object)
    context.layerObjects.delete(id)
    context.layerMeta.delete(id)
    changed = true
  }

  for (const layer of layers) {
    const object = context.layerObjects.get(layer.id)
    const meta = context.layerMeta.get(layer.id)
    if (object !== undefined && meta !== undefined && meta.assetId === layer.assetId) {
      if (!matchesLayer(object, meta, layer)) {
        configureFabricImage(object, layer.transform, context.accentColor, layer)
        context.layerMeta.set(layer.id, layerMetadata(layer))
        changed = true
      }
      continue
    }
    if (object !== undefined) removeLayer(context, layer.id, object)
    await addDocumentLayer(context, layer)
    changed = true
  }

  if (reorderLayers(context, layers)) changed = true
  if (changed) context.canvas.requestRenderAll()
}

async function addDocumentLayer(
  context: FabricDocumentRestoreContext,
  layer: ImageLayer,
): Promise<void> {
  const asset = context.assets.get(layer.assetId)
  if (asset === undefined) return
  const { image } = await loadFabricLayerImage(asset)
  configureFabricImage(image, layer.transform, context.accentColor, layer)
  context.objectIds.set(image, layer.id)
  context.layerObjects.set(layer.id, image)
  context.layerMeta.set(layer.id, layerMetadata(layer))
  context.canvas.add(image)
}

function removeLayer(
  context: FabricDocumentRestoreContext,
  id: LayerId,
  object: FabricImage,
): void {
  disposeFabricPerspective(object)
  context.canvas.remove(object)
  context.objectIds.delete(object)
  context.layerObjects.delete(id)
  context.layerMeta.delete(id)
}

function reorderLayers(
  context: FabricDocumentRestoreContext,
  layers: readonly ImageLayer[],
): boolean {
  const objects = layers.flatMap((layer) => {
    const object = context.layerObjects.get(layer.id)
    return object === undefined ? [] : [object]
  })
  const current = context.canvas.getObjects()
  if (
    objects.length !== current.length ||
    current.every((object, index) => object === objects[index])
  ) {
    return false
  }
  objects.forEach((object, index) => {
    context.canvas.moveObjectTo(object, index)
  })
  return true
}

function matchesLayer(object: FabricImage, meta: FabricLayerMeta, layer: ImageLayer): boolean {
  const transform = readFabricTransform(object)
  return (
    meta.name === layer.name &&
    meta.visible === layer.visible &&
    meta.locked === layer.locked &&
    transform.x === layer.transform.x &&
    transform.y === layer.transform.y &&
    transform.scaleX === layer.transform.scaleX &&
    transform.scaleY === layer.transform.scaleY &&
    transform.skewX === (layer.transform.skewX ?? 0) &&
    transform.skewY === (layer.transform.skewY ?? 0) &&
    transform.perspectiveX === (layer.transform.perspectiveX ?? 0) &&
    transform.angle === layer.transform.angle &&
    transform.flipX === layer.transform.flipX &&
    transform.flipY === layer.transform.flipY &&
    transform.opacity === layer.transform.opacity
  )
}

function layerMetadata(layer: ImageLayer): FabricLayerMeta {
  return {
    assetId: layer.assetId,
    name: layer.name,
    visible: layer.visible,
    locked: layer.locked,
  }
}

function findAsset(assets: AssetRegistry, id: AssetId | null): AssetRecord | undefined {
  return id === null ? undefined : assets.get(id)
}

async function restoreBackground(
  canvas: Canvas,
  record: AssetRecord,
  size: CanvasSize,
): Promise<void> {
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
  canvas.backgroundImage = image
}
