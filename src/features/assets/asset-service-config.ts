const DEFAULT_ASSET_SERVICE_URL = "http://127.0.0.1:7000"

export type AssetServiceEnvironment = {
  readonly VITE_APP_SURFACE?: string | undefined
  readonly VITE_ASSET_ADMIN_SERVICE_URL?: string | undefined
  readonly VITE_ASSET_EDITOR_TOKEN?: string | undefined
  readonly VITE_ASSET_SERVICE_EVENTS?: string | undefined
  readonly VITE_ASSET_SERVICE_URL?: string | undefined
}

export type AssetServiceConfig = {
  readonly baseUrl: string
  readonly editorToken: string | null
  readonly eventsEnabled: boolean
}

export type AssetMediaKind = "original" | "processed" | "thumbnail"
export type AssetServiceSurface = "admin" | "editor"

export function createAssetServiceConfig(
  environment: AssetServiceEnvironment,
  surface: AssetServiceSurface = "editor",
): AssetServiceConfig {
  const configuredUrl = (
    surface === "admin"
      ? environment.VITE_ASSET_ADMIN_SERVICE_URL
      : environment.VITE_ASSET_SERVICE_URL
  )?.trim()
  const configuredToken =
    surface === "editor" ? environment.VITE_ASSET_EDITOR_TOKEN?.trim() : undefined
  return {
    baseUrl: (configuredUrl || DEFAULT_ASSET_SERVICE_URL).replace(/\/+$/, ""),
    editorToken: configuredToken || null,
    eventsEnabled: surface === "admin",
  }
}

export function createAssetServiceHeaders(
  config: AssetServiceConfig,
): Readonly<Record<string, string>> {
  return config.editorToken === null ? {} : { Authorization: `Bearer ${config.editorToken}` }
}

export function createAssetServiceMediaUrl(
  config: AssetServiceConfig,
  assetId: string,
  kind: AssetMediaKind,
  version: number,
): string {
  const url = new URL(`${config.baseUrl}/assets/${encodeURIComponent(assetId)}/${kind}`)
  url.searchParams.set("version", String(version))
  if (config.editorToken !== null) url.searchParams.set("access_token", config.editorToken)
  return url.toString()
}

const currentSurface: AssetServiceSurface =
  import.meta.env.VITE_APP_SURFACE === "asset-admin" ||
  window.location.pathname.startsWith("/asset-admin") ||
  window.location.pathname.endsWith("/asset-admin.html")
    ? "admin"
    : "editor"

const importEnvironment: AssetServiceEnvironment = {
  VITE_APP_SURFACE: import.meta.env.VITE_APP_SURFACE,
  VITE_ASSET_ADMIN_SERVICE_URL: import.meta.env.VITE_ASSET_ADMIN_SERVICE_URL,
  VITE_ASSET_EDITOR_TOKEN: import.meta.env.VITE_ASSET_EDITOR_TOKEN,
  VITE_ASSET_SERVICE_EVENTS: import.meta.env.VITE_ASSET_SERVICE_EVENTS,
  VITE_ASSET_SERVICE_URL: import.meta.env.VITE_ASSET_SERVICE_URL,
}

export const ASSET_SERVICE_CONFIG = createAssetServiceConfig(importEnvironment, currentSurface)
