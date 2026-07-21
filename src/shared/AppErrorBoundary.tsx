import { Component, type CSSProperties, type ReactNode } from "react"

export interface AppErrorBoundaryProps {
  children: ReactNode
  onReload?: () => void
}

interface AppErrorBoundaryState {
  hasError: boolean
}

const shellStyle: CSSProperties = {
  display: "grid",
  minHeight: "100dvh",
  placeItems: "center",
  width: "100%",
  padding: "var(--space-6)",
  background: "var(--surface-app)",
  color: "var(--text-primary)",
}

const cardStyle: CSSProperties = {
  width: "min(100%, 420px)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-menu)",
  background: "var(--surface-panel)",
}

const titleStyle: CSSProperties = {
  color: "var(--text-primary)",
  fontSize: "16px",
  fontWeight: 650,
  lineHeight: "20px",
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true }
  }

  private readonly handleReload = () => {
    if (this.props.onReload) {
      this.props.onReload()
      return
    }

    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <main className="app-error-boundary" role="alert" style={shellStyle}>
        <section className="empty-state" style={cardStyle}>
          <h1 style={titleStyle}>页面暂时无法显示</h1>
          <p>发生了意外错误，请重新载入后继续。</p>
          <button className="primary-button" type="button" onClick={this.handleReload}>
            重新载入
          </button>
        </section>
      </main>
    )
  }
}
