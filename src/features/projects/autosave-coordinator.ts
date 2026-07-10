import type { SaveProjectResult, StorageDurability } from "./project-store"

export type AutosaveFailure = Exclude<SaveProjectResult["kind"], "saved">

export type AutosaveStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved"; readonly durability: StorageDurability }
  | { readonly kind: "failed"; readonly retryable: boolean; readonly reason: AutosaveFailure }

export type AutosaveCoordinatorOptions<T> = {
  readonly delayMs: number
  readonly save: (snapshot: T) => Promise<SaveProjectResult>
  readonly onStatus?: (status: AutosaveStatus) => void
}

export class AutosaveCoordinator<T> {
  private readonly delayMs: number
  private readonly saveSnapshot: (snapshot: T) => Promise<SaveProjectResult>
  private readonly onStatus: ((status: AutosaveStatus) => void) | undefined
  private pending: T | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private drainPromise: Promise<void> | null = null
  private status: AutosaveStatus = { kind: "idle" }

  constructor(options: AutosaveCoordinatorOptions<T>) {
    this.delayMs = options.delayMs
    this.saveSnapshot = options.save
    this.onStatus = options.onStatus
  }

  getStatus(): AutosaveStatus {
    return this.status
  }

  schedule(snapshot: T): void {
    this.pending = snapshot
    this.updateStatus({ kind: "saving" })
    this.clearTimer()
    if (this.drainPromise === null) {
      this.timer = setTimeout(() => {
        this.timer = null
        void this.flush()
      }, this.delayMs)
    }
  }

  async flush(): Promise<void> {
    this.clearTimer()
    if (this.drainPromise !== null) {
      await this.drainPromise
      return
    }

    const drainPromise = this.drain()
    this.drainPromise = drainPromise
    try {
      await drainPromise
    } finally {
      if (this.drainPromise === drainPromise) this.drainPromise = null
    }
  }

  dispose(): void {
    this.clearTimer()
    this.pending = null
  }

  private async drain(): Promise<void> {
    while (this.pending !== null) {
      const snapshot = this.pending
      this.pending = null
      try {
        const result = await this.saveSnapshot(snapshot)
        this.updateStatus(
          result.kind === "saved"
            ? { kind: "saved", durability: result.durability }
            : {
                kind: "failed",
                retryable: result.kind === "quota_exceeded" || result.kind === "error",
                reason: result.kind,
              },
        )
      } catch (error) {
        if (error instanceof Error) {
          this.updateStatus({ kind: "failed", retryable: true, reason: "error" })
        } else {
          this.updateStatus({ kind: "failed", retryable: false, reason: "error" })
        }
      }
    }
  }

  private updateStatus(status: AutosaveStatus): void {
    this.status = status
    this.onStatus?.(status)
  }

  private clearTimer(): void {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
  }
}
