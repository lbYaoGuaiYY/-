export const OFFICIAL_ASSET_ADMIN_API_URL = "https://assets.xiduoduo.top/api/v1"

type AssetAdminEnvironment = Pick<ImportMetaEnv, "VITE_APP_ENV" | "VITE_ASSET_CLOUD_URL">

export function assetAdminCloudBaseUrl(
  environment: AssetAdminEnvironment = import.meta.env,
): string {
  const configured = environment.VITE_ASSET_CLOUD_URL?.trim().replace(/\/+$/, "") ?? ""
  if (configured !== "") return configured
  return environment.VITE_APP_ENV === "production" ? OFFICIAL_ASSET_ADMIN_API_URL : ""
}
