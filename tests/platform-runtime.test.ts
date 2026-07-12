import { afterEach, describe, expect, it } from "vitest"

import {
  getPlatformRuntime,
  isDesktopRuntime,
  isMobileRuntime,
} from "../src/features/projects/tauri-runtime"

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown }

const originalTauri = (window as TauriWindow).__TAURI_INTERNALS__
const originalUserAgent = navigator.userAgent
const originalPlatform = navigator.platform
const originalMaxTouchPoints = navigator.maxTouchPoints

function setTauriBridge(value: unknown): void {
  const target = window as TauriWindow
  target.__TAURI_INTERNALS__ = value
}

function setNavigator({
  maxTouchPoints,
  platform,
  userAgent,
}: {
  readonly maxTouchPoints: number
  readonly platform: string
  readonly userAgent: string
}): void {
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: maxTouchPoints })
  Object.defineProperty(navigator, "platform", { configurable: true, value: platform })
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: userAgent })
}

afterEach(() => {
  const target = window as TauriWindow
  if (originalTauri === undefined) delete target.__TAURI_INTERNALS__
  else target.__TAURI_INTERNALS__ = originalTauri
  setNavigator({
    maxTouchPoints: originalMaxTouchPoints,
    platform: originalPlatform,
    userAgent: originalUserAgent,
  })
})

describe("platform runtime", () => {
  it("uses web when the Tauri bridge is absent", () => {
    delete (window as TauriWindow).__TAURI_INTERNALS__
    expect(getPlatformRuntime()).toBe("web")
    expect(isDesktopRuntime()).toBe(false)
    expect(isMobileRuntime()).toBe(false)
  })

  it("uses desktop for a Tauri bridge on a normal desktop user agent", () => {
    setTauriBridge({})
    setNavigator({ maxTouchPoints: 0, platform: "MacIntel", userAgent: "Macintosh" })
    expect(getPlatformRuntime()).toBe("tauri-desktop")
    expect(isDesktopRuntime()).toBe(true)
    expect(isMobileRuntime()).toBe(false)
  })

  it("uses mobile for a Tauri bridge on an iPad user agent", () => {
    setTauriBridge({})
    setNavigator({
      maxTouchPoints: 5,
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
    })
    expect(getPlatformRuntime()).toBe("tauri-mobile")
    expect(isMobileRuntime()).toBe(true)
    expect(isDesktopRuntime()).toBe(false)
  })

  it("recognizes iPadOS desktop-class user agents by touch capability", () => {
    setTauriBridge({})
    setNavigator({
      maxTouchPoints: 5,
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    })
    expect(getPlatformRuntime()).toBe("tauri-mobile")
  })
})
