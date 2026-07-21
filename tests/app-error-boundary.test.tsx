import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AppErrorBoundary } from "../src/shared/AppErrorBoundary"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("AppErrorBoundary", () => {
  it("renders a recoverable alert without exposing the thrown error", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const onReload = vi.fn()
    const ThrowingChild = () => {
      throw new Error("secret implementation detail")
    }

    render(
      <AppErrorBoundary onReload={onReload}>
        <ThrowingChild />
      </AppErrorBoundary>,
    )

    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("页面暂时无法显示")
    expect(alert.textContent).toContain("重新载入")
    expect(alert.textContent).not.toContain("secret implementation detail")

    fireEvent.click(screen.getByRole("button", { name: "重新载入" }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })
})
