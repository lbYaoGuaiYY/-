import { useDroppable } from "@dnd-kit/core"
import { ImageSquare, UploadSimple } from "@phosphor-icons/react"
import { useEffect, useRef } from "react"

import { EDITOR_CANVAS_DROP_ID } from "./drag-placement"
import { EditorController } from "./editor-controller"

export type EditorCanvasProps = {
  readonly backgroundLoaded: boolean
  readonly onReady: (controller: EditorController | null) => void
  readonly onRequestBackground: () => void
}

export function EditorCanvas({
  backgroundLoaded,
  onReady,
  onRequestBackground,
}: EditorCanvasProps) {
  const stageRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const canvasDrop = useDroppable({ id: EDITOR_CANVAS_DROP_ID, disabled: !backgroundLoaded })

  useEffect(() => {
    const canvasElement = canvasRef.current
    const stageElement = stageRef.current
    if (canvasElement === null || stageElement === null) return

    const controller = new EditorController(canvasElement)
    onReady(controller)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined) {
        controller.resizeDisplay(entry.contentRect.width, entry.contentRect.height)
      }
    })
    observer.observe(stageElement)

    return () => {
      observer.disconnect()
      onReady(null)
      void controller.dispose()
    }
  }, [onReady])

  return (
    <section
      ref={stageRef}
      className={`stage${canvasDrop.isOver ? " is-drop-target" : ""}`}
      data-testid="editor-canvas"
      data-background-loaded={backgroundLoaded}
      aria-label="设计画布工作区"
    >
      <div ref={canvasDrop.setNodeRef} className="canvas-host">
        <canvas ref={canvasRef} aria-label="设计画布" role="img" />
      </div>
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
