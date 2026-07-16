import { describe, expect, it } from "vitest"

import { splitProcessingTasks } from "../src/features/asset-admin/processing-task-summary"

describe("processing task summary", () => {
  it("puts unfinished work ahead of completed history", () => {
    const result = splitProcessingTasks([
      { id: "ready", status: "ready" },
      { id: "pending", status: "pending" },
      { id: "processing", status: "processing" },
    ])

    expect(result.active.map((task) => task.id)).toEqual(["pending", "processing"])
    expect(result.recent.map((task) => task.id)).toEqual(["ready"])
  })
})
