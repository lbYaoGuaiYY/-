import { X } from "@phosphor-icons/react"
import type { ChangeEvent } from "react"
import { useCallback, useEffect, useRef, useState } from "react"

import { AssetPanel } from "./features/assets/AssetPanel"
import type { DemoAsset } from "./features/assets/demo-assets"
import { AppHeader } from "./features/editor/AppHeader"
import { EditorCanvas } from "./features/editor/EditorCanvas"
import { EditorDragContext } from "./features/editor/EditorDragContext"
import { EditorToolbar } from "./features/editor/EditorToolbar"
import type { EditorController } from "./features/editor/editor-controller"
import type { EditorViewState } from "./features/editor/editor-view-state"
import { InspectorPanel } from "./features/editor/InspectorPanel"
import { LayerPanel } from "./features/editor/LayerPanel"
import { MobileTabbar } from "./features/editor/MobileTabbar"
import {
  EDITOR_SHORTCUT,
  type EditorShortcut,
  isEditorTextTarget,
  resolveEditorShortcut,
} from "./features/editor/shortcuts"
import { useEditorPanels } from "./features/editor/use-editor-panels"
import { useProjectSession } from "./features/projects/use-project-session"

const FALLBACK_VIEW = {
  document: { canvasSize: { width: 1200, height: 800 }, backgroundAssetId: null, layers: [] },
  selectedLayerId: null,
  canUndo: false,
  canRedo: false,
  isBusy: false,
  errorMessage: null,
  zoomPercent: 100,
} as const satisfies EditorViewState

class UnexpectedShortcutError extends Error {
  readonly name = "UnexpectedShortcutError"
}

