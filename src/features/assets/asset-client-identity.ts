export type AssetClientPlatform = "ios" | "macos" | "web" | "windows"

export type AssetClientIdentity = {
  readonly id: string
  readonly platform: AssetClientPlatform
  readonly version: string
}

type StorageAdapter = Pick<Storage, "getItem" | "setItem">

const STORAGE_KEY = "qingshe.asset-client-id"
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function getAssetClientIdentity(
  storage: StorageAdapter = window.localStorage,
  randomId: () => string = () => crypto.randomUUID(),
): AssetClientIdentity {
  let id: string | null = null
  try {
    const stored = storage.getItem(STORAGE_KEY)
    if (stored !== null && UUID_PATTERN.test(stored)) id = stored
    if (id === null) {
      id = randomId()
      storage.setItem(STORAGE_KEY, id)
    }
  } catch {
    id = randomId()
  }
  return {
    id,
    platform: detectAssetClientPlatform(),
    version: import.meta.env.VITE_APP_VERSION?.trim() || "0.1.0",
  }
}

export function createAssetClientHeaders(
  identity: AssetClientIdentity,
): Readonly<Record<string, string>> {
  return {
    "X-Qingshe-Client": identity.id,
    "X-Qingshe-Platform": identity.platform,
    "X-Qingshe-Version": identity.version,
  }
}

function detectAssetClientPlatform(): AssetClientPlatform {
  const agent = navigator.userAgent
  if (
    /iPad|iPhone|iPod/i.test(agent) ||
    (/Macintosh/i.test(agent) && navigator.maxTouchPoints > 1)
  ) {
    return "ios"
  }
  if (/Windows/i.test(agent)) return "windows"
  if (/Macintosh|Mac OS X/i.test(agent)) return "macos"
  return "web"
}
