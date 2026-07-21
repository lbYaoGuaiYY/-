import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { EditorController } from "../editor/editor-controller"
import { AutosaveCoordinator, type AutosaveStatus } from "./autosave-coordinator"
import type { ProjectId, ProjectSnapshot } from "./project-format"
import { createProjectStore } from "./project-storage"
import type { LoadProjectResult, ProjectStore, StorageDurability } from "./project-store"

const AUTOSAVE_DELAY_MS = 600

export type ProjectSessionStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved"; readonly durability: StorageDurability }
  | { readonly kind: "save_failed"; readonly reason: "quota_exceeded" | "error" }
  | { readonly kind: "storage_blocked" }
  | { readonly kind: "reload_required" }
  | { readonly kind: "restore_failed" }

export type ProjectSession = {
  readonly status: ProjectSessionStatus
  readonly flush: () => Promise<void>
}

export function useProjectSession(
  controller: EditorController | null,
  projectId: ProjectId,
): ProjectSession {
  const store = useMemo<ProjectStore>(() => createProjectStore(projectId), [projectId])
  const [status, setStatus] = useState<ProjectSessionStatus>({ kind: "idle" })
  const coordinatorRef = useRef<AutosaveCoordinator<ProjectSnapshot> | null>(null)
  const flush = useCallback(async () => coordinatorRef.current?.flush(), [])

  useEffect(() => {
    if (controller === null) {
      setStatus({ kind: "idle" })
      return
    }
    const activeController = controller

    let cancelled = false
    let coordinator: AutosaveCoordinator<ProjectSnapshot> | null = null
    let unsubscribe: (() => void) | null = null

    function updateSaveStatus(nextStatus: AutosaveStatus): void {
      if (cancelled || nextStatus.kind === "idle") return
      if (nextStatus.kind === "saving") setStatus({ kind: "saving" })
      else if (nextStatus.kind === "saved") {
        setStatus({ kind: "saved", durability: nextStatus.durability })
      } else if (nextStatus.reason === "blocked") setStatus({ kind: "storage_blocked" })
      else if (nextStatus.reason === "reload_required") setStatus({ kind: "reload_required" })
      else setStatus({ kind: "save_failed", reason: nextStatus.reason })
    }

    function attachAutosave(): void {
      let latestDocument = activeController.getSnapshot().document
      coordinator = new AutosaveCoordinator({
        delayMs: AUTOSAVE_DELAY_MS,
        save: (snapshot) => store.save(snapshot),
        onStatus: updateSaveStatus,
      })
      coordinatorRef.current = coordinator
      unsubscribe = activeController.subscribe(() => {
        const document = activeController.getSnapshot().document
        if (document === latestDocument) return
        latestDocument = document
        const snapshot = activeController.captureProject()
        if (snapshot === null) setStatus({ kind: "save_failed", reason: "error" })
        else coordinator?.schedule(snapshot)
      })
      const currentSnapshot = activeController.captureProject()
      if (
        currentSnapshot !== null &&
        (latestDocument.backgroundAssetId !== null || latestDocument.layers.length > 0)
      ) {
        coordinator.schedule(currentSnapshot)
      }
    }

    async function restore(result: LoadProjectResult): Promise<void> {
      if (cancelled) return
      let safeToAutosave = result.kind === "empty"
      if (result.kind === "loaded") {
        const restored = await activeController.restoreProject(result.snapshot)
        safeToAutosave = restored
        if (!cancelled && !restored) setStatus({ kind: "restore_failed" })
      } else if (result.kind === "blocked") setStatus({ kind: "storage_blocked" })
      else if (result.kind === "reload_required") setStatus({ kind: "reload_required" })
      else if (result.kind === "corrupt" || result.kind === "error") {
        setStatus({ kind: "restore_failed" })
      }
      if (!cancelled) {
        activeController.finishInitialization()
        // Never overwrite a stored project after a failed/blocked restore.
        // Autosave resumes only after a clean load (or for a genuinely empty project).
        if (safeToAutosave) attachAutosave()
      }
    }

    async function initialize(): Promise<void> {
      try {
        await restore(await store.load())
      } catch (error) {
        if (!(error instanceof Error)) throw error
        if (!cancelled) {
          setStatus({ kind: "restore_failed" })
          activeController.finishInitialization()
        }
      }
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState === "hidden") void coordinator?.flush()
    }

    function handlePageHide(): void {
      void coordinator?.flush()
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("pagehide", handlePageHide)
    void initialize()
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("pagehide", handlePageHide)
      unsubscribe?.()
      void coordinator?.dispose()
      if (coordinatorRef.current === coordinator) coordinatorRef.current = null
    }
  }, [controller, store])

  return { status, flush }
}
