export type ProcessedVersionMetadata = {
  readonly cacheKey: string
  readonly id: string
  readonly version: number
  readonly pinned: boolean
}

export function planProcessedVersionWrite<T extends ProcessedVersionMetadata>(
  existing: readonly T[],
  next: T,
): {
  readonly record: T
  readonly staleCacheKeys: readonly string[]
  readonly shouldWrite: boolean
} {
  const current = existing.reduce<T | undefined>(
    (latest, candidate) =>
      latest === undefined || candidate.version > latest.version ? candidate : latest,
    undefined,
  )
  if (current !== undefined && next.version < current.version) {
    return { record: current, staleCacheKeys: [], shouldWrite: false }
  }

  const record = existing.some((candidate) => candidate.pinned) ? { ...next, pinned: true } : next
  return {
    record,
    staleCacheKeys:
      current !== undefined && next.version > current.version
        ? existing
            .filter((candidate) => candidate.version < next.version)
            .map((candidate) => candidate.cacheKey)
        : [],
    shouldWrite: true,
  }
}

export function planCatalogVersionPrune(
  processed: readonly ProcessedVersionMetadata[],
  currentVersions: ReadonlyMap<string, number>,
): readonly string[] {
  return processed
    .filter((record) => {
      const currentVersion = currentVersions.get(record.id)
      return currentVersion !== undefined && record.version < currentVersion && !record.pinned
    })
    .map((record) => record.cacheKey)
}

export function isCurrentProcessedVersion(
  record: Pick<ProcessedVersionMetadata, "id" | "version">,
  catalogVersion: number | undefined,
): boolean {
  return catalogVersion === undefined || record.version === catalogVersion
}
