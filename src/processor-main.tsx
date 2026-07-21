import React from "react"
import ReactDOM from "react-dom/client"

import { ProcessorApp } from "./features/processor/ProcessorApp"
import { AppErrorBoundary } from "./shared/AppErrorBoundary"
import "./styles/tokens.css"
import "./styles/components.css"
import "./styles/processor.css"

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <ProcessorApp />
    </AppErrorBoundary>
  </React.StrictMode>,
)
