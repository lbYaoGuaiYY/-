import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { ManualApp } from "./features/manual/ManualApp"
import "./styles/tokens.css"
import "./styles/manual.css"

const rootElement = document.getElementById("root")
if (rootElement === null) throw new Error("说明书页面缺少根节点")

createRoot(rootElement).render(
  <StrictMode>
    <ManualApp />
  </StrictMode>,
)
