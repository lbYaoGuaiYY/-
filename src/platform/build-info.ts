import releaseManifest from "../../config/release-manifest.json" with { type: "json" }

export type QingsheBuildInfo = {
  readonly revision: string
  readonly surface: string
  readonly version: string
}

export const QINGSHE_RELEASE_VERSION = releaseManifest.version

export const QINGSHE_BUILD_INFO: QingsheBuildInfo =
  typeof __QINGSHE_BUILD__ === "undefined"
    ? { revision: "test", surface: releaseManifest.productName, version: QINGSHE_RELEASE_VERSION }
    : __QINGSHE_BUILD__

export function qingsheBuildLabel(build: QingsheBuildInfo = QINGSHE_BUILD_INFO): string {
  return `v${build.version} · ${build.revision}`
}
