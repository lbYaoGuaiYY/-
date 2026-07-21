export declare function getIosSwiftTarget(rustTarget: string, minimumVersion: string): string
export declare function getIosSwiftLinkSearchPath(
  swiftTarget: string,
  configuration: string,
): string
export declare function parseIosSwiftProductsPath(output: string): string
export declare function prepareIosSwiftProductsLink(
  productsPath: string,
  linkPath: string,
  options: {
    allowedRoot: string
    expectedArchive: string
    stamp?: string
  },
): {
  archives: string[]
  linked: boolean
  linkPath: string
  preservedPath: string | null
  previousSymlinkTarget: string | null
  productsPath: string
}
export declare function rollbackIosSwiftProductsLink(
  state: ReturnType<typeof prepareIosSwiftProductsLink>,
): boolean
