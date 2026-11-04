/** Server-only persistence for journal drafts and immutable meal history. */
import {
  cancelConfirmedMeal,
  calculateJournalDay,
  confirmMeal,
  selectActiveMealSnapshots,
  type ConfirmedMealSnapshot,
  type JournalCalculationSources,
  type JournalDayDraft,
  type JournalState,
} from '../../src/domain/nutrition/journal.ts'
import { parseDecimal } from '../../src/domain/nutrition/decimal.ts'
import type { SupabaseCatalogEnv } from './supabase-catalog.ts'

export type JournalPersistenceEnv = SupabaseCatalogEnv
/** Construct only from the subject of a Worker-validated Supabase Auth JWT. */
export type JournalUserScope = { readonly userId: string }
export type JournalPersistenceErrorCode = 'CONFIGURATION' | 'INVALID_JOURNAL' | 'REVISION_CONFLICT' | 'REMOTE_ERROR'

export class JournalPersistenceError extends Error {
  readonly code: JournalPersistenceErrorCode
  constructor(code: JournalPersistenceErrorCode, message: string) {
    super(message)
    this.name = 'JournalPersistenceError'
    this.code = code
  }
}

export type PersistedJournal = { readonly day: JournalDayDraft; readonly snapshots: readonly ConfirmedMealSnapshot[] }

/** Saves a whole day atomically; expectedRevision is 0 on first save and retries are content-idempotent. */
export async function saveJournalDayDraft(
  env: JournalPersistenceEnv, scope: JournalUserScope, draft: JournalDayDraft, expectedRevision: number, fetcher: typeof fetch = fetch,
): Promise<JournalDayDraft> {
  assertUserId(scope.userId)
  assertDay(draft)
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || draft.revision !== expectedRevision + 1) {
    throw new JournalPersistenceError('INVALID_JOURNAL', 'La révision du brouillon ne correspond pas à la révision attendue.')
  }
  const rows = await rpc<unknown[]>(env, 'save_journal_day_draft', {
    p_user_id: scope.userId, p_day_id: draft.id, p_expected_revision: expectedRevision, p_draft: draft,
  }, fetcher)
  if (!Array.isArray(rows) || !isRecord(rows[0]) || rows[0].user_id !== scope.userId) throw new JournalPersistenceError('REMOTE_ERROR', 'Supabase n’a pas retourné la journée enregistrée pour cet utilisateur.')
  return parseDay(rows[0].draft)
}

/** Recalculates from the persisted domain draft; `sources` must be resolved in Worker code, never copied from client totals. */
export async function confirmJournalMeal(
  env: JournalPersistenceEnv,
  scope: JournalUserScope,
  dayId: string,
  mealId: string,
  sources: JournalCalculationSources,
  input: { readonly snapshotId: string; readonly confirmedAt: string; readonly engineVersion: string },
  fetcher: typeof fetch = fetch,
): Promise<{ readonly day: JournalDayDraft; readonly snapshot: ConfirmedMealSnapshot }> {
  assertUserId(scope.userId)
  const persisted = await getJournalPersistence(env, scope, dayId, fetcher)
  if (!persisted) throw new JournalPersistenceError('INVALID_JOURNAL', 'Brouillon de journée introuvable.')
  const retry = persisted.snapshots.find((snapshot) => snapshot.snapshotId === input.snapshotId)
  if (retry) {
    if (retry.logicalMealId !== mealId || retry.dayId !== dayId || retry.status !== 'confirmed') {
      throw new JournalPersistenceError('REVISION_CONFLICT', 'Cet identifiant d’opération est déjà utilisé par un autre snapshot.')
    }
    return { day: persisted.day, snapshot: retry }
  }
  if (!persisted.day.meals.some((meal) => meal.id === mealId)) {
    throw new JournalPersistenceError('REVISION_CONFLICT', 'Le brouillon a été confirmé ou modifié depuis sa dernière lecture.')
  }
  const state: JournalState = { days: [persisted.day], snapshots: persisted.snapshots }
  const result = confirmMeal(state, dayId, mealId, sources, input)
  const previous = state.days.find((day) => day.id === dayId)
  const next = result.state.days.find((day) => day.id === dayId)
  if (!previous || !next) throw new JournalPersistenceError('INVALID_JOURNAL', 'Journée du repas introuvable.')
  await appendSnapshot(env, scope, previous, next, result.snapshot, fetcher)
  return { day: next, snapshot: result.snapshot }
}

