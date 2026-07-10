import { useEffect, useRef, useState } from "react"

export type EditorViewport = "desktop" | "tablet" | "phone"
export type RightPanelMode = "closed" | "layers" | "properties" | "both"

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
    const desktop = window.matchMedia("(min-width: 1280px)")
    const phone = window.matchMedia("(max-width: 699px)")
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

  function toggleTemporary(): void {
    if (temporarilyHidden) {
      setAssetsOpen(snapshot.current.assetsOpen)
      setRightPanel(snapshot.current.rightPanel)
    } else {
      snapshot.current = { assetsOpen, rightPanel }
      setAssetsOpen(false)
      setRightPanel("closed")
    }
    setTemporarilyHidden((hidden) => !hidden)
  }

  function openAssets(): void {
    setAssetsOpen(true)
    if (viewport !== "desktop") setRightPanel("closed")
    setTemporarilyHidden(false)
  }

  function openRightPanel(mode: "layers" | "properties"): void {
    setRightPanel(mode)
    if (viewport !== "desktop") setAssetsOpen(false)
    setTemporarilyHidden(false)
  }

  function toggleAssets(): void {
    setAssetsOpen((open) => {
      const next = !open
      if (next && viewport !== "desktop") setRightPanel("closed")
      return next
    })
    setTemporarilyHidden(false)
  }

  return {
    viewport,
    assetsOpen,
    rightPanel,
    closeAssets: () => setAssetsOpen(false),
    closeRightPanel: () => setRightPanel("closed"),
    openAssets,
    openRightPanel,
    toggleAssets,
    toggleTemporary,
  }
}

function readViewport(): EditorViewport {
  if (window.matchMedia("(min-width: 1280px)").matches) return "desktop"
  return window.matchMedia("(max-width: 699px)").matches ? "phone" : "tablet"
}
