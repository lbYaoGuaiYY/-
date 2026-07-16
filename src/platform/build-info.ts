export type QingsheBuildInfo = {
  readonly revision: string
  readonly surface: string
  readonly version: string
}

export const QINGSHE_BUILD_INFO: QingsheBuildInfo =
  typeof __QINGSHE_BUILD__ === "undefined"
    ? { revision: "test", surface: "轻设 App", version: "0.0.0" }
    : __QINGSHE_BUILD__

export function qingsheBuildLabel(build: QingsheBuildInfo = QINGSHE_BUILD_INFO): string {
  return `v${build.version} · ${build.revision}`
}
