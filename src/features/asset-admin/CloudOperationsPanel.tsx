import { ArrowClockwise, CloudCheck, CloudWarning, Gauge, Heartbeat } from "@phosphor-icons/react"
import { useCallback, useEffect, useState } from "react"

import {
  type CloudControlsPatch,
  type CloudOperationsSummary,
  formatCloudBytes,
  patchCloudControls,
  readCloudOperationsSummary,
} from "./cloud-operations-client"

export function CloudOperationsPanel({ compact = false }: { readonly compact?: boolean }) {
  const [summary, setSummary] = useState<CloudOperationsSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async (): Promise<void> => {
    try {
      setSummary(await readCloudOperationsSummary())
      setError(null)
    } catch (nextError) {
      setError(
        nextError instanceof Error && nextError.name !== "ZodError"
          ? nextError.message
          : "云端状态数据暂时无法读取",
      )
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 30_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  async function updateControls(patch: CloudControlsPatch): Promise<void> {
    setBusy(true)
    try {
      await patchCloudControls(patch)
      await refresh()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "云端控制修改失败")
    } finally {
      setBusy(false)
    }
  }

  const content = (
    <>
      {summary !== null && (
        <div className="asset-admin-cloud__body">
          <dl className="asset-admin-cloud__metrics">
            <Metric label="CPU" value={`${summary.host.cpu.estimated_usage_percent}%`} />
            <Metric label="内存" value={`${summary.host.memory.used_percent}%`} />
            <Metric label="磁盘" value={`${summary.host.disk.used_percent}%`} />
            <Metric label="素材" value={`${summary.library.ready} / ${summary.library.total}`} />
            <Metric label="库占用" value={formatCloudBytes(summary.library.bytes)} />
            <Metric label="活跃客户端" value={String(summary.clients.active_5m)} />
            <Metric label="下载中" value={String(summary.transfers.active_downloads)} />
            <Metric label="24h 下载" value={`${summary.transfers.downloads_24h} 次`} />
            <Metric
              label="24h 流量"
              value={formatCloudBytes(summary.transfers.download_bytes_24h)}
            />
          </dl>
          <fieldset className="asset-admin-cloud__controls">
            <legend className="sr-only">云端控制</legend>
            <span>
              <Gauge size={16} aria-hidden="true" />
              并发上限 {summary.controls.max_concurrent_downloads}
            </span>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() =>
                void updateControls({ downloads_enabled: !summary.controls.downloads_enabled })
              }
            >
              {summary.controls.downloads_enabled ? "暂停新下载" : "恢复新下载"}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => {
                const entering = !summary.controls.maintenance_mode
                if (!entering || window.confirm("维护模式会暂停普通素材读取，是否继续？"))
                  void updateControls({ maintenance_mode: entering })
              }}
            >
              {summary.controls.maintenance_mode ? "结束维护" : "进入维护"}
            </button>
          </fieldset>
          {summary.alerts.length > 0 && (
            <ul className="asset-admin-cloud__alerts" aria-label="云端告警">
              {summary.alerts.map((alert) => (
                <li key={alert.code}>
                  <Heartbeat size={15} aria-hidden="true" />
                  {alert.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error !== null && (
        <p className="asset-admin-cloud__error" role="status">
          {error}
        </p>
      )}
    </>
  )

  const status = summary === null ? "读取中" : summary.status === "ready" ? "连接正常" : "需要注意"
  const title = (
    <div>
      {summary?.status === "ready" ? (
        <CloudCheck size={18} aria-hidden="true" />
      ) : (
        <CloudWarning size={18} aria-hidden="true" />
      )}
      <h2 id="cloud-operations-title">云端诊断</h2>
      <span>{status}</span>
    </div>
  )

  if (compact)
    return (
      <section className="asset-admin-cloud is-compact" aria-labelledby="cloud-operations-title">
        <details>
          <summary className="asset-admin-cloud__header">{title}</summary>
          {content}
        </details>
      </section>
    )

  return (
    <section className="asset-admin-cloud" aria-labelledby="cloud-operations-title">
      <header className="asset-admin-cloud__header">
        {title}
        <button
          className="icon-button"
          type="button"
          title="刷新云端状态"
          aria-label="刷新云端状态"
          onClick={() => void refresh()}
        >
          <ArrowClockwise size={16} aria-hidden="true" />
        </button>
      </header>
      {content}
    </section>
  )
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {label} {value}
      </dd>
    </div>
  )
}
