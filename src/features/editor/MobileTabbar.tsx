import { DownloadSimple, Images, SlidersHorizontal, Stack } from "@phosphor-icons/react"

export type MobileTabbarProps = {
  readonly activePanel: "assets" | "layers" | "properties" | null
  readonly onExport: () => void
  readonly onOpenAssets: () => void
  readonly onOpenLayers: () => void
  readonly onOpenProperties: () => void
}

export function MobileTabbar({
  activePanel,
  onExport,
  onOpenAssets,
  onOpenLayers,
  onOpenProperties,
}: MobileTabbarProps) {
  return (
    <nav className="mobile-tabbar" aria-label="移动端面板">
      <MobileTab
        active={activePanel === "assets"}
        icon="assets"
        label="素材"
        onClick={onOpenAssets}
      />
      <MobileTab
        active={activePanel === "layers"}
        icon="layers"
        label="图层"
        onClick={onOpenLayers}
      />
      <MobileTab
        active={activePanel === "properties"}
        icon="properties"
        label="属性"
        onClick={onOpenProperties}
      />
      <MobileTab active={false} icon="export" label="导出" onClick={onExport} />
    </nav>
  )
}

function MobileTab({
  active,
  icon,
  label,
  onClick,
}: {
  readonly active: boolean
  readonly icon: "assets" | "layers" | "properties" | "export"
  readonly label: string
  readonly onClick: () => void
}) {
  return (
    <button className="icon-button" type="button" aria-pressed={active} onClick={onClick}>
      {mobileTabIcon(icon)}
      <span>{label}</span>
    </button>
  )
}

function mobileTabIcon(icon: "assets" | "layers" | "properties" | "export") {
  if (icon === "assets") return <Images size={18} aria-hidden="true" />
  if (icon === "layers") return <Stack size={18} aria-hidden="true" />
  if (icon === "properties") return <SlidersHorizontal size={18} aria-hidden="true" />
  return <DownloadSimple size={18} aria-hidden="true" />
}
