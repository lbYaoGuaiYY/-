import { useDroppable } from "@dnd-kit/core"
import {
  CornersOut,
  ImageSquare,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  UploadSimple,
} from "@phosphor-icons/react"
import { useEffect, useRef } from "react"

import { EDITOR_CANVAS_DROP_ID } from "./drag-placement"
import type { EditorController } from "./editor-controller"
import {
  distanceBetweenTouchPoints,
  getPinchGestureTarget,
  getPinchPanScrollPosition,
  getPinchZoomPercent,
  getTouchGestureMode,
  getTouchPanScrollPosition,
  midpointBetweenTouchPoints,
  type PinchGestureTarget,
  type TouchGestureMode,
  type TouchPanStart,
  type TouchPoint,
} from "./editor-touch-gestures"

export type EditorCanvasProps = {
  readonly backgroundLoaded: boolean
  readonly onOpenContextMenu?: (x: number, y: number) => void
  readonly onReady: (controller: EditorController | null) => void
  readonly onRequestBackground: () => void
}

export function EditorCanvas({
  backgroundLoaded,
  onOpenContextMenu,
  onReady,
  onRequestBackground,
}: EditorCanvasProps) {
  const stageRef = useRef<HTMLElement>(null)
  const stageScrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controllerRef = useRef<EditorController | null>(null)
  const canvasDrop = useDroppable({ id: EDITOR_CANVAS_DROP_ID, disabled: !backgroundLoaded })

  useEffect(() => {
    const canvasElement = canvasRef.current
    const stageElement = stageRef.current
    if (canvasElement === null || stageElement === null) return

    let disposed = false
    let controller: EditorController | null = null
    let observer: ResizeObserver | null = null
    void import("./editor-controller").then(({ EditorController }) => {
      if (disposed) return
      controller = new EditorController(canvasElement)
      controllerRef.current = controller
      onReady(controller)
      observer = new ResizeObserver((entries) => {
        const entry = entries[0]
        if (entry !== undefined) {
          controller?.resizeDisplay(entry.contentRect.width, entry.contentRect.height)
        }
      })
      observer.observe(stageElement)
    })

    return () => {
      disposed = true
      observer?.disconnect()
      controllerRef.current = null
      onReady(null)
      void controller?.dispose()
    }
  }, [onReady])

  useEffect(() => {
    const stageElement = stageRef.current
    if (stageElement === null) return
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      controllerRef.current?.zoomBy(event.deltaY < 0 ? 10 : -10)
    }
    stageElement.addEventListener("wheel", handleWheel, { passive: false })
    return () => stageElement.removeEventListener("wheel", handleWheel)
  }, [])

  useEffect(() => {
    const scrollElement = stageScrollRef.current
    if (scrollElement === null) return

    const pointers = new Map<number, TouchPoint>()
    let gestureMode: TouchGestureMode | null = null
    let panStart: TouchPanStart | null = null
    let pinchStart: { readonly distance: number; readonly zoomPercent: number } | null = null
    let firstTouchStartedOnObject = false
    let pinchTarget: PinchGestureTarget | null = null

    const startPanning = (): void => {
      scrollElement.classList.add("is-panning")
      for (const pointerId of pointers.keys()) {
        if (!scrollElement.hasPointerCapture(pointerId)) scrollElement.setPointerCapture(pointerId)
      }
    }

    const beginPinch = (): void => {
      const [first, second] = Array.from(pointers.values())
      if (first === undefined || second === undefined) return
      controllerRef.current?.cancelActiveTransform()
      const selectionPinch = controllerRef.current?.beginSelectionPinch() ?? false
      pinchTarget = getPinchGestureTarget(firstTouchStartedOnObject, selectionPinch)
      gestureMode = "pinch"
      const center = midpointBetweenTouchPoints(first, second)
      panStart = {
        left: scrollElement.scrollLeft,
        top: scrollElement.scrollTop,
        x: center.x,
        y: center.y,
      }
      pinchStart = {
        distance: distanceBetweenTouchPoints(first, second),
        zoomPercent: controllerRef.current?.getSnapshot().zoomPercent ?? 100,
      }
      startPanning()
    }

    const stopGesture = (event?: PointerEvent): void => {
      if (event !== undefined && scrollElement.hasPointerCapture(event.pointerId)) {
        scrollElement.releasePointerCapture(event.pointerId)
      }
      if (event === undefined || !pointers.has(event.pointerId)) {
        pointers.clear()
      } else {
        pointers.delete(event.pointerId)
      }
      if (pointers.size === 0) {
        gestureMode = null
        panStart = null
        pinchStart = null
        firstTouchStartedOnObject = false
        pinchTarget = null
        scrollElement.classList.remove("is-panning")
      }
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (event.pointerType !== "touch") return
      if (pointers.size === 0) {
        firstTouchStartedOnObject = controllerRef.current?.hasObjectAtPointer(event) ?? false
        gestureMode = getTouchGestureMode(1, firstTouchStartedOnObject)
        panStart = {
          left: scrollElement.scrollLeft,
          top: scrollElement.scrollTop,
          x: event.clientX,
          y: event.clientY,
        }
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pointers.size === 2) {
        event.preventDefault()
        event.stopPropagation()
        beginPinch()
        return
      }
      if (gestureMode !== "pan") return
      event.preventDefault()
      event.stopPropagation()
      startPanning()
    }

    const handlePointerMove = (event: PointerEvent): void => {
      if (event.pointerType !== "touch" || gestureMode === null || gestureMode === "fabric") return
      if (!pointers.has(event.pointerId)) return
      event.preventDefault()
      event.stopPropagation()
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (gestureMode === "pinch" && pointers.size >= 2 && pinchStart !== null) {
        const [first, second] = Array.from(pointers.values())
        if (first !== undefined && second !== undefined) {
          const currentDistance = distanceBetweenTouchPoints(first, second)
          if (pinchTarget === "selection") {
            controllerRef.current?.previewSelectionPinch(currentDistance / pinchStart.distance)
          } else {
            const currentZoom = controllerRef.current?.getSnapshot().zoomPercent ?? 100
            const nextZoom = getPinchZoomPercent(
              pinchStart.distance,
              currentDistance,
              pinchStart.zoomPercent,
            )
            controllerRef.current?.zoomBy(nextZoom - currentZoom)
          }
          if (pinchTarget === "viewport" && panStart !== null) {
            const nextPosition = getPinchPanScrollPosition(
              panStart,
              midpointBetweenTouchPoints(first, second),
            )
            scrollElement.scrollLeft = nextPosition.left
            scrollElement.scrollTop = nextPosition.top
          }
        }
        return
      }
      if (pointers.size === 1 && panStart !== null) {
        const nextPosition = getTouchPanScrollPosition(panStart, {
          x: event.clientX,
          y: event.clientY,
        })
        scrollElement.scrollLeft = nextPosition.left
        scrollElement.scrollTop = nextPosition.top
      }
    }

    const handlePointerUp = (event: PointerEvent): void => {
      if (event.pointerType !== "touch") return
      const wasPinching = gestureMode === "pinch"
      const completedSelectionPinch = wasPinching && pinchTarget === "selection"
      stopGesture(event)
      if (completedSelectionPinch) controllerRef.current?.finishSelectionPinch()
      if (wasPinching) pinchTarget = null
      if (wasPinching && pointers.size === 1) {
        const remainingPointer = Array.from(pointers.values())[0]
        if (remainingPointer !== undefined) {
          gestureMode = "pan"
          panStart = {
            left: scrollElement.scrollLeft,
            top: scrollElement.scrollTop,
            x: remainingPointer.x,
            y: remainingPointer.y,
          }
          pinchStart = null
          startPanning()
        }
      }
    }

    scrollElement.addEventListener("pointerdown", handlePointerDown, { capture: true })
    scrollElement.addEventListener("pointermove", handlePointerMove, { capture: true })
    scrollElement.addEventListener("pointerup", handlePointerUp, { capture: true })
    scrollElement.addEventListener("pointercancel", handlePointerUp, { capture: true })
    return () => {
      scrollElement.removeEventListener("pointerdown", handlePointerDown, { capture: true })
      scrollElement.removeEventListener("pointermove", handlePointerMove, { capture: true })
      scrollElement.removeEventListener("pointerup", handlePointerUp, { capture: true })
      scrollElement.removeEventListener("pointercancel", handlePointerUp, { capture: true })
      stopGesture()
    }
  }, [])

  useEffect(() => {
    const scrollElement = stageScrollRef.current
    if (scrollElement === null || onOpenContextMenu === undefined) return

    let longPressTimer: number | null = null
    let activePointerId: number | null = null
    let startX = 0
    let startY = 0
    const LONG_PRESS_MS = 420
    const MOVE_TOLERANCE = 10

    const clearLongPress = (): void => {
      if (longPressTimer !== null) {
        window.clearTimeout(longPressTimer)
        longPressTimer = null
      }
      activePointerId = null
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (event.pointerType !== "touch") return
      clearLongPress()
      activePointerId = event.pointerId
      startX = event.clientX
      startY = event.clientY
      const startedOnObject = controllerRef.current?.hasObjectAtPointer(event) ?? false
      longPressTimer = window.setTimeout(() => {
        if (activePointerId !== event.pointerId || !startedOnObject) return
        onOpenContextMenu(startX, startY)
        clearLongPress()
      }, LONG_PRESS_MS)
    }

    const handlePointerMove = (event: PointerEvent): void => {
      if (activePointerId !== event.pointerId) return
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_TOLERANCE) {
        clearLongPress()
      }
    }

    const handlePointerUp = (event: PointerEvent): void => {
      if (activePointerId !== event.pointerId) return
      clearLongPress()
    }

    scrollElement.addEventListener("pointerdown", handlePointerDown, { capture: true })
    scrollElement.addEventListener("pointermove", handlePointerMove, { capture: true })
    scrollElement.addEventListener("pointerup", handlePointerUp, { capture: true })
    scrollElement.addEventListener("pointercancel", handlePointerUp, { capture: true })
    return () => {
      clearLongPress()
      scrollElement.removeEventListener("pointerdown", handlePointerDown, { capture: true })
      scrollElement.removeEventListener("pointermove", handlePointerMove, { capture: true })
      scrollElement.removeEventListener("pointerup", handlePointerUp, { capture: true })
      scrollElement.removeEventListener("pointercancel", handlePointerUp, { capture: true })
    }
  }, [onOpenContextMenu])

  useEffect(() => {
    const scrollElement = stageScrollRef.current
    if (scrollElement === null) return
    let panStart: {
      readonly left: number
      readonly top: number
      readonly x: number
      readonly y: number
    } | null = null

    const stopPanning = () => {
      panStart = null
      scrollElement.classList.remove("is-panning")
    }
    const handleMouseDown = (event: MouseEvent) => {
      if (
        event.button !== 1 ||
        !(event.target instanceof Node) ||
        !scrollElement.contains(event.target)
      )
        return
      event.preventDefault()
      event.stopPropagation()
      panStart = {
        left: scrollElement.scrollLeft,
        top: scrollElement.scrollTop,
        x: event.clientX,
        y: event.clientY,
      }
      scrollElement.classList.add("is-panning")
    }
    const handleMouseMove = (event: MouseEvent) => {
      if (panStart === null) return
      scrollElement.scrollLeft = panStart.left + panStart.x - event.clientX
      scrollElement.scrollTop = panStart.top + panStart.y - event.clientY
    }

    window.addEventListener("mousedown", handleMouseDown, true)
    window.addEventListener("mousemove", handleMouseMove, true)
    window.addEventListener("mouseup", stopPanning)
    return () => {
      window.removeEventListener("mousedown", handleMouseDown, true)
      window.removeEventListener("mousemove", handleMouseMove, true)
      window.removeEventListener("mouseup", stopPanning)
    }
  }, [])

  return (
    <section
      ref={stageRef}
      className={`stage${canvasDrop.isOver ? " is-drop-target" : ""}`}
      data-testid="editor-canvas"
      data-background-loaded={backgroundLoaded}
      onContextMenuCapture={(event) => {
        if (onOpenContextMenu === undefined) return
        event.preventDefault()
        onOpenContextMenu(event.clientX, event.clientY)
      }}
      aria-label="设计画布工作区"
    >
      <div ref={stageScrollRef} className="stage-scroll">
        <div className="stage-scroll-content">
          <div ref={canvasDrop.setNodeRef} className="canvas-host">
            <canvas ref={canvasRef} aria-label="设计画布" role="img" />
          </div>
        </div>
      </div>
      {backgroundLoaded && (
        <fieldset className="zoom-controls">
          <legend className="sr-only">画布缩放</legend>
          <button
            className="icon-button"
            type="button"
            aria-label="缩小画布"
            onClick={() => controllerRef.current?.zoomBy(-10)}
          >
            <MagnifyingGlassMinus size={18} aria-hidden="true" />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="适合窗口"
            onClick={() => controllerRef.current?.fitDisplay()}
          >
            <CornersOut size={18} aria-hidden="true" />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="放大画布"
            onClick={() => controllerRef.current?.zoomBy(10)}
          >
            <MagnifyingGlassPlus size={18} aria-hidden="true" />
          </button>
        </fieldset>
      )}
      {!backgroundLoaded && (
        <div className="canvas-empty">
          <div className="empty-state">
            <ImageSquare size={44} weight="thin" aria-hidden="true" />
            <div>
              <p className="empty-state-title">先导入一张照片</p>
              <p className="notice">照片会成为设计底图，素材将叠加在上方</p>
            </div>
            <button className="primary-button" type="button" onClick={onRequestBackground}>
              <UploadSimple size={16} weight="bold" aria-hidden="true" />
              导入底图
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
