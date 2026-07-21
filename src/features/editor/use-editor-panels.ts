import { useCallback, useEffect, useMemo, useRef, useState } from "react"

export type EditorViewport = "desktop" | "tablet" | "phone"
export type RightPanelMode = "closed" | "layers" | "properties" | "both"
export const EDITOR_DESKTOP_MIN_WIDTH = 1180
export const EDITOR_PHONE_MAX_WIDTH = 699

type PanelSnapshot = {
  readonly assetsOpen: boolean
  readonly rightPanel: RightPanelMode
}

export function useEditorPanels() {
  const [viewport, setViewport] = useState<EditorViewport>(readViewport)
  const [assetsOpen, setAssetsOpen] = useState(() => readViewport() === "desktop")
  const [rightPanel, setRightPanel] = useState<RightPanelMode>(() =>
    readViewport() === "desktop" ? "both" : "closed",
  )
  const [temporarilyHidden, setTemporarilyHidden] = useState(false)
  const snapshot = useRef<PanelSnapshot>({ assetsOpen, rightPanel })

  useEffect(() => {
    const desktop = window.matchMedia(`(min-width: ${EDITOR_DESKTOP_MIN_WIDTH}px)`)
    const phone = window.matchMedia(`(max-width: ${EDITOR_PHONE_MAX_WIDTH}px)`)
    const update = (): void =>
      setViewport(desktop.matches ? "desktop" : phone.matches ? "phone" : "tablet")
    desktop.addEventListener("change", update)
    phone.addEventListener("change", update)
    return () => {
      desktop.removeEventListener("change", update)
      phone.removeEventListener("change", update)
    }
  }, [])

  useEffect(() => {
    setAssetsOpen(viewport === "desktop")
    setRightPanel(viewport === "desktop" ? "both" : "closed")
    setTemporarilyHidden(false)
  }, [viewport])

  const toggleTemporary = useCallback((): void => {
    if (temporarilyHidden) {
      setAssetsOpen(snapshot.current.assetsOpen)
      setRightPanel(snapshot.current.rightPanel)
    } else {
      snapshot.current = { assetsOpen, rightPanel }
      setAssetsOpen(false)
      setRightPanel("closed")
    }
    setTemporarilyHidden((hidden) => !hidden)
  }, [assetsOpen, rightPanel, temporarilyHidden])

  const openAssets = useCallback((): void => {
    setAssetsOpen(true)
    if (viewport !== "desktop") setRightPanel("closed")
    setTemporarilyHidden(false)
  }, [viewport])

  const openRightPanel = useCallback(
    (mode: "layers" | "properties"): void => {
      setRightPanel(mode)
      if (viewport !== "desktop") setAssetsOpen(false)
      setTemporarilyHidden(false)
    },
    [viewport],
  )

  const toggleAssets = useCallback((): void => {
    setAssetsOpen((open) => {
      const next = !open
      if (next && viewport !== "desktop") setRightPanel("closed")
      return next
    })
    setTemporarilyHidden(false)
  }, [viewport])

  const closeAssets = useCallback(() => setAssetsOpen(false), [])
  const closeRightPanel = useCallback(() => setRightPanel("closed"), [])
  const closeAll = useCallback((): void => {
    setAssetsOpen(false)
    setRightPanel("closed")
    setTemporarilyHidden(false)
  }, [])

  const toggleAssetsPanel = useCallback((): void => {
    setAssetsOpen((open) => {
      const next = !open
      if (next && viewport !== "desktop") setRightPanel("closed")
      return next
    })
    setTemporarilyHidden(false)
  }, [viewport])

  const toggleRightPanel = useCallback(
    (mode: "layers" | "properties"): void => {
      setRightPanel((current) => {
        if (current === mode) return "closed"
        if (viewport !== "desktop") setAssetsOpen(false)
        return mode
      })
      setTemporarilyHidden(false)
    },
    [viewport],
  )

  return useMemo(
    () => ({
      viewport,
      assetsOpen,
      rightPanel,
      closeAll,
      closeAssets,
      closeRightPanel,
      openAssets,
      openRightPanel,
      toggleAssets,
      toggleAssetsPanel,
      toggleRightPanel,
      toggleTemporary,
    }),
    [
      assetsOpen,
      closeAll,
      closeAssets,
      closeRightPanel,
      openAssets,
      openRightPanel,
      rightPanel,
      toggleAssets,
      toggleAssetsPanel,
      toggleRightPanel,
      toggleTemporary,
      viewport,
    ],
  )
}

function readViewport(): EditorViewport {
  if (window.matchMedia(`(min-width: ${EDITOR_DESKTOP_MIN_WIDTH}px)`).matches) return "desktop"
  return window.matchMedia(`(max-width: ${EDITOR_PHONE_MAX_WIDTH}px)`).matches ? "phone" : "tablet"
}

export function editorViewportForWidth(width: number): EditorViewport {
  if (width >= EDITOR_DESKTOP_MIN_WIDTH) return "desktop"
  return width <= EDITOR_PHONE_MAX_WIDTH ? "phone" : "tablet"
}
