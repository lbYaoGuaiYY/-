import ky from "ky"
import { z } from "zod"
import type { LibraryAsset } from "../assets/asset-library"
import { CloudAssetCache } from "../assets/cloud-asset-cache"
import type { DemoAsset } from "../assets/demo-assets"
import { type AssetId, createAssetId } from "./editor-model"

const LocalImageMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"])
const cloudAssetCache = new CloudAssetCache()

export type LocalAssetSource = {
  readonly id: AssetId
  readonly name: string
  readonly mimeType: z.infer<typeof LocalImageMimeSchema>
  readonly blob: Blob
}

export type AssetRecord = {
  readonly id: AssetId
  readonly name: string
  readonly src: string
  readonly revokeOnDispose: boolean
  readonly localAsset: LocalAssetSource | null
}

export class AssetRegistry {
  private readonly records = new Map<AssetId, AssetRecord>()

  registerBuiltIn(asset: DemoAsset): AssetRecord {
    const id = createAssetId(`built-in:${asset.id}`)
    const existing = this.records.get(id)
    if (existing !== undefined) {
      return existing
    }

    const record = {
      id,
      name: asset.name,
      src: asset.src,
      revokeOnDispose: false,
      localAsset: null,
    } satisfies AssetRecord
    this.records.set(id, record)
    return record
  }

  async registerLibraryAsset(asset: LibraryAsset): Promise<AssetRecord> {
    switch (asset.source.kind) {
      case "built-in":
        return this.registerBuiltIn(asset.source.asset)
      case "managed": {
        const localAsset = asset.source.localAsset ?? {
          id: asset.assetId,
          name: asset.name,
          mimeType: "image/png",
          blob: await ky.get(asset.source.processedUrl, { retry: 0 }).blob(),
        }
        if (asset.source.serviceAsset !== null && asset.source.serviceAsset !== undefined) {
          try {
            await cloudAssetCache.saveProcessed(asset.source.serviceAsset, localAsset.blob)
          } catch {
            // Persisting the cache is optional; adding the downloaded asset is not.
          }
        }
        return this.registerLocalAsset(localAsset)
      }
      default: {
        const unreachable: never = asset.source
        throw new UnexpectedLibraryAssetSourceError(String(unreachable))
      }
    }
  }

  registerFile(file: File): AssetRecord {
    return this.registerLocalAsset({
      id: createAssetId(`local:${crypto.randomUUID()}`),
      name: file.name.replace(/\.[^.]+$/, "") || file.name,
      mimeType: LocalImageMimeSchema.parse(file.type),
      blob: file,
    })
  }

  registerLocalAsset(localAsset: LocalAssetSource): AssetRecord {
    const existing = this.records.get(localAsset.id)
    if (existing !== undefined) return existing

    const record = {
      id: localAsset.id,
      name: localAsset.name,
      src: URL.createObjectURL(localAsset.blob),
      revokeOnDispose: true,
      localAsset,
    } satisfies AssetRecord
    this.records.set(record.id, record)
    return record
  }

  get(id: AssetId): AssetRecord | undefined {
    return this.records.get(id)
  }

  getLocalAsset(id: AssetId): LocalAssetSource | undefined {
    return this.records.get(id)?.localAsset ?? undefined
  }

  discard(id: AssetId): void {
    const record = this.records.get(id)
    if (record === undefined) return
    if (record.revokeOnDispose) URL.revokeObjectURL(record.src)
    this.records.delete(id)
  }

  dispose(): void {
    for (const record of this.records.values()) {
      if (record.revokeOnDispose) {
        URL.revokeObjectURL(record.src)
      }
    }
    this.records.clear()
  }
}

class UnexpectedLibraryAssetSourceError extends Error {
  readonly name = "UnexpectedLibraryAssetSourceError"
}
