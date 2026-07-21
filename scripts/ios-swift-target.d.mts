export declare function getIosSwiftTarget(rustTarget: string, minimumVersion: string): string
export declare function getIosSwiftLinkSearchPath(
  swiftTarget: string,
  configuration: string,
): string
export declare function getIosSwiftProductsPath(
  buildPath: string,
  swiftTarget: string,
  configuration: string,
): string
export declare function resolveIosSwiftProductsPath(
  buildPath: string,
  swiftTarget: string,
  configuration: string,
  pathExists: (path: string) => boolean,
): {
  linkPath: string
  productsPath: string
  requiresCompatibilityLink: boolean
}
