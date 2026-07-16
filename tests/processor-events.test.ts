import { describe, expect, it } from "vitest"
import processorBuildScriptText from "../scripts/build-processing-agent.mjs?raw"
import { parseProcessorEvent } from "../src/features/processor/processor-events"
import processorConfigText from "../src-tauri/tauri.processor.conf.json?raw"

describe("processor desktop event protocol", () => {
  it("parses a ready status emitted by the local sidecar", () => {
    expect(parseProcessorEvent('{"type":"status","state":"ready","detail":"已连接"}')).toEqual({
      type: "status",
      state: "ready",
      detail: "已连接",
    })
  })

  it("rejects malformed or unknown sidecar messages", () => {
    expect(parseProcessorEvent("not json")).toBeNull()
    expect(parseProcessorEvent('{"type":"credentials","token":"secret"}')).toBeNull()
  })

  it("bundles the processor sidecar in a dedicated desktop app", () => {
    const config = JSON.parse(processorConfigText)

    expect(config.identifier).toBe("com.qingshe.processor")
    expect(config.app.windows[0].label).toBe("processor")
    expect(config.app.windows[0].visible).toBe(false)
    expect(config.app.windows[0].skipTaskbar).toBe(true)
    expect(config.bundle.externalBin).toEqual(["binaries/qingshe-processing-agent"])
    expect(config.build.frontendDist).toBe("../dist-processor")
    expect(config.plugins["deep-link"].desktop.schemes).toContain("qingshe-processor")
  })

  it("packages the processor desktop UI on every supported desktop platform", () => {
    expect(processorBuildScriptText).toContain('platform() === "win32" ? "nsis" : "appimage"')
    expect(processorBuildScriptText).not.toContain('if (platform() !== "darwin")')
  })
})
