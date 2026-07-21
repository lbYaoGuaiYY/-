import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { RemoteAssetAdminApp } from "./features/asset-admin/RemoteAssetAdminApp"
import { AppErrorBoundary } from "./shared/AppErrorBoundary"
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
    <AppErrorBoundary>
      <RemoteAssetAdminApp />
    </AppErrorBoundary>
  </StrictMode>,
)
