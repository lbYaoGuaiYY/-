import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../src/features/assets/asset-service-config", () => ({
  ASSET_SERVICE_CONFIG: {
    baseUrl: "http://127.0.0.1:7000",
    editorToken: null,
    eventsEnabled: true,
  },
  createAssetServiceHeaders: () => ({}),
  createAssetServiceMediaUrl: () => "http://127.0.0.1/media",
}))

type EventListener = (event: Event) => void

class FakeEventSource {
  static latest: FakeEventSource | null = null
  private readonly listeners = new Map<string, EventListener[]>()

  constructor(_url: URL) {
    FakeEventSource.latest = this
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? []
    this.listeners.set(type, [...listeners, listener])
  }

  close(): void {}

  emit(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data }))
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeEventSource.latest = null
})

describe("asset service events", () => {
  it("skips malformed messages and continues with the next valid event", async () => {
    // Given
    vi.stubGlobal("EventSource", FakeEventSource)
    const { subscribeToAssetEvents } = await import("../src/features/assets/asset-service-client")
    const onEvent = vi.fn()
    subscribeToAssetEvents(onEvent)
    const source = FakeEventSource.latest
    if (source === null) throw new Error("EventSource was not created")

    // When
    expect(() => source.emit("asset.ready", "not-json")).not.toThrow()
    expect(() => source.emit("asset.ready", JSON.stringify({ assetId: "invalid" }))).not.toThrow()
    source.emit("asset.ready", JSON.stringify({ assetId: "7f9e4b50-3c9d-4ab2-8f1a-33409a62d7e1" }))

    // Then
    expect(onEvent).toHaveBeenCalledOnce()
    expect(onEvent).toHaveBeenCalledWith({
      assetId: "7f9e4b50-3c9d-4ab2-8f1a-33409a62d7e1",
      type: "asset.ready",
    })
  })
})
