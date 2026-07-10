import type { LayerId } from "./editor-model"

function moveLayer(
  order: readonly LayerId[],
  id: LayerId,
  targetIndex: number,
): readonly LayerId[] {
  const sourceIndex = order.indexOf(id)
  if (sourceIndex < 0 || sourceIndex === targetIndex) {
    return order
  }

  const layer = order.at(sourceIndex)
  if (layer === undefined) {
    return order
  }

  const remaining = [...order.slice(0, sourceIndex), ...order.slice(sourceIndex + 1)]
  return [...remaining.slice(0, targetIndex), layer, ...remaining.slice(targetIndex)]
}

export function moveLayerUp(order: readonly LayerId[], id: LayerId): readonly LayerId[] {
  const sourceIndex = order.indexOf(id)
  if (sourceIndex < 0 || sourceIndex === order.length - 1) {
    return order
  }

  return moveLayer(order, id, sourceIndex + 1)
}

export function moveLayerDown(order: readonly LayerId[], id: LayerId): readonly LayerId[] {
  const sourceIndex = order.indexOf(id)
  if (sourceIndex <= 0) {
    return order
  }

  return moveLayer(order, id, sourceIndex - 1)
}

export function moveLayerToFront(order: readonly LayerId[], id: LayerId): readonly LayerId[] {
  const sourceIndex = order.indexOf(id)
  if (sourceIndex < 0 || sourceIndex === order.length - 1) {
    return order
  }

  return moveLayer(order, id, order.length - 1)
}

export function moveLayerToBack(order: readonly LayerId[], id: LayerId): readonly LayerId[] {
  const sourceIndex = order.indexOf(id)
  if (sourceIndex <= 0) {
    return order
  }

  return moveLayer(order, id, 0)
}
