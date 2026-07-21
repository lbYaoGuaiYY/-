import { type RefObject, useEffect, useRef } from "react"

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

export function useModalFocus(
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const root = container

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const initialFocus =
      container.querySelector<HTMLElement>("[data-dialog-initial-focus]") ??
      container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      container
    initialFocus.focus()

    function focusableElements(): HTMLElement[] {
      return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true",
      )
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== "Tab") return

      const focusable = focusableElements()
      if (focusable.length === 0) {
        event.preventDefault()
        root.focus()
        return
      }

      const first = focusable[0]
      const last = focusable.at(-1)
      if (first === undefined || last === undefined) return
      const active = document.activeElement
      if (event.shiftKey && (active === root || active === first || !root.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown, true)
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [containerRef])
}
