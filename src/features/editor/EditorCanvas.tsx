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
