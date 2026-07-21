import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"
import { ProjectHome } from "./features/projects/ProjectHome"
import {
  ACTIVE_PROJECT_KEY,
  createProjectId,
  ProjectIdSchema,
} from "./features/projects/project-format"
import { AppErrorBoundary } from "./shared/AppErrorBoundary"
import "./styles/tokens.css"
import "./styles/layout.css"
import "./styles/components.css"
import "./styles/editor-components.css"
import "./styles/offline-asset-manager.css"
import "./styles/project-home.css"
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

const pathname = window.location.pathname.replace(/\/+$/, "")
const workspace = resolveWorkspace(pathname)

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>{workspace}</AppErrorBoundary>
  </StrictMode>,
)

function resolveWorkspace(pathname: string) {
  if (pathname === "/projects") return <ProjectHome />
  const projectParam = new URLSearchParams(window.location.search).get("project")
  const parsedProjectId = ProjectIdSchema.safeParse(projectParam)
  const projectId = parsedProjectId.success
    ? parsedProjectId.data
    : createProjectId(ACTIVE_PROJECT_KEY)
  return <App projectId={projectId} />
}