/** Appends a void version without deleting its predecessor or counting it as active nutrition. */
export async function cancelJournalMeal(
  env: JournalPersistenceEnv,
  scope: JournalUserScope,
  snapshotId: string,
  input: { readonly newSnapshotId: string; readonly confirmedAt: string; readonly engineVersion: string },
  fetcher: typeof fetch = fetch,
): Promise<ConfirmedMealSnapshot> {
  assertUserId(scope.userId)
  const snapshots = await readSnapshotHistory(env, scope, fetcher)
  const retry = snapshots.find((snapshot) => snapshot.snapshotId === input.newSnapshotId)
  if (retry) {
    if (retry.status === 'void' && retry.supersedesSnapshotId === snapshotId) return retry
    throw new JournalPersistenceError('REVISION_CONFLICT', 'Cet identifiant d’opération est déjà utilisé par un autre snapshot.')
  }
  const target = snapshots.find((snapshot) => snapshot.snapshotId === snapshotId)
  if (!target) throw new JournalPersistenceError('INVALID_JOURNAL', 'Snapshot de repas introuvable.')
  const persisted = await getJournalPersistence(env, scope, target.dayId, fetcher)
  if (!persisted) throw new JournalPersistenceError('INVALID_JOURNAL', 'Journée du repas introuvable.')
  const state: JournalState = { days: [persisted.day], snapshots }
  const result = cancelConfirmedMeal(state, snapshotId, input)
  const day = state.days.find((candidate) => candidate.id === result.snapshot.dayId)
  if (!day) throw new JournalPersistenceError('INVALID_JOURNAL', 'Journée du repas introuvable.')
  await appendSnapshot(env, scope, day, day, result.snapshot, fetcher)
  return result.snapshot
}

/** Loads stored drafts and snapshots verbatim; no current catalogue data is consulted. */
export async function getJournalPersistence(
  env: JournalPersistenceEnv, scope: JournalUserScope, dayId: string, fetcher: typeof fetch = fetch,
): Promise<PersistedJournal | null> {
  assertUserId(scope.userId)
  assertUuid(dayId)
  const dayUrl = restUrl(env, 'journal_days')
  dayUrl.searchParams.set('select', 'user_id,draft')
  dayUrl.searchParams.set('id', `eq.${dayId}`)
  dayUrl.searchParams.set('user_id', `eq.${scope.userId}`)
  const rows = await requestJson<unknown[]>(dayUrl, env, fetcher)
  if (!Array.isArray(rows)) throw new JournalPersistenceError('REMOTE_ERROR', 'La réponse de journée Supabase est invalide.')
  if (!rows.length) return null
  if (!isRecord(rows[0]) || rows[0].user_id !== scope.userId) throw new JournalPersistenceError('REMOTE_ERROR', 'La journée Supabase n’appartient pas à cet utilisateur.')
  const day = parseDay(rows[0].draft)
  const snapshots = await readSnapshotHistory(env, scope, fetcher)
  return { day, snapshots }
}

/** Selects the active confirmed heads; void and superseded versions remain historical only. */
export async function getActiveJournalSnapshots(env: JournalPersistenceEnv, scope: JournalUserScope, fetcher: typeof fetch = fetch): Promise<readonly ConfirmedMealSnapshot[]> {
  assertUserId(scope.userId)
  const snapshots = await readSnapshotHistory(env, scope, fetcher)
  // Domain selection validates chain shape and excludes void/superseded snapshots.
  return selectActiveMealSnapshots(snapshots)
}

/** Calculates persisted day totals only from active snapshots using the domain aggregator. */
export async function calculatePersistedJournalDay(
  env: JournalPersistenceEnv, scope: JournalUserScope, dayId: string, fetcher: typeof fetch = fetch,
) {
  const persisted = await getJournalPersistence(env, scope, dayId, fetcher)
  if (!persisted) throw new JournalPersistenceError('INVALID_JOURNAL', 'Journée introuvable.')
  return calculateJournalDay({ days: [persisted.day], snapshots: persisted.snapshots }, dayId)
}

async function readSnapshotHistory(env: JournalPersistenceEnv, scope: JournalUserScope, fetcher: typeof fetch): Promise<ConfirmedMealSnapshot[]> {
  assertUserId(scope.userId)
  const url = restUrl(env, 'journal_meal_snapshots')
  url.searchParams.set('select', 'user_id,snapshot')
  url.searchParams.set('order', 'created_at.asc')
  url.searchParams.set('user_id', `eq.${scope.userId}`)
  const rows = await readAllRows(url, env, fetcher)
  return rows.map((row) => {
    if (!isRecord(row) || row.user_id !== scope.userId) throw new JournalPersistenceError('REMOTE_ERROR', 'Un snapshot Supabase est invalide ou appartient à un autre utilisateur.')
    assertSnapshot(row.snapshot)
    return row.snapshot
  })
}

