import Dexie, { type Table } from "dexie"
import { z } from "zod"

import { AssetIdSchema } from "../editor/editor-model"
import { ASSET_CATEGORIES } from "./demo-assets"

const MANAGED_ASSET_SCHEMA_VERSION = 1 as const
const DATABASE_NAME = "qingshe-managed-assets-v1"

const ManagedAssetRecordSchema = z.object({
  schemaVersion: z.literal(MANAGED_ASSET_SCHEMA_VERSION),
  id: AssetIdSchema.refine((id) => id.startsWith("local:catalog:")),
  name: z.string().trim().min(1),
  category: z.enum(ASSET_CATEGORIES),
  mimeType: z.literal("image/png"),
  blob: z.instanceof(Blob),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
})

export type ManagedAssetRecord = z.infer<typeof ManagedAssetRecordSchema>

class ManagedAssetDatabase extends Dexie {
  readonly assets!: Table<unknown, string>

  constructor() {
    super(DATABASE_NAME)
    this.version(1).stores({ assets: "" })
  }
}

export class ManagedAssetStore {
  async list(): Promise<readonly ManagedAssetRecord[]> {
    const database = new ManagedAssetDatabase()
    try {
      await database.open()
      const records = await database.assets.toArray()
      return records
        .map((record) => ManagedAssetRecordSchema.parse(record))
        .sort((left, right) => left.createdAt - right.createdAt)
    } finally {
      database.close()
    }
  }

  async put(record: ManagedAssetRecord): Promise<void> {
    const parsed = ManagedAssetRecordSchema.parse(record)
    if (parsed.blob.type !== parsed.mimeType) {
      throw new ManagedAssetMimeMismatchError(parsed.blob.type)
    }
    const database = new ManagedAssetDatabase()
    try {
      await database.open()
      await database.assets.put(parsed, String(parsed.id))
    } finally {
      database.close()
    }
  }
}

class ManagedAssetMimeMismatchError extends Error {
  readonly name = "ManagedAssetMimeMismatchError"

  constructor(readonly actualMimeType: string) {
    super(`Expected image/png, received ${actualMimeType || "unknown"}`)
  }
}
