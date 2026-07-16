import { z } from "zod"

const ProcessorEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status"),
    state: z.enum(["connecting", "pairing", "ready", "processing", "error", "stopped"]),
    detail: z.string(),
  }),
  z.object({ type: z.literal("node"), server: z.string().url(), platform: z.string() }),
  z.object({ type: z.literal("completed"), task_name: z.string().min(1) }),
])

export type ProcessorEvent = z.infer<typeof ProcessorEventSchema>

export function parseProcessorEvent(value: unknown): ProcessorEvent | null {
  let payload = value
  if (typeof value === "string") {
    try {
      payload = JSON.parse(value)
    } catch {
      return null
    }
  }
  const parsed = ProcessorEventSchema.safeParse(payload)
  return parsed.success ? parsed.data : null
}