async function appendSnapshot(
  env: JournalPersistenceEnv, scope: JournalUserScope, previous: JournalDayDraft, next: JournalDayDraft,
  snapshot: ConfirmedMealSnapshot, fetcher: typeof fetch,
): Promise<void> {
  assertUserId(scope.userId)
  assertSnapshot(snapshot)
  const rows = await rpc<unknown[]>(env, 'append_journal_snapshot', {
    p_user_id: scope.userId, p_day_id: previous.id, p_expected_day_revision: previous.revision,
    p_expected_draft: previous, p_next_draft: next, p_snapshot: snapshot,
  }, fetcher)
  if (!Array.isArray(rows) || !isRecord(rows[0]) || rows[0].user_id !== scope.userId) throw new JournalPersistenceError('REMOTE_ERROR', 'Supabase n’a pas retourné le snapshot enregistré pour cet utilisateur.')
  assertSnapshot(rows[0].snapshot)
  if (!jsonEqual(rows[0].snapshot, snapshot)) {
    throw new JournalPersistenceError('REMOTE_ERROR', 'Supabase a retourné un snapshot différent de celui calculé.')
  }
}

function assertDay(value: unknown): asserts value is JournalDayDraft {
  if (!isRecord(value) || !isUuid(value.id) || typeof value.localDate !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.localDate) || typeof value.timeZone !== 'string' || !value.timeZone.trim()
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 || !Array.isArray(value.meals)) {
    throw new JournalPersistenceError('INVALID_JOURNAL', 'Le brouillon de journée est invalide.')
  }
  const meals = new Set<string>()
  for (const meal of value.meals) {
    if (!isRecord(meal) || typeof meal.id !== 'string' || !meal.id.trim() || meals.has(meal.id)
      || meal.dayId !== value.id || !Number.isSafeInteger(meal.revision) || (meal.revision as number) < 1
      || !['breakfast', 'lunch', 'dinner', 'snack', 'custom'].includes(String(meal.kind))
      || !(meal.label === null || typeof meal.label === 'string')
      || !(meal.occurredAt === null || typeof meal.occurredAt === 'string')
      || !Number.isSafeInteger(meal.sortOrder) || !Array.isArray(meal.items)) {
      throw new JournalPersistenceError('INVALID_JOURNAL', 'Un brouillon de repas est invalide.')
    }
    meals.add(meal.id)
    const itemIds = new Set<string>()
    for (const item of meal.items) {
      if (!isRecord(item) || typeof item.id !== 'string' || !item.id.trim() || itemIds.has(item.id)
        || !Number.isSafeInteger(item.sortOrder)) {
        throw new JournalPersistenceError('INVALID_JOURNAL', 'Un élément de repas est invalide ou dupliqué.')
      }
      itemIds.add(item.id)
      if (item.kind === 'food') {
        if (typeof item.foodId !== 'string' || !item.foodId.trim() || !isRecord(item.quantity) || typeof item.quantity.amount !== 'string') {
          throw new JournalPersistenceError('INVALID_JOURNAL', 'La référence ou quantité d’aliment est invalide.')
        }
      } else if (item.kind === 'recipe') {
        if (!isRecord(item.recipeSnapshot) || item.recipeSnapshot.schemaVersion !== '1'
          || typeof item.recipeSnapshot.snapshotId !== 'string' || !isRecord(item.quantity) || typeof item.quantity.amount !== 'string') {
          throw new JournalPersistenceError('INVALID_JOURNAL', 'La référence ou quantité de recette est invalide.')
        }
      } else {
        throw new JournalPersistenceError('INVALID_JOURNAL', 'Le type d’élément du repas est invalide.')
      }
    }
  }
  assertJsonExact(value)
}

function parseDay(value: unknown): JournalDayDraft { assertDay(value); return value }

function assertSnapshot(value: unknown): asserts value is ConfirmedMealSnapshot {
  if (!isRecord(value) || typeof value.snapshotId !== 'string' || !value.snapshotId.trim()
    || typeof value.logicalMealId !== 'string' || !value.logicalMealId.trim()
    || !isUuid(value.dayId) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1
    || !Number.isSafeInteger(value.mealRevision) || !Number.isSafeInteger(value.dayRevision)
    || !Array.isArray(value.items) || !['confirmed', 'void'].includes(String(value.status))
    || typeof value.engineVersion !== 'string' || !value.engineVersion.trim()
    || typeof value.confirmedAt !== 'string' || !Number.isFinite(Date.parse(value.confirmedAt))) {
    throw new JournalPersistenceError('INVALID_JOURNAL', 'Le snapshot de repas est invalide.')
  }
  if (value.status === 'void' && (value.items.length !== 0 || !Array.isArray(value.totals))) {
    throw new JournalPersistenceError('INVALID_JOURNAL', 'Le snapshot d’annulation est invalide.')
  }
  assertJsonExact(value)
}

