import type { ImageLayer, LayerId } from "./editor-model"

export function copyLayerWithOffset(source: ImageLayer, id: LayerId, offset: number): ImageLayer {
  return {
    ...source,
    id,
    name: `${source.name} 副本`,
    transform: {
      ...source.transform,
      x: source.transform.x + offset,
      y: source.transform.y + offset,
    },
  }
}
