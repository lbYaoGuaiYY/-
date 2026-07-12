import { useManagedAssets } from "../assets/use-managed-assets"

export function ManagedAssetInventory() {
  const managedAssets = useManagedAssets()

  return (
    <section className="asset-admin-inventory" aria-labelledby="managed-assets-title">
      <header className="asset-admin-section-header">
        <h2 id="managed-assets-title">已入库素材</h2>
        <span>{managedAssets.assets.length} 项</span>
      </header>
      {managedAssets.status === "loading" && <p className="asset-admin-note">正在读取素材库</p>}
      {managedAssets.status === "error" && (
        <p className="asset-admin-error" role="alert">
          本地素材库读取失败，请刷新后重试。
        </p>
      )}
      {managedAssets.status === "ready" && managedAssets.assets.length === 0 && (
        <p className="asset-admin-note">还没有通过审核的运营素材。</p>
      )}
      {managedAssets.assets.length > 0 && (
        <ul className="asset-admin-inventory-grid">
          {managedAssets.assets.map((asset) => (
            <li key={asset.assetId}>
              <span className="asset-admin-inventory-preview">
                <img src={asset.src} alt="" />
              </span>
              <span className="asset-admin-inventory-name">{asset.name}</span>
              <span className="asset-admin-note">{asset.category}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