function assertJsonExact(value: unknown): void {
  if (typeof value === 'bigint' || typeof value === 'undefined' || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new JournalPersistenceError('INVALID_JOURNAL', 'Le document contient une valeur non sérialisable en JSON.')
  }
  if (Array.isArray(value)) { value.forEach(assertJsonExact); return }
  if (!isRecord(value)) return
  for (const [key, nested] of Object.entries(value)) {
    if (/^(?:exact|edible)?(?:numerator|denominator)$/i.test(key) && nested !== null) {
      if (typeof nested !== 'string' || !/^-?(?:0|[1-9]\d*)$/.test(nested) || (/denominator$/i.test(key) && BigInt(nested) <= 0n)) {
        throw new JournalPersistenceError('INVALID_JOURNAL', 'Les fractions doivent être des chaînes entières exactes.')
      }
    }
    if (['sourceValue', 'amount', 'knownSubtotal', 'value'].includes(key) && nested !== null) {
      if (typeof nested !== 'string') throw new JournalPersistenceError('INVALID_JOURNAL', `Le champ ${key} doit être une chaîne décimale.`)
      try { parseDecimal(nested) } catch { throw new JournalPersistenceError('INVALID_JOURNAL', `Le champ ${key} est un décimal invalide.`) }
    }
    assertJsonExact(nested)
  }
}

async function rpc<T>(env: JournalPersistenceEnv, name: string, body: Record<string, unknown>, fetcher: typeof fetch): Promise<T> {
  return requestJson<T>(restUrl(env, `rpc/${name}`), env, fetcher, {
    method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body),
  })
}

async function readAllRows(url: URL, env: JournalPersistenceEnv, fetcher: typeof fetch): Promise<unknown[]> {
  const result: unknown[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const page = await requestJson<unknown[]>(url, env, fetcher, {
      headers: { 'Range-Unit': 'items', Range: `${offset}-${offset + pageSize - 1}` },
    })
    if (!Array.isArray(page)) throw new JournalPersistenceError('REMOTE_ERROR', 'L’historique Supabase est invalide.')
    result.push(...page)
    if (page.length < pageSize) return result
  }
}

async function requestJson<T>(url: URL, env: JournalPersistenceEnv, fetcher: typeof fetch, init: RequestInit = {}): Promise<T> {
  const secret = env.SUPABASE_SECRET_KEY?.trim()
  if (!secret) throw new JournalPersistenceError('CONFIGURATION', 'La configuration Supabase du Worker est absente.')
  let response: Response
  try {
    response = await fetcher(url, { ...init, headers: {
      apikey: secret, Authorization: `Bearer ${secret}`, accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers,
    } })
  } catch { throw new JournalPersistenceError('REMOTE_ERROR', 'Supabase est temporairement inaccessible.') }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (response.status === 409 || /JOURNAL_(?:REVISION|HISTORY|DRAFT_SNAPSHOT|SNAPSHOT_ID)_CONFLICT|JOURNAL_DRAFT_SNAPSHOT_MISMATCH/.test(detail)) {
      throw new JournalPersistenceError('REVISION_CONFLICT', 'Le journal a changé depuis sa dernière lecture; rechargez-le avant de réessayer.')
    }
    throw new JournalPersistenceError('REMOTE_ERROR', `Supabase a refusé la requête (HTTP ${response.status}).`)
  }
  try { return await response.json() as T } catch { throw new JournalPersistenceError('REMOTE_ERROR', 'Supabase a retourné une réponse invalide.') }
}

function restUrl(env: JournalPersistenceEnv, path: string): URL {
  if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_SECRET_KEY?.trim()) throw new JournalPersistenceError('CONFIGURATION', 'La configuration Supabase du Worker est absente.')
  let url: URL
  try { url = new URL(env.SUPABASE_URL.trim()) } catch { throw new JournalPersistenceError('CONFIGURATION', 'SUPABASE_URL est invalide.') }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new JournalPersistenceError('CONFIGURATION', 'SUPABASE_URL doit utiliser HTTPS.')
  url.pathname = `${url.pathname.replace(/\/$/, '')}/rest/v1/${path}`
  return url
}

function assertUserId(value: string): void { if (!isUuid(value)) throw new JournalPersistenceError('INVALID_JOURNAL', 'L’utilisateur authentifié est requis.') }
function assertUuid(value: string): void { if (!isUuid(value)) throw new JournalPersistenceError('INVALID_JOURNAL', 'L’identifiant de journée doit être un UUID.') }
function isUuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]))
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(left[key], right[key]))
  }
  return false
}
