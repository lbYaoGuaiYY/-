import { describe, expect, it } from "vitest"

import {
  buildProcessingTaskMetadata,
  buildProcessorLaunchUrl,
  parseRemoteProcessingDashboard,
  processingAgentDownloadUrl,
  processingNodePlatformLabel,
  selectLocalProcessingNode,
  selectPreferredProcessingNode,
} from "../src/features/asset-admin/remote-processing-client"

describe("remote processing dashboard", () => {
  it("parses a Mac node and its cloud task state", () => {
    expect(
      parseRemoteProcessingDashboard({
        nodes: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "这台 Mac",
            platform: "macos",
            status: "online",
            last_seen: "2026-07-13T08:00:00+00:00",
            created_at: "2026-07-13T07:00:00+00:00",
          },
        ],
        tasks: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            name: "花艺",
            category: "花艺",
            needs_review: false,
            status: "processing",
            node_id: "11111111-1111-4111-8111-111111111111",
            asset_id: null,
            error: null,
            created_at: "2026-07-13T08:01:00+00:00",
            updated_at: "2026-07-13T08:02:00+00:00",
          },
        ],
      }),
    ).toMatchObject({
      nodes: [{ name: "这台 Mac", platform: "macos" }],
      tasks: [{ status: "processing", node_id: "11111111-1111-4111-8111-111111111111" }],
    })
  })

  it("parses extension device and full-auto run progress", () => {
    const parsed = parseRemoteProcessingDashboard({
      nodes: [],
      tasks: [],
      extension_devices: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          name: "Chrome on Mac",
          platform: "chrome",
          status: "online",
          last_seen: "2026-07-15T04:00:00+00:00",
          created_at: "2026-07-15T03:00:00+00:00",
        },
      ],
      automation_runs: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          device_id: "33333333-3333-4333-8333-333333333333",
          provider: "chatgpt",
          prompt: "婚庆素材",
          count: 10,
          category: "婚庆",
          status: "running",
          error: null,
          created_at: "2026-07-15T04:00:00+00:00",
          updated_at: "2026-07-15T04:01:00+00:00",
          total: 10,
          ready: 4,
          failed: 0,
          items: [],
        },
      ],
    })

    expect(parsed.extension_devices[0]).toMatchObject({ name: "Chrome on Mac", status: "online" })
    expect(parsed.automation_runs[0]).toMatchObject({ prompt: "婚庆素材", total: 10, ready: 4 })
  })

  it("shows the active processor instead of an older offline record", () => {
    const dashboard = parseRemoteProcessingDashboard({
      nodes: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "旧 Mac",
          platform: "macos",
          status: "offline",
          last_seen: "2026-07-14T08:00:00+00:00",
          created_at: "2026-07-14T07:00:00+00:00",
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "这台 Mac",
          platform: "macos",
          status: "online",
          last_seen: "2026-07-15T08:00:00+00:00",
          created_at: "2026-07-15T07:00:00+00:00",
        },
      ],
      tasks: [],
    })

    expect(selectPreferredProcessingNode(dashboard.nodes)).toMatchObject({
      name: "这台 Mac",
      status: "online",
    })
  })

  it("distinguishes this computer from processors on other computers", () => {
    const dashboard = parseRemoteProcessingDashboard({
      nodes: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "工作室 Mac",
          platform: "macos",
          status: "online",
          client_id: "33333333-3333-4333-8333-333333333333",
          last_seen: "2026-07-16T08:00:00+00:00",
          created_at: "2026-07-16T07:00:00+00:00",
        },
      ],
      tasks: [],
    })

    expect(
      selectLocalProcessingNode(dashboard.nodes, "33333333-3333-4333-8333-333333333333"),
    ).toMatchObject({ name: "工作室 Mac", status: "online" })
    expect(
      selectLocalProcessingNode(dashboard.nodes, "44444444-4444-4444-8444-444444444444"),
    ).toBeUndefined()
    expect(processingNodePlatformLabel("macos")).toBe("macOS")
  })

  it("builds the installed processor deep link for this panel", () => {
    expect(buildProcessorLaunchUrl("33333333-3333-4333-8333-333333333333")).toBe(
      "qingshe-processor://open?client_id=33333333-3333-4333-8333-333333333333",
    )
  })

  it("omits the category override when automatic recognition is selected", () => {
    expect(buildProcessingTaskMetadata("迎宾花艺.png", "")).toEqual({
      name: "迎宾花艺",
      needs_review: false,
    })
  })

  it("links to the packaged processor instead of a Python source file", () => {
    expect(processingAgentDownloadUrl("https://assets.xiduoduo.top/api/v1")).toBe(
      "https://assets.xiduoduo.top/downloads/qingshe-processor",
    )
  })
})
