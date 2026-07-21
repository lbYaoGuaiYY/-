/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENV?: string
  readonly VITE_APP_SURFACE?: string
  readonly VITE_ASSET_ADMIN_SERVICE_URL?: string
  readonly VITE_ASSET_CLOUD_URL?: string
  readonly VITE_ASSET_EDITOR_TOKEN?: string
  readonly VITE_ASSET_SERVICE_EVENTS?: string
  readonly VITE_ASSET_SERVICE_URL?: string
  readonly VITE_DISABLE_REACT_DEVTOOLS?: string
  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  __TAURI_INTERNALS__?: unknown
}

declare const __QINGSHE_BUILD__: {
  readonly revision: string
  readonly surface: string
  readonly version: string
}
