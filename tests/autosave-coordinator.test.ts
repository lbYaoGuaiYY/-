import { afterEach, describe, expect, it, vi } from "vitest"

import { AutosaveCoordinator } from "../src/features/projects/autosave-coordinator"

type Snapshot = { readonly revision: number }

afterEach(() => {
  vi.useRealTimers()
})

describe("AutosaveCoordinator", () => {
  it("persists a pending snapshot before disposal completes", async () => {
    // Given
    vi.useFakeTimers()
    const save = vi.fn(async () => ({ kind: "saved", durability: "persistent" }) as const)
    const coordinator = new AutosaveCoordinator<Snapshot>({ delayMs: 600, save })
    coordinator.schedule({ revision: 1 })

    // When
    await coordinator.dispose()

    // Then
    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith({ revision: 1 })
  })

  it("ignores new snapshots after disposal", async () => {
    // Given
    const save = vi.fn(async () => ({ kind: "saved", durability: "persistent" }) as const)
    const coordinator = new AutosaveCoordinator<Snapshot>({ delayMs: 600, save })
    await coordinator.dispose()

    // When
    coordinator.schedule({ revision: 1 })
    await coordinator.flush()

    // Then
    expect(save).not.toHaveBeenCalled()
  })

  it("marks a newly scheduled change as saving during the debounce window", () => {
    vi.useFakeTimers()
    const coordinator = new AutosaveCoordinator<Snapshot>({
      delayMs: 600,
      save: async () => ({ kind: "saved", durability: "persistent" }),
    })

    coordinator.schedule({ revision: 1 })

    expect(coordinator.getStatus()).toEqual({ kind: "saving" })
  })

  it("debounces changes for 600ms", async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => ({ kind: "saved", durability: "persistent" }) as const)
    const coordinator = new AutosaveCoordinator<Snapshot>({ delayMs: 600, save })

    coordinator.schedule({ revision: 1 })
    await vi.advanceTimersByTimeAsync(599)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await coordinator.flush()

    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith({ revision: 1 })
  })

  it("serializes writes and persists only the latest pending snapshot", async () => {
    let finishFirst = (): void => undefined
    const saved: number[] = []
    const save = vi.fn(async (snapshot: Snapshot) => {
      saved.push(snapshot.revision)
      if (snapshot.revision === 1) {
        await new Promise<void>((resolve) => {
          finishFirst = resolve
        })
      }
      return { kind: "saved", durability: "persistent" } as const
    })
    const coordinator = new AutosaveCoordinator<Snapshot>({ delayMs: 600, save })

    coordinator.schedule({ revision: 1 })
    const flushing = coordinator.flush()
    coordinator.schedule({ revision: 2 })
    coordinator.schedule({ revision: 3 })
    finishFirst()
    await flushing

    expect(saved).toEqual([1, 3])
    expect(save).toHaveBeenCalledTimes(2)
  })

  it("maps quota failures to a retryable failed status", async () => {
    const statuses: string[] = []
    const coordinator = new AutosaveCoordinator<Snapshot>({
      delayMs: 600,
      save: async () => ({ kind: "quota_exceeded" }),
      onStatus: (status) => statuses.push(status.kind),
    })

    coordinator.schedule({ revision: 1 })
    await coordinator.flush()

    expect(statuses).toEqual(["saving", "failed"])
    expect(coordinator.getStatus()).toEqual({
      kind: "failed",
      retryable: true,
      reason: "quota_exceeded",
    })
  })

  it("retries one transient storage error before reporting save failure", async () => {
    // Given
    const save = vi
      .fn()
      .mockResolvedValueOnce({ kind: "error" } as const)
      .mockResolvedValueOnce({ kind: "saved", durability: "persistent" } as const)
    const coordinator = new AutosaveCoordinator<Snapshot>({ delayMs: 600, save })

    // When
    coordinator.schedule({ revision: 1 })
    await coordinator.flush()

    // Then
    expect(save).toHaveBeenCalledTimes(2)
    expect(coordinator.getStatus()).toEqual({ kind: "saved", durability: "persistent" })
  })
})
