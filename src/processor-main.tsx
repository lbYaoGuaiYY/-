import React from "react"
import ReactDOM from "react-dom/client"

import { ProcessorApp } from "./features/processor/ProcessorApp"
import "./styles/tokens.css"
import "./styles/processor.css"

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ProcessorApp />
  </React.StrictMode>,
)
