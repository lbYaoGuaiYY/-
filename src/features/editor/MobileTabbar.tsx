import {
  DotsThreeOutline,
  DownloadSimple,
  Images,
  SlidersHorizontal,
  Stack,
  Trash,
} from "@phosphor-icons/react"

export type MobileTabbarProps = {
  readonly activePanel: "assets" | "layers" | "properties" | null
  readonly canDelete?: boolean
  readonly onDelete?: () => void
  readonly onExport: () => void
  readonly onOpenAssets: () => void
  readonly onOpenLayers: () => void
  readonly onOpenMore?: () => void
  readonly onOpenProperties: () => void
}

export function MobileTabbar({
  activePanel,
  canDelete = false,
  onDelete = () => undefined,
  onExport,
  onOpenAssets,
  onOpenLayers,
  onOpenMore = () => undefined,
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
      <MobileTab
        accessibleLabel="删除所选素材"
        active={false}
        disabled={!canDelete}
        icon="delete"
        label="删除"
        onClick={onDelete}
      />
      <MobileTab active={false} icon="export" label="导出" onClick={onExport} />
      <MobileTab
        active={false}
        icon="more"
        label="更多"
        accessibleLabel="更多编辑操作"
        onClick={onOpenMore}
      />
    </nav>
  )
}

function MobileTab({
  active,
  accessibleLabel,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  readonly active: boolean
  readonly accessibleLabel?: string
  readonly disabled?: boolean
  readonly icon: "assets" | "layers" | "properties" | "delete" | "export" | "more"
  readonly label: string
  readonly onClick: () => void
}) {
  const isPanelToggle = icon === "assets" || icon === "layers" || icon === "properties"
  return (
    <button
      className={`icon-button${icon === "delete" ? " danger-button" : ""}`}
      type="button"
      aria-label={accessibleLabel}
      {...(isPanelToggle ? { "aria-pressed": active } : {})}
      disabled={disabled}
      onClick={onClick}
    >
      {mobileTabIcon(icon)}
      <span>{label}</span>
    </button>
  )
}

function mobileTabIcon(icon: "assets" | "layers" | "properties" | "delete" | "export" | "more") {
  if (icon === "assets") return <Images size={18} aria-hidden="true" />
  if (icon === "layers") return <Stack size={18} aria-hidden="true" />
  if (icon === "properties") return <SlidersHorizontal size={18} aria-hidden="true" />
  if (icon === "delete") return <Trash size={18} aria-hidden="true" />
  if (icon === "more") return <DotsThreeOutline size={18} aria-hidden="true" />
  return <DownloadSimple size={18} aria-hidden="true" />
}
