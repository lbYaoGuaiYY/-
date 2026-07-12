export type PlatformRuntime = "web" | "tauri-desktop" | "tauri-mobile"

export function getPlatformRuntime(): PlatformRuntime {
  if (typeof window === "undefined") return "web"
  if (!Reflect.has(window, "__TAURI_INTERNALS__")) return "web"
  return isMobileDevice() ? "tauri-mobile" : "tauri-desktop"
}

export function isDesktopRuntime(): boolean {
  return getPlatformRuntime() === "tauri-desktop"
}

export function isMobileRuntime(): boolean {
  return getPlatformRuntime() === "tauri-mobile"
}

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false
  const userAgent = navigator.userAgent
  if (/Android|iPad|iPhone|iPod/i.test(userAgent)) return true
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1
}
