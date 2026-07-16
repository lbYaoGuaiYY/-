export type ProcessingTaskState = { readonly status: string }

export function splitProcessingTasks<Task extends ProcessingTaskState>(
  tasks: readonly Task[],
): {
  readonly active: readonly Task[]
  readonly recent: readonly Task[]
} {
  return {
    active: tasks.filter((task) => task.status !== "ready"),
    recent: tasks.filter((task) => task.status === "ready").slice(0, 3),
  }
}
