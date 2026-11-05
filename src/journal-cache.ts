import { selectActiveMealSnapshots, type ConfirmedMealSnapshot, type JournalDayDraft } from './domain/nutrition/journal.ts'
import type { FoodNutritionSnapshot } from './domain/nutrition/recipes.ts'

export type PendingJournalConfirm = {
  readonly mealId: string
  readonly snapshotId: string
  readonly confirmedAt: string
  readonly engineVersion: string
}
export type PendingJournalCancel = {
  readonly snapshotId: string
  readonly newSnapshotId: string
  readonly confirmedAt: string
  readonly engineVersion: string
}
export type JournalCacheRecord = {
  readonly version: 1
  readonly day: JournalDayDraft | null
  readonly snapshots: readonly ConfirmedMealSnapshot[]
  readonly sources: Readonly<Record<string, FoodNutritionSnapshot>>
  readonly serverRevision: number
  readonly dirty: boolean
  readonly pendingConfirm: PendingJournalConfirm | null
  readonly pendingCancels: readonly PendingJournalCancel[]
  readonly photoDataUrl: string | null
  readonly conflict: boolean
}

export type JournalStorage = Pick<Storage, 'getItem' | 'setItem'>

export function journalCacheKey(userId: string, localDate: string): string {
  return `nutrip-journal-v1:${userId}:${localDate}`
}

export function emptyJournalCache(): JournalCacheRecord {
  return { version: 1, day: null, snapshots: [], sources: {}, serverRevision: 0, dirty: false,
    pendingConfirm: null, pendingCancels: [], photoDataUrl: null, conflict: false }
}

export function readJournalCache(storage: JournalStorage, key: string): JournalCacheRecord | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? 'null')
    if (!isRecord(value) || value.version !== 1 || !Number.isSafeInteger(value.serverRevision)
      || (value.serverRevision as number) < 0 || typeof value.dirty !== 'boolean'
      || !Array.isArray(value.snapshots) || !isRecord(value.sources) || !Array.isArray(value.pendingCancels)
      || !(value.day === null || isRecord(value.day))
      || !(value.pendingConfirm === null || isRecord(value.pendingConfirm))) return null
    return value as unknown as JournalCacheRecord
  } catch { return null }
}

export function writeJournalCache(storage: JournalStorage, key: string, value: JournalCacheRecord): boolean {
  try { storage.setItem(key, JSON.stringify(value)); return true } catch { return false }
}

export function archiveJournalCache(storage: JournalStorage, key: string, value: JournalCacheRecord, suffix: string): boolean {
  if (!/^[0-9a-z-]{1,48}$/i.test(suffix)) return false
  return writeJournalCache(storage, `${key}:conflict-copy:${suffix}`, value)
}

/** The latest server-confirmed draft always wins after a revision conflict. */
export function resolveJournalCacheConflict(
  local: JournalCacheRecord,
  server: { readonly day: JournalDayDraft; readonly snapshots: readonly ConfirmedMealSnapshot[] } | null,
): JournalCacheRecord {
  const serverDay = server?.day ?? null
  const localConfirmation = local.pendingConfirm
  const localMeal = localConfirmation && local.day?.meals.find((meal) => meal.id === localConfirmation.mealId)
  const serverMeal = localConfirmation && serverDay?.meals.find((meal) => meal.id === localConfirmation.mealId)
  const pendingConfirm = localConfirmation && localMeal && serverMeal
    && JSON.stringify(serverMeal) === JSON.stringify(localMeal) ? localConfirmation : null
  const snapshots = server?.snapshots ?? []
  const snapshotIds = new Set(snapshots.map((snapshot) => snapshot.snapshotId))
  const activeSnapshotIds = new Set(selectActiveMealSnapshots(snapshots).map((snapshot) => snapshot.snapshotId))
  const pendingCancels = local.pendingCancels.filter((pending) => !snapshotIds.has(pending.newSnapshotId)
    && activeSnapshotIds.has(pending.snapshotId))

  return {
    ...emptyJournalCache(),
    day: serverDay,
    snapshots: server?.snapshots ?? [],
    sources: local.sources,
    serverRevision: serverDay?.revision ?? 0,
    pendingConfirm,
    pendingCancels,
    photoDataUrl: local.photoDataUrl,
  }
}

/** Persist an async result under its originating date, never in another date's view. */
export function persistJournalCacheForKey(
  storage: JournalStorage,
  requestKey: string,
  activeKey: string,
  value: JournalCacheRecord,
): { readonly persisted: boolean; readonly updateActiveView: boolean } {
  return { persisted: writeJournalCache(storage, requestKey, value), updateActiveView: requestKey === activeKey }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
