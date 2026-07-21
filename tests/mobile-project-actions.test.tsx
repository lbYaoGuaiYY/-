import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MobileActionsSheet } from "../src/features/editor/MobileActionsSheet"

afterEach(cleanup)

describe("mobile project actions", () => {
  it("provides project package actions, project rename, and both image formats", () => {
    render(
      <MobileActionsSheet
        canExport
        isBusy={false}
        projectName="婚礼方案"
        onClose={() => undefined}
        onExport={() => undefined}
        onExportProject={() => undefined}
        onImportProject={() => undefined}
        onRenameProject={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: "导入可编辑项目" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "备份可编辑项目" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "导出 PNG" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "导出 JPG" })).toBeTruthy()
    expect(screen.getByRole("textbox", { name: "项目名称" })).toHaveProperty("value", "婚礼方案")
  })

  it("keeps keyboard focus inside the sheet, closes with Escape, and restores focus", () => {
    const trigger = document.createElement("button")
    trigger.textContent = "打开更多"
    document.body.append(trigger)
    trigger.focus()
    const onClose = vi.fn()
    const view = render(
      <MobileActionsSheet
        canExport
        isBusy={false}
        projectName="婚礼方案"
        onClose={onClose}
        onExport={() => undefined}
        onExportProject={() => undefined}
        onImportProject={() => undefined}
        onRenameProject={() => undefined}
      />,
    )

    const dialog = screen.getByRole("dialog", { name: "更多编辑操作" })
    expect(document.activeElement).toBe(dialog.querySelector("header button"))

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "导出 JPG" }))

    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})
