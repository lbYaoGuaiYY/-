import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MobileActionsSheet } from "../src/features/editor/MobileActionsSheet"

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
})
