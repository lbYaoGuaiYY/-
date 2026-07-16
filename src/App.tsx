import { X } from "@phosphor-icons/react"
import type {
  ChangeEvent,
  CSSProperties,
  PointerEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { useCallback, useEffect, useRef, useState } from "react"

import { AssetPanel } from "./features/assets/AssetPanel"
import { getServiceAssetId, type LibraryAsset } from "./features/assets/asset-library"
import { useEditorAssetLibrary } from "./features/assets/use-editor-asset-library"
import { AppHeader } from "./features/editor/AppHeader"
import { EditorCanvas } from "./features/editor/EditorCanvas"
import { EditorDragContext } from "./features/editor/EditorDragContext"
import { EditorToolbar } from "./features/editor/EditorToolbar"
import type { EditorController } from "./features/editor/editor-controller"
import type { EditorViewState } from "./features/editor/editor-view-state"
import type { ExportImageFormat } from "./features/editor/fabric-runtime"
import { ImageExportSheet } from "./features/editor/ImageExportSheet"
import { InspectorPanel } from "./features/editor/InspectorPanel"
import { LayerContextMenu } from "./features/editor/LayerContextMenu"
import { LayerPanel } from "./features/editor/LayerPanel"
import { MobileActionsSheet } from "./features/editor/MobileActionsSheet"
import { MobileTabbar } from "./features/editor/MobileTabbar"
import { OfflineAssetManager } from "./features/editor/OfflineAssetManager"
import {
  EDITOR_SHORTCUT,
  type EditorShortcut,
  isEditorTextTarget,
  resolveEditorShortcut,
} from "./features/editor/shortcuts"
import { useEditorPanels } from "./features/editor/use-editor-panels"
import { importProjectPackageAsNewProject } from "./features/projects/import-project-package"
import {
  openBackgroundImageFile,
  openProjectPackageFile,
  saveProjectPackageFile,
} from "./features/projects/project-file-dialog"
import type { ProjectId } from "./features/projects/project-format"
import {
  decodeProjectPackage,
  encodeProjectPackage,
  projectPackageFilename,
  shareOrDownloadProjectPackage,
} from "./features/projects/project-package"
import { isDesktopRuntime } from "./features/projects/project-storage"
import { useProjectMetadata } from "./features/projects/use-project-metadata"
import { useProjectSession } from "./features/projects/use-project-session"
import { QINGSHE_BUILD_INFO, qingsheBuildLabel } from "./platform/build-info"

const FALLBACK_VIEW = {
  document: { canvasSize: { width: 1200, height: 800 }, backgroundAssetId: null, layers: [] },
  selectedLayerId: null,
  selectedLayerIds: [],
  canUndo: false,
  canRedo: false,
  hasClipboard: false,
  isBusy: false,
  errorMessage: null,
  zoomPercent: 100,
} as const satisfies EditorViewState

type CanvasContextMenuPosition = Readonly<{ x: number; y: number }>

const PANEL_RESIZER_HEIGHT = 8
const MIN_RIGHT_PANEL_SECTION_HEIGHT = 120

class UnexpectedShortcutError extends Error {
  readonly name = "UnexpectedShortcutError"
}

export type AppProps = {
  readonly projectId: ProjectId
}

export function App({ projectId }: AppProps) {
  const [controller, setController] = useState<EditorController | null>(null)
  const controllerRef = useRef<EditorController | null>(null)
  const [view, setView] = useState<EditorViewState>(FALLBACK_VIEW)
  const [canvasContextMenu, setCanvasContextMenu] = useState<CanvasContextMenuPosition | null>(null)
  const [offlineAssetsOpen, setOfflineAssetsOpen] = useState(false)
  const [preparedImageExport, setPreparedImageExport] = useState<{
    readonly blob: Blob
    readonly format: ExportImageFormat
  } | null>(null)
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false)
  const panels = useEditorPanels()
  const backgroundInputRef = useRef<HTMLInputElement>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)
  const pendingBackgroundRef = useRef<File | null>(null)
  const pendingAssetsRef = useRef<LibraryAsset[]>([])
  const projectSession = useProjectSession(controller, projectId)
  const projectMetadata = useProjectMetadata(projectId)
  const assetLibrary = useEditorAssetLibrary({
    enabled: panels.viewport === "desktop" || panels.assetsOpen,
  })

  const [inspectorHeight, setInspectorHeight] = useState(360)
  const isResizingRef = useRef(false)
  const asideRef = useRef<HTMLElement>(null)
  const resizerPointerIdRef = useRef<number | null>(null)

  function clampInspectorHeight(nextHeight: number): number {
    const panel = asideRef.current
    if (panel === null) return nextHeight
    const availableHeight = panel.getBoundingClientRect().height - PANEL_RESIZER_HEIGHT
    const minSectionHeight = Math.min(MIN_RIGHT_PANEL_SECTION_HEIGHT, availableHeight / 2)
    return Math.min(availableHeight - minSectionHeight, Math.max(minSectionHeight, nextHeight))
  }

  function handleResizerPointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (panels.viewport !== "desktop") return
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    isResizingRef.current = true
    resizerPointerIdRef.current = event.pointerId
    document.body.classList.add("is-resizing-panel")
  }

  function handleResizerPointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (
      !isResizingRef.current ||
      resizerPointerIdRef.current !== event.pointerId ||
      asideRef.current === null
    )
      return
    const top = asideRef.current.getBoundingClientRect().top
    setInspectorHeight(clampInspectorHeight(event.clientY - top))
  }

  function handleResizerKeyDown(event: ReactKeyboardEvent<HTMLHRElement>): void {
    const direction = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0
    if (direction === 0) return
    event.preventDefault()
    setInspectorHeight(
      clampInspectorHeight(inspectorHeight + direction * (event.shiftKey ? 48 : 24)),
    )
  }

  function stopResizingPanel(event: PointerEvent<HTMLDivElement>): void {
    if (resizerPointerIdRef.current !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    isResizingRef.current = false
    resizerPointerIdRef.current = null
    document.body.classList.remove("is-resizing-panel")
  }

  useEffect(() => () => document.body.classList.remove("is-resizing-panel"), [])

  const handleEditorReady = useCallback((nextController: EditorController | null) => {
    controllerRef.current = nextController
    setController(nextController)
    setView(nextController?.getSnapshot() ?? FALLBACK_VIEW)
    const pendingBackground = pendingBackgroundRef.current
    const pendingAssets = pendingAssetsRef.current.splice(0)
    if (nextController !== null && (pendingBackground !== null || pendingAssets.length > 0)) {
      void (async () => {
        if (pendingBackground !== null) {
          pendingBackgroundRef.current = null
          await nextController.importBackground(pendingBackground)
        }
        for (const asset of pendingAssets) await nextController.addLibraryAsset(asset)
      })()
    }
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
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        activeController.nudgeSelection(-step, 0)
      }
      if (event.key === "ArrowRight") {
        event.preventDefault()
        activeController.nudgeSelection(step, 0)
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        activeController.nudgeSelection(0, -step)
      }
      if (event.key === "ArrowDown") {
        event.preventDefault()
        activeController.nudgeSelection(0, step)
      }
      if (event.key === "Escape") activeController.clearSelection()
    }
    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [controller, panels])

  const backgroundLoaded = view.document.backgroundAssetId !== null
  const selectedLayer =
    view.document.layers.find((layer) => layer.id === view.selectedLayerId) ?? null
  const selectedLayerIds = new Set(view.selectedLayerIds)
  const selectedLayers = view.document.layers.filter((layer) => selectedLayerIds.has(layer.id))
  const projectAssetIds = Array.from(
    new Set(
      view.document.layers.flatMap((layer) => {
        const serviceAssetId = getServiceAssetId(layer.assetId)
        return serviceAssetId === null ? [] : [serviceAssetId]
      }),
    ),
  )
  const contextMenuLayer = selectedLayers[0] ?? null
  const selectionEditable =
    selectedLayers.length > 0 && selectedLayers.every((layer) => layer.visible && !layer.locked)

  function requestBackground(): void {
    if (!isDesktopRuntime()) {
      backgroundInputRef.current?.click()
      return
    }
    void openBackgroundImageFile()
      .then((file) => {
        if (file === null) return
        const activeController = controllerRef.current
        if (activeController === null) pendingBackgroundRef.current = file
        else void activeController.importBackground(file)
      })
      .catch(() => controllerRef.current?.showError("图片读取失败，请确认文件没有损坏后重试"))
  }
  function requestProjectImport(): void {
    if (!isDesktopRuntime()) {
      projectInputRef.current?.click()
      return
    }
    void openProjectPackageFile().then((file) => {
      const activeController = controllerRef.current
      if (file !== null && activeController !== null)
        void importEditableProject(file, activeController)
    })
  }
  const previewSelection = useCallback(
    (transform: Parameters<EditorController["previewSelection"]>[0]): void => {
      controller?.previewSelection(transform)
    },
    [controller],
  )
  const updateSelection = useCallback(
    (transform: Parameters<EditorController["updateSelection"]>[0]): void => {
      controller?.updateSelection(transform)
    },
    [controller],
  )

  function handleBackgroundFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.item(0)
    if (file !== null && file !== undefined) {
      const activeController = controllerRef.current
      if (activeController === null) pendingBackgroundRef.current = file
      else void activeController.importBackground(file)
    }
    event.currentTarget.value = ""
  }

  function handleProjectFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.item(0)
    event.currentTarget.value = ""
    if (file === null || file === undefined || controller === null) return
    void importEditableProject(file, controller)
  }

  async function importEditableProject(
    file: File,
    activeController: EditorController,
  ): Promise<void> {
    const decoded = await decodeProjectPackage(file)
    if (decoded.kind !== "valid") {
      activeController.showError(
        decoded.kind === "too_large"
          ? "项目包超过 500 MB，无法导入"
          : "可编辑项目文件已损坏或格式不正确",
      )
      return
    }
    await projectSession.flush()
    const imported = await importProjectPackageAsNewProject(decoded.projectName, decoded.snapshot)
    if (imported.kind === "saved") {
      window.location.assign(`/?project=${encodeURIComponent(imported.projectId)}`)
      return
    }
    activeController.showError(
      imported.kind === "quota_exceeded" ? "本地空间不足，项目导入失败" : "项目导入失败，请重试",
    )
  }

  async function exportEditableProject(): Promise<void> {
    if (controller === null) return
    await projectSession.flush()
    const snapshot = controller.captureProject()
    if (snapshot === null) {
      controller.showError("项目素材尚未准备完成，请稍后重试")
      return
    }
    try {
      if (isDesktopRuntime()) {
        const packageBlob = await encodeProjectPackage(snapshot, projectMetadata.name)
        await saveProjectPackageFile(packageBlob, projectMetadata.name)
      } else {
        const packageBlob = await encodeProjectPackage(snapshot, projectMetadata.name)
        await shareOrDownloadProjectPackage(
          packageBlob,
          projectPackageFilename(projectMetadata.name),
        )
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      controller.showError("可编辑项目导出失败，请重试")
    }
  }

  async function requestImageExport(format: ExportImageFormat): Promise<void> {
    const activeController = controllerRef.current
    if (activeController === null) return
    if (panels.viewport === "desktop") {
      await projectSession.flush()
      await activeController.downloadImage(format)
      return
    }
    const blob = await activeController.prepareImageExport(format)
    if (blob !== null) setPreparedImageExport({ blob, format })
  }

  function addLibraryAsset(asset: LibraryAsset): void {
    const activeController = controllerRef.current
    if (activeController === null) {
      pendingAssetsRef.current.push(asset)
      return
    }
    void activeController.addLibraryAsset(asset).then(() => {
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
      <label className="sr-only" htmlFor="project-file-input">
        导入可编辑项目文件
      </label>
      <input
        ref={projectInputRef}
        id="project-file-input"
        className="sr-only"
        type="file"
        accept=".qingshe,application/zip"
        onChange={handleProjectFile}
      />
      <AppHeader
        canRedo={view.canRedo}
        canUndo={view.canUndo}
        canExport={backgroundLoaded}
        isBusy={view.isBusy}
        projectName={projectMetadata.name}
        projectStatus={projectSession.status}
        onOpenProjects={() =>
          void projectSession.flush().then(() => window.location.assign("/projects"))
        }
        onRenameProject={(name) => void projectMetadata.rename(name)}
        onRequestBackground={requestBackground}
        onUndo={() => void controller?.undo()}
        onRedo={() => void controller?.redo()}
        onExport={(format) => void requestImageExport(format)}
        onExportProject={() => void exportEditableProject()}
        onImportProject={requestProjectImport}
      />
      <EditorDragContext
        assets={assetLibrary.assets}
        backgroundLoaded={backgroundLoaded}
        canvasSize={view.document.canvasSize}
        onAssetDragStart={panels.viewport === "desktop" ? undefined : panels.closeAssets}
        onPlaceAsset={(asset, center) => void controller?.addLibraryAsset(asset, center)}
        onRequestBackground={requestBackground}
      >
        <div className={workspaceClassName}>
          {panels.viewport !== "desktop" &&
            (panels.assetsOpen || panels.rightPanel !== "closed") && (
              <button
                className="panel-scrim"
                type="button"
                aria-label="关闭面板"
                onClick={panels.closeAll}
              />
            )}
          <div className={`side-panel side-panel-left${panels.assetsOpen ? " is-open" : ""}`}>
            {offlineAssetsOpen ? (
              <OfflineAssetManager
                variant="panel"
                projectAssetIds={projectAssetIds}
                onClose={() => setOfflineAssetsOpen(false)}
              />
            ) : (
              <AssetPanel
                assets={assetLibrary.assets}
                category={assetLibrary.category}
                hasMore={assetLibrary.hasMore}
                isLoadingMore={assetLibrary.isLoadingMore}
                isRefreshing={assetLibrary.status === "loading"}
                onAddAsset={addLibraryAsset}
                onCategoryChange={assetLibrary.setCategory}
                onLoadMore={assetLibrary.loadMore}
                onOpenOfflineAssets={() => setOfflineAssetsOpen(true)}
                onQueryChange={assetLibrary.setQuery}
                onRefresh={assetLibrary.refresh}
                query={assetLibrary.query}
                status={assetLibrary.status}
              />
            )}
          </div>
          <section className="canvas-column" aria-label="编辑区">
            <EditorToolbar
              canArrange={selectionEditable}
              canAlign={selectionEditable && selectedLayers.length >= 2}
              canDelete={selectionEditable}
              canDistribute={selectionEditable && selectedLayers.length >= 3}
              onAlign={(mode) => controller?.alignSelection(mode)}
              onDistribute={(mode) => controller?.distributeSelection(mode)}
              onToggleAssets={panels.toggleAssets}
              onMoveLayer={(direction) => controller?.moveSelection(direction)}
              onDelete={() => controller?.deleteSelection()}
            />
            <EditorCanvas
              backgroundLoaded={backgroundLoaded}
              {...(contextMenuLayer === null
                ? {}
                : { onOpenContextMenu: (x: number, y: number) => setCanvasContextMenu({ x, y }) })}
              onReady={handleEditorReady}
              onRequestBackground={requestBackground}
            />
          </section>
          <aside
            ref={asideRef}
            className={`side-panel side-panel-right${panels.rightPanel === "closed" ? "" : " is-open"}`}
            data-panel-mode={panels.rightPanel}
            aria-label="属性与图层"
            style={{ "--inspector-panel-height": `${inspectorHeight}px` } as CSSProperties}
          >
            {showProperties && (
              <InspectorPanel
                layer={selectedLayer}
                selectionCount={selectedLayers.length}
                readOnly={!selectionEditable}
                onClose={panels.closeRightPanel}
                onPreview={previewSelection}
                onToggleFlip={(axis) => controller?.toggleSelectionFlip(axis)}
                onUpdate={updateSelection}
              />
            )}
            {showProperties && showLayers && (
              <hr
                className="panel-resizer-horizontal"
                aria-orientation="horizontal"
                aria-label="调整属性与图层面板高度"
                aria-valuemin={MIN_RIGHT_PANEL_SECTION_HEIGHT}
                aria-valuenow={Math.round(inspectorHeight)}
                tabIndex={0}
                onPointerDown={handleResizerPointerDown}
                onPointerMove={handleResizerPointerMove}
                onPointerUp={stopResizingPanel}
                onPointerCancel={stopResizingPanel}
                onKeyDown={handleResizerKeyDown}
              />
            )}
            {showLayers && (
              <LayerPanel
                canPaste={view.hasClipboard}
                layers={view.document.layers}
                selectedLayerIds={view.selectedLayerIds}
                getAssetSource={(id) => controller?.getAssetSource(id)}
                onClose={panels.closeRightPanel}
                onLayerStateChange={(id, changes) => controller?.updateLayerState(id, changes)}
                onCopy={(id) => {
                  if (!view.selectedLayerIds.includes(id)) controller?.selectLayer(id)
                  controller?.copySelection()
                }}
                onCut={(id) => {
                  if (!view.selectedLayerIds.includes(id)) controller?.selectLayer(id)
                  controller?.cutSelection()
                }}
                onDelete={(id) => {
                  if (!view.selectedLayerIds.includes(id)) controller?.selectLayer(id)
                  controller?.deleteSelection()
                }}
                onDuplicate={(id) => {
                  if (!view.selectedLayerIds.includes(id)) controller?.selectLayer(id)
                  void controller?.duplicateSelection()
                }}
                onMove={(id, direction) => {
                  if (!view.selectedLayerIds.includes(id)) controller?.selectLayer(id)
                  controller?.moveSelection(direction)
                }}
                onPaste={() => void controller?.pasteSelection()}
                onReorder={(activeId, targetId) => controller?.reorderLayers(activeId, targetId)}
                onSelect={(id, additive) => controller?.selectLayer(id, additive)}
              />
            )}
          </aside>
          {canvasContextMenu !== null && contextMenuLayer !== null && (
            <LayerContextMenu
              canPaste={view.hasClipboard}
              editable={selectionEditable}
              layer={contextMenuLayer}
              {...(selectedLayers.length === 1
                ? {}
                : { menuLabel: `已选 ${selectedLayers.length} 个素材操作` })}
              x={canvasContextMenu.x}
              y={canvasContextMenu.y}
              onClose={() => setCanvasContextMenu(null)}
              onCopy={(id) => {
                if (!view.selectedLayerIds.includes(id)) controller?.selectLayer(id)
                controller?.copySelection()
              }}
              onCut={(id) => {
                if (!view.selectedLayerIds.includes(id)) controller?.selectLayer(id)
                controller?.cutSelection()
              }}
              onDelete={(id) => {
                if (!view.selectedLayerIds.includes(id)) controller?.selectLayer(id)
                controller?.deleteSelection()
              }}
              onDuplicate={(id) => {
                if (!view.selectedLayerIds.includes(id)) controller?.selectLayer(id)
                void controller?.duplicateSelection()
              }}
              onMove={(id, direction) => {
                if (!view.selectedLayerIds.includes(id)) controller?.selectLayer(id)
                controller?.moveSelection(direction)
              }}
              onPaste={() => void controller?.pasteSelection()}
            />
          )}
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
          <span title={`${QINGSHE_BUILD_INFO.surface} 构建版本`}>{qingsheBuildLabel()}</span>
        </div>
        <MobileTabbar
          activePanel={
            panels.assetsOpen
              ? "assets"
              : panels.rightPanel === "layers" || panels.rightPanel === "properties"
                ? panels.rightPanel
                : null
          }
          canDelete={selectionEditable}
          onDelete={() => controller?.deleteSelection()}
          onOpenAssets={panels.toggleAssetsPanel}
          onOpenLayers={() => panels.toggleRightPanel("layers")}
          onOpenMore={() => setMobileActionsOpen(true)}
          onOpenProperties={() => panels.toggleRightPanel("properties")}
          onExport={() => void requestImageExport("png")}
        />
      </footer>
      {mobileActionsOpen && panels.viewport !== "desktop" && (
        <MobileActionsSheet
          canExport={backgroundLoaded}
          isBusy={view.isBusy}
          projectName={projectMetadata.name}
          onClose={() => setMobileActionsOpen(false)}
          onExport={(format) => {
            void requestImageExport(format).finally(() => setMobileActionsOpen(false))
          }}
          onExportProject={() => {
            void exportEditableProject().finally(() => setMobileActionsOpen(false))
          }}
          onImportProject={() => {
            requestProjectImport()
            setMobileActionsOpen(false)
          }}
          onRenameProject={(name) => void projectMetadata.rename(name)}
        />
      )}
      {preparedImageExport !== null && (
        <ImageExportSheet
          blob={preparedImageExport.blob}
          format={preparedImageExport.format}
          onClose={() => setPreparedImageExport(null)}
        />
      )}
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
    case EDITOR_SHORTCUT.copySelection:
      controller.copySelection()
      return
    case EDITOR_SHORTCUT.pasteSelection:
      void controller.pasteSelection()
      return
    case EDITOR_SHORTCUT.cutSelection:
      controller.cutSelection()
      return
    case EDITOR_SHORTCUT.duplicateSelection:
      void controller.duplicateSelection()
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
