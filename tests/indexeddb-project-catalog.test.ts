import { beforeEach, describe, expect, it, vi } from "vitest"

const databaseState = vi.hoisted(() => ({
  projects: new Map<string, unknown>(),
  metadata: new Map<string, unknown>(),
  assets: new Map<string, unknown>(),
}))

vi.mock("../src/features/projects/project-database", () => {
  class FakeTable {
    constructor(private readonly records: Map<string, unknown>) {}

    async delete(id: string): Promise<void> {
      this.records.delete(id)
    }

    async toArray(): Promise<unknown[]> {
      return [...this.records.values()]
    }

    toCollection(): { primaryKeys: () => Promise<string[]> } {
      return { primaryKeys: async () => [...this.records.keys()] }
    }

    async bulkDelete(ids: readonly string[]): Promise<void> {
      for (const id of ids) this.records.delete(id)
    }
  }

  return {
    ProjectDatabase: class {
      readonly projects = new FakeTable(databaseState.projects)
      readonly projectMetadata = new FakeTable(databaseState.metadata)
      readonly assets = new FakeTable(databaseState.assets)
      readonly blocked = false
      readonly versionChanged = false

      async open(): Promise<void> {}
      close(): void {}

      async transaction(
        _mode: string,
        _projects: FakeTable,
        _metadata: FakeTable,
        _assets: FakeTable,
        operation: () => Promise<void>,
      ): Promise<void> {
        const projects = new Map(databaseState.projects)
        const metadata = new Map(databaseState.metadata)
        const assets = new Map(databaseState.assets)
        try {
          await operation()
        } catch (error) {
          databaseState.projects = projects
          databaseState.metadata = metadata
          databaseState.assets = assets
          throw error
        }
      }
    },
  }
})

import { IndexedDbProjectCatalog } from "../src/features/projects/indexeddb-project-catalog"
import { createProjectId } from "../src/features/projects/project-format"

beforeEach(() => {
  databaseState.projects.clear()
  databaseState.metadata.clear()
  databaseState.assets.clear()
})

describe("IndexedDbProjectCatalog", () => {
  it("rolls back project deletion when another project record is corrupt", async () => {
    // Given
    databaseState.projects.set("target", { schemaVersion: 2 })
    databaseState.metadata.set("target", { schemaVersion: 1 })
    databaseState.projects.set("corrupt", { unexpected: true })
    databaseState.assets.set("local:1", new Blob(["asset"]))

    // When
    const result = await new IndexedDbProjectCatalog().deleteProject(createProjectId("target"))

    // Then
    expect(result).toEqual({ kind: "error" })
    expect(databaseState.projects.has("target")).toBe(true)
    expect(databaseState.metadata.has("target")).toBe(true)
    expect(databaseState.assets.has("local:1")).toBe(true)
  })
})
