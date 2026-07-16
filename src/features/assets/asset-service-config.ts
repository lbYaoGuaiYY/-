const DEFAULT_ASSET_SERVICE_URL = "http://127.0.0.1:7000"
const PRODUCTION_ASSET_ORIGIN = "https://assets.xiduoduo.top"
const PRODUCTION_ASSET_PATH = "/api/v1"

export type AssetServiceEnvironment = {
  readonly VITE_APP_ENV?: string | undefined
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

export function createAssetServiceConfig(environment: AssetServiceEnvironment): AssetServiceConfig {
  const configuredUrl = environment.VITE_ASSET_SERVICE_URL?.trim()
  const configuredToken = environment.VITE_ASSET_EDITOR_TOKEN?.trim()
  const config = {
    baseUrl: (configuredUrl || DEFAULT_ASSET_SERVICE_URL).replace(/\/+$/, ""),
    editorToken: configuredToken || null,
    eventsEnabled: environment.VITE_ASSET_SERVICE_EVENTS === "1",
  }
  if (environment.VITE_APP_ENV === "production") {
    assertProductionEditorEndpoint(config.baseUrl)
  }
  return config
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
  url.searchParams.set("response_format", "3")
  if (config.editorToken !== null) url.searchParams.set("access_token", config.editorToken)
  return url.toString()
}

const importEnvironment: AssetServiceEnvironment = {
  VITE_APP_ENV: import.meta.env.VITE_APP_ENV,
  VITE_ASSET_EDITOR_TOKEN: import.meta.env.VITE_ASSET_EDITOR_TOKEN,
  VITE_ASSET_SERVICE_EVENTS: import.meta.env.VITE_ASSET_SERVICE_EVENTS,
  VITE_ASSET_SERVICE_URL: import.meta.env.VITE_ASSET_SERVICE_URL,
}

export const ASSET_SERVICE_CONFIG = createAssetServiceConfig(importEnvironment)

function assertProductionEditorEndpoint(baseUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error("生产构建必须配置可访问的素材服务地址")
  }
  if (parsed.origin !== PRODUCTION_ASSET_ORIGIN || parsed.pathname !== PRODUCTION_ASSET_PATH) {
    throw new Error("生产素材服务必须使用 https://assets.xiduoduo.top/api/v1")
  }
}
