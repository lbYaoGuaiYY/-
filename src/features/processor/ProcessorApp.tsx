import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { useEffect, useState } from "react"
import { parseProcessorEvent } from "./processor-events"

export function ProcessorApp() {
  const [status, setStatus] = useState<string>("启动中...")

  useEffect(() => {
    // 兼容 e2e 预览环境，防止非 Tauri 下 listen 崩溃
    if (!window.__TAURI_INTERNALS__) return
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
  }, [])

  return (
    <main className="processor-shell" aria-label="轻抠">
      <div className="processor-card">
        <header>
          <h1>轻抠</h1>
          <p>保持运行，自动完成素材抠图</p>
        </header>
        <div className="status">{status}</div>
        <div className="actions">
          <button
            type="button"
            onClick={() => window.__TAURI_INTERNALS__ && invoke("processor_open_panel")}
          >
            打开素材面板
          </button>
          <button
            type="button"
            onClick={() => window.__TAURI_INTERNALS__ && invoke("processor_minimize")}
          >
            最小化
          </button>
          <button
            type="button"
            onClick={() => window.__TAURI_INTERNALS__ && invoke("processor_exit_command")}
          >
            退出抠图器
          </button>
        </div>
      </div>
    </main>
  )
}
