import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { useEffect, useState } from "react"
import { parseProcessorEvent } from "./processor-events"

export function ProcessorApp() {
  const isDesktop = Boolean(window.__TAURI_INTERNALS__)
  const [status, setStatus] = useState<string>(
    isDesktop ? "正在连接本地处理服务..." : "网页预览：安装版会连接本地处理服务",
  )

  useEffect(() => {
    // 兼容 e2e 预览环境，防止非 Tauri 下 listen 崩溃
    if (!isDesktop) return
    const unlisten = listen<string>("processor://event", (event) => {
      const parsed = parseProcessorEvent(event.payload)
      if (parsed?.type === "status") {
        setStatus(parsed.detail || "已连接")
      } else if (parsed?.type === "completed") {
        setStatus(`刚完成：${parsed.task_name}`)
      }
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [isDesktop])

  return (
    <main className="processor-shell" aria-label="轻抠">
      <div className="processor-card">
        <header>
          <h1>轻抠</h1>
          <p>保持运行，自动完成素材抠图</p>
        </header>
        <div className="status" role="status" aria-live="polite">
          {status}
        </div>
        <div className="actions">
          <button
            type="button"
            disabled={!isDesktop}
            onClick={() => window.__TAURI_INTERNALS__ && invoke("processor_open_panel")}
          >
            打开素材面板
          </button>
          <button
            type="button"
            disabled={!isDesktop}
            onClick={() => window.__TAURI_INTERNALS__ && invoke("processor_minimize")}
          >
            最小化
          </button>
          <button
            type="button"
            disabled={!isDesktop}
            onClick={() => window.__TAURI_INTERNALS__ && invoke("processor_exit_command")}
          >
            退出抠图器
          </button>
        </div>
      </div>
    </main>
  )
}