export function App() {
  const [controller, setController] = useState<EditorController | null>(null)
  const [view, setView] = useState<EditorViewState>(FALLBACK_VIEW)
  const panels = useEditorPanels()
  const backgroundInputRef = useRef<HTMLInputElement>(null)
  const projectSession = useProjectSession(controller)

  const handleEditorReady = useCallback((nextController: EditorController | null) => {
    setController(nextController)
    setView(nextController?.getSnapshot() ?? FALLBACK_VIEW)
  }, [])

  useEffect(() => {
    if (controller === null) return
    return controller.subscribe(() => setView(controller.getSnapshot()))
  }, [controller])

  useEffect(() => {
    if (controller === null) return
    const activeController = controller
    function handleKeyDown(event: KeyboardEvent): void {
      const shortcut = resolveEditorShortcut(event)
      if (shortcut !== null) {
        event.preventDefault()
        runShortcut(activeController, shortcut)
        return
      }
      if (shouldTogglePanels(event)) {
        event.preventDefault()
        panels.toggleTemporary()
        return
      }
      if (isEditorTextTarget(event.target)) return
      const step = event.shiftKey ? 10 : 1
      if (event.key === "ArrowLeft") activeController.nudgeSelection(-step, 0)
      if (event.key === "ArrowRight") activeController.nudgeSelection(step, 0)
      if (event.key === "ArrowUp") activeController.nudgeSelection(0, -step)
      if (event.key === "ArrowDown") activeController.nudgeSelection(0, step)
      if (event.key === "Escape") activeController.clearSelection()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [controller, panels])

  const backgroundLoaded = view.document.backgroundAssetId !== null
  const selectedLayer =
    view.document.layers.find((layer) => layer.id === view.selectedLayerId) ?? null
  const selectionEditable = selectedLayer?.visible === true && !selectedLayer.locked

  const requestBackground = (): void => backgroundInputRef.current?.click()

  function handleBackgroundFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.item(0)
    if (controller !== null && file !== null && file !== undefined) {
      void controller.importBackground(file)
    }
    event.currentTarget.value = ""
  }

  function addBuiltInAsset(asset: DemoAsset): void {
    if (controller === null) return
    void controller.addBuiltInAsset(asset).then(() => {
      if (panels.viewport !== "desktop") panels.closeAssets()
    })
  }

  const workspaceClassName = `workspace${panels.assetsOpen ? "" : " assets-closed"}${panels.rightPanel === "closed" ? " right-closed" : ""}`
  const showProperties = panels.viewport === "desktop" || panels.rightPanel === "properties"
  const showLayers = panels.viewport === "desktop" || panels.rightPanel === "layers"

  return (
    <main className="app-shell" data-testid="editor-shell">
      <label className="sr-only" htmlFor="background-file-input">
        导入底图文件
      </label>
      <input
        ref={backgroundInputRef}
        id="background-file-input"
        className="sr-only"
        data-testid="background-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleBackgroundFile}
      />
      <AppHeader
        canRedo={view.canRedo}
        canUndo={view.canUndo}
        canExport={backgroundLoaded}
        isBusy={view.isBusy}
        projectStatus={projectSession.status}
        onRequestBackground={requestBackground}
        onUndo={() => void controller?.undo()}
        onRedo={() => void controller?.redo()}
        onExport={() => void projectSession.flush().then(() => controller?.downloadPng())}
      />
      <EditorDragContext
        backgroundLoaded={backgroundLoaded}
        canvasSize={view.document.canvasSize}
        controller={controller}
        onAssetDragStart={panels.viewport === "desktop" ? undefined : panels.closeAssets}
        onRequestBackground={requestBackground}
      >
        <div className={workspaceClassName}>
          <div className={`side-panel side-panel-left${panels.assetsOpen ? " is-open" : ""}`}>
            <AssetPanel
              onAddAsset={addBuiltInAsset}
              onImportFiles={(files) => void controller?.addLocalAssets(files)}
            />
          </div>
          <section className="canvas-column" aria-label="编辑区">
            <EditorToolbar
              hasSelection={selectionEditable}
              onToggleAssets={panels.toggleAssets}
              onMoveLayer={(direction) => controller?.moveSelection(direction)}
              onDelete={() => controller?.deleteSelection()}
            />
            <EditorCanvas
              backgroundLoaded={backgroundLoaded}
              onReady={handleEditorReady}
              onRequestBackground={requestBackground}
            />
          </section>
          <aside
            className={`side-panel side-panel-right${panels.rightPanel === "closed" ? "" : " is-open"}`}
            data-panel-mode={panels.rightPanel}
            aria-label="属性与图层"
          >
            {showProperties && (
              <InspectorPanel
                layer={selectedLayer}
                readOnly={
                  selectedLayer !== null && (!selectedLayer.visible || selectedLayer.locked)
                }
                onClose={panels.closeRightPanel}
                onUpdate={(transform) => controller?.updateSelection(transform)}
              />
            )}
            {showLayers && (
              <LayerPanel
                layers={view.document.layers}
                selectedLayerId={view.selectedLayerId}
                getAssetSource={(id) => controller?.getAssetSource(id)}
                onClose={panels.closeRightPanel}
                onLayerStateChange={(id, changes) => controller?.updateLayerState(id, changes)}
                onReorder={(activeId, targetId) => controller?.reorderLayers(activeId, targetId)}
                onSelect={(id) => controller?.selectLayer(id)}
              />
            )}
          </aside>
        </div>
      </EditorDragContext>
      {view.errorMessage !== null && (
        <div className="error-banner" role="alert">
          <span>{view.errorMessage}</span>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭错误提示"
            onClick={() => controller?.clearError()}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      <footer className="status-bar" aria-live="polite">
        <div className="status-group">
          <span className="status-dot" aria-hidden="true" />
          <span>{view.isBusy ? "处理中" : "本地模式"}</span>
          <span>{`${view.document.canvasSize.width} × ${view.document.canvasSize.height}`}</span>
        </div>
        <div className="status-group">
          <span>{view.document.layers.length} 个素材</span>
          <span>{view.zoomPercent}%</span>
        </div>
        <MobileTabbar
          activePanel={
            panels.assetsOpen
              ? "assets"
              : panels.rightPanel === "layers" || panels.rightPanel === "properties"
                ? panels.rightPanel
                : null
          }
          onOpenAssets={panels.openAssets}
          onOpenLayers={() => panels.openRightPanel("layers")}
          onOpenProperties={() => panels.openRightPanel("properties")}
          onExport={() => void projectSession.flush().then(() => controller?.downloadPng())}
        />
      </footer>
    </main>
  )
}

function runShortcut(controller: EditorController, shortcut: EditorShortcut): void {
  switch (shortcut) {
    case EDITOR_SHORTCUT.undo:
      void controller.undo()
      return
    case EDITOR_SHORTCUT.redo:
      void controller.redo()
      return
    case EDITOR_SHORTCUT.deleteSelection:
      controller.deleteSelection()
      return
    case EDITOR_SHORTCUT.layerUp:
      controller.moveSelection("up")
      return
    case EDITOR_SHORTCUT.layerDown:
      controller.moveSelection("down")
      return
    case EDITOR_SHORTCUT.layerToFront:
      controller.moveSelection("front")
      return
    case EDITOR_SHORTCUT.layerToBack:
      controller.moveSelection("back")
      return
    default:
      throw new UnexpectedShortcutError(`Unexpected shortcut: ${String(shortcut)}`)
  }
}

function shouldTogglePanels(event: KeyboardEvent): boolean {
  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return false
  const target = event.target
  if (!(target instanceof HTMLElement)) return true
  return target.closest("button, a, input, select, textarea, [contenteditable='true']") === null
}
