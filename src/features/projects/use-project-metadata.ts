import { useCallback, useEffect, useMemo, useState } from "react"

import type { ProjectId } from "./project-format"
import { createProjectCatalog } from "./project-storage"

export type ProjectMetadataSession = {
  readonly name: string
  readonly rename: (name: string) => Promise<boolean>
}

export function useProjectMetadata(projectId: ProjectId): ProjectMetadataSession {
  const catalog = useMemo(createProjectCatalog, [])
  const [name, setName] = useState("未命名设计")

  useEffect(() => {
    let active = true
    void catalog.listProjects().then((result) => {
      if (!active || result.kind !== "loaded") return
      const project = result.projects.find((candidate) => candidate.id === projectId)
      if (project !== undefined) setName(project.name)
    })
    return () => {
      active = false
    }
  }, [catalog, projectId])

  const rename = useCallback(
    async (nextName: string): Promise<boolean> => {
      const normalized = nextName.trim()
      if (normalized.length === 0 || normalized === name) return normalized === name
      const result = await catalog.renameProject(projectId, normalized)
      if (result.kind !== "saved") return false
      setName(normalized)
      return true
    },
    [catalog, name, projectId],
  )

  return { name, rename }
}
