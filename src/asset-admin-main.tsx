import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { AssetAdminApp } from "./features/asset-admin/AssetAdminApp"
import "./styles/tokens.css"
import "./styles/layout.css"
import "./styles/components.css"
import "./styles/asset-admin.css"
import "./styles/responsive.css"

class MissingRootElementError extends Error {
  readonly name = "MissingRootElementError"
}

const rootElement = document.getElementById("root")
if (rootElement === null) {
  throw new MissingRootElementError("The application root element is missing")
}

createRoot(rootElement).render(
  <StrictMode>
    <AssetAdminApp />
  </StrictMode>,
)
