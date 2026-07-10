import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"
import "./styles/tokens.css"
import "./styles/layout.css"
import "./styles/components.css"
import "./styles/editor-components.css"
import "./styles/responsive.css"

class MissingRootElementError extends Error {
  readonly name = "MissingRootElementError"
}

if (import.meta.env.DEV && import.meta.env.VITE_DISABLE_REACT_DEVTOOLS !== "1") {
  void import("react-grab")
  void import("react-scan")
}

const rootElement = document.getElementById("root")
if (rootElement === null) {
  throw new MissingRootElementError("The application root element is missing")
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
