import { DownloadSimple, ShareNetwork, X } from "@phosphor-icons/react"
import { useRef, useState } from "react"

import type { ExportImageFormat } from "./fabric-runtime"
import { shareOrDownloadImage } from "./image-export"
import { useModalFocus } from "./use-modal-focus"

export function ImageExportSheet({
  blob,
  format,
  onClose,
}: {
  readonly blob: Blob
  readonly format: ExportImageFormat
  readonly onClose: () => void
}) {
  const [isDelivering, setIsDelivering] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  useModalFocus(panelRef, onClose)
  const extension = format === "jpeg" ? "jpg" : "png"
  const filename = `轻设设计-${new Date().toISOString().slice(0, 10)}.${extension}`

  async function deliver(): Promise<void> {
    setIsDelivering(true)
    try {
      await shareOrDownloadImage(blob, filename)
      onClose()
    } finally {
      setIsDelivering(false)
    }
  }

  return (
    <div className="image-export-sheet__backdrop" role="presentation">
      <section
        ref={panelRef}
        className="image-export-sheet"
        data-dialog-initial-focus
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-export-sheet-title"
        tabIndex={-1}
      >
        <header>
          <div>
            <h2 id="image-export-sheet-title">图片已生成</h2>
            <p>点按后使用 iPad 的“存储图像”或分享方式。</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭导出面板" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <button
          className="primary-button image-export-sheet__deliver"
          type="button"
          disabled={isDelivering}
          onClick={() => void deliver()}
        >
          {isDelivering ? (
            <DownloadSimple size={18} aria-hidden="true" />
          ) : (
            <ShareNetwork size={18} aria-hidden="true" />
          )}
          <span>{isDelivering ? "正在准备…" : "存储或分享图片"}</span>
        </button>
      </section>
    </div>
  )
}
