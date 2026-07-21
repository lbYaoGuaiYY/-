import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SubmissionDialog } from "../src/features/assets/SubmissionDialog"

describe("submission dialog", () => {
  it("offers an active upload cancellation action while submitting", () => {
    const onCancelSubmit = vi.fn()

    render(
      <SubmissionDialog
        open
        isSubmitting
        onCancelSubmit={onCancelSubmit}
        onClose={() => undefined}
        onSubmit={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "取消上传" }))
    expect(onCancelSubmit).toHaveBeenCalledTimes(1)
  })
})
