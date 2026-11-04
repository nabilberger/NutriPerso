import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createJournalDay, createJournalState, createMeal, addFoodJournalItem, confirmMeal, createMealCorrectionDraft, setFoodJournalItemQuantity } from '../../src/domain/nutrition/journal.ts'
import type { FoodNutritionSnapshot } from '../../src/domain/nutrition/recipes.ts'
import { calculatePersistedJournalDay, cancelJournalMeal, confirmJournalMeal, getActiveJournalSnapshots, getJournalPersistence, JournalPersistenceError, saveJournalDayDraft } from '../src/supabase-journal.ts'

const dayId = 'a2d42001-436f-4ac6-9a1a-d231a8eb0001'
const scope = { userId: '2fa33744-d81b-4403-9482-e6a7af550001' }
const otherScope = { userId: '2fa33744-d81b-4403-9482-e6a7af550002' }
const env = { SUPABASE_URL: 'https://nutrip.persotest.invalid', SUPABASE_SECRET_KEY: 'secret-test-only' }
const source: FoodNutritionSnapshot = {
  foodId: 'food-1', sourceType: 'usda', fdcId: 12345, description: 'Oats', category: null, dataType: 'Foundation',
  brandOwner: null, sourceName: 'USDA', sourceReference: 'FDC:12345', sourceNotes: null,
  nutrients: [{ status: 'reported', code: 'protein', sourceValue: '1', sourceUnit: 'g',
    basis: { amount: '3', unit: 'g', source: 'fdc_data_type' },
    source: { sourceType: 'usda', sourceName: 'USDA', sourceReference: 'FDC:12345', nutrientSourceId: 1003 } }],
  portionEquivalences: [], edibleYieldConversions: [],
}

function mockApi() {
  const days = new Map<string, Record<string, unknown>>()
  const snapshots: Record<string, unknown>[] = []
  const calls: Array<{ url: URL; init: RequestInit }> = []
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    calls.push({ url, init })
    assert.equal(new Headers(init.headers).get('apikey'), env.SUPABASE_SECRET_KEY)
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${env.SUPABASE_SECRET_KEY}`)
    if (url.pathname.endsWith('/rpc/save_journal_day_draft')) {
      const body = JSON.parse(String(init.body)) as { p_user_id: string; p_day_id: string; p_expected_revision: number; p_draft: Record<string, unknown> }
      const current = days.get(body.p_day_id)
      if (!current) {
        if (body.p_expected_revision !== 0 || body.p_draft.revision !== 1) return conflict()
        const row = { id: body.p_day_id, user_id: body.p_user_id, revision: 1, draft: body.p_draft }
        days.set(body.p_day_id, row)
        return Response.json([row])
      }
      if (current.user_id !== body.p_user_id) return conflict()
      const currentDraft = current.draft as Record<string, unknown>
      if (current.revision === body.p_expected_revision + 1 && JSON.stringify(currentDraft) === JSON.stringify(body.p_draft)) return Response.json([current])
      if (current.revision !== body.p_expected_revision || body.p_draft.revision !== body.p_expected_revision + 1) return conflict()
      const row = { id: body.p_day_id, user_id: body.p_user_id, revision: body.p_draft.revision, draft: body.p_draft }
      days.set(body.p_day_id, row)
      return Response.json([row])
    }
    if (url.pathname.endsWith('/rpc/append_journal_snapshot')) {
      const body = JSON.parse(String(init.body)) as { p_user_id: string; p_day_id: string; p_expected_day_revision: number; p_expected_draft: Record<string, unknown>; p_next_draft: Record<string, unknown>; p_snapshot: Record<string, unknown> }
      const existing = snapshots.find((row) => row.user_id === body.p_user_id && row.snapshot_id === body.p_snapshot.snapshotId)
      if (existing) return JSON.stringify(existing.snapshot) === JSON.stringify(body.p_snapshot) ? Response.json([existing]) : conflict()
      const day = days.get(body.p_day_id)
      if (!day || day.user_id !== body.p_user_id || day.revision !== body.p_expected_day_revision || JSON.stringify(day.draft) !== JSON.stringify(body.p_expected_draft)) return conflict()
      const predecessor = body.p_snapshot.supersedesSnapshotId
      if (snapshots.some((row) => row.user_id === body.p_user_id && row.logical_meal_id === body.p_snapshot.logicalMealId && row.predecessor_snapshot_id === predecessor)) return conflict()
      const row = { snapshot_id: body.p_snapshot.snapshotId, user_id: body.p_user_id, logical_meal_id: body.p_snapshot.logicalMealId,
        predecessor_snapshot_id: predecessor, snapshot: body.p_snapshot }
      snapshots.push(row)
      if (body.p_snapshot.status !== 'void') days.set(body.p_day_id, { ...day, revision: body.p_next_draft.revision, draft: body.p_next_draft })
      return Response.json([{ ...row, snapshot: sortKeys(row.snapshot) }])
    }
    if (url.pathname.endsWith('/journal_days')) {
      const id = url.searchParams.get('id')?.replace(/^eq\./, '')
      const userId = url.searchParams.get('user_id')?.replace(/^eq\./, '')
      return Response.json([...days.values()].filter((row) => (!id || row.id === id) && (!userId || row.user_id === userId)).map(({ draft, user_id }) => ({ draft, user_id })))
    }
    if (url.pathname.endsWith('/journal_meal_snapshots')) {
      const userId = url.searchParams.get('user_id')?.replace(/^eq\./, '')
      return Response.json(snapshots.filter((row) => !userId || row.user_id === userId))
    }
    return Response.json({ message: 'unexpected' }, { status: 404 })
  }
  return { days, snapshots, calls, fetcher }
}

function conflict(): Response { return Response.json({ code: '40001', message: 'JOURNAL_REVISION_CONFLICT' }, { status: 409 }) }

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, sortKeys(nested)]))
}

function draftState() {
  let state = createJournalDay(createJournalState(), { id: dayId, localDate: '2026-11-04', timeZone: 'UTC' })
  state = createMeal(state, dayId, { id: 'meal-1', kind: 'lunch' })
  return addFoodJournalItem(state, dayId, 'meal-1', {
    id: 'item-1', foodId: source.foodId,
    quantity: { kind: 'physical', amount: '1', unit: 'g', weightNature: 'edible' }, sortOrder: 0,
  })
}

async function persistInitialAndDraft(mock: ReturnType<typeof mockApi>) {
  const empty = createJournalDay(createJournalState(), { id: dayId, localDate: '2026-11-04', timeZone: 'UTC' }).days[0]!
  await saveJournalDayDraft(env, scope, empty, 0, mock.fetcher)
  const withMeal = createMeal({ days: [empty], snapshots: [] }, dayId, { id: 'meal-1', kind: 'lunch' }).days[0]!
  await saveJournalDayDraft(env, scope, withMeal, empty.revision, mock.fetcher)
  const state = draftState()
  await saveJournalDayDraft(env, scope, state.days[0]!, withMeal.revision, mock.fetcher)
  return state
}

test('day draft save enforces initial revision one, exact JSON values, and idempotent retries', async () => {
  const mock = mockApi()
  const day = createJournalDay(createJournalState(), { id: dayId, localDate: '2026-11-04', timeZone: 'UTC' }).days[0]!
  await assert.rejects(saveJournalDayDraft(env, scope, day, 1, mock.fetcher), { code: 'INVALID_JOURNAL' })
  const saved = await saveJournalDayDraft(env, scope, day, 0, mock.fetcher)
  assert.deepEqual(saved, day)
  assert.deepEqual(await saveJournalDayDraft(env, scope, day, 0, mock.fetcher), day)
  assert.equal(mock.days.size, 1)
  const state = draftState()
  const revisionBody = JSON.parse(String(mock.calls[0]?.init.body)) as { p_draft: { revision: number } }
  assert.equal(revisionBody.p_draft.revision, 1)
  assert.ok(state.days[0]!.revision > 1)
})

test('server confirmation recalculates with the domain engine and stores an autonomous exact snapshot', async () => {
  const mock = mockApi()
  const state = await persistInitialAndDraft(mock)
  const day = state.days[0]!
  const result = await confirmJournalMeal(env, scope, dayId, 'meal-1', { foods: new Map([[source.foodId, source]]) }, {
    snapshotId: 'meal-snapshot-1', confirmedAt: '2026-11-04T12:00:00.000Z', engineVersion: 'nutrition-engine-v1',
  }, mock.fetcher)
  assert.equal(result.snapshot.status, 'confirmed')
  assert.equal(result.snapshot.totals.protein?.status, 'complete')
  if (result.snapshot.totals.protein?.status === 'complete') assert.deepEqual(result.snapshot.totals.protein.exactValue, { numerator: '1', denominator: '3' })
  assert.equal(result.snapshot.items[0]?.kind === 'food' && result.snapshot.items[0].foodSnapshot.description, 'Oats')
  assert.equal(result.day.meals.length, 0)
  assert.equal(mock.snapshots.length, 1)
  assert.equal((await calculatePersistedJournalDay(env, scope, dayId, mock.fetcher)).protein?.status, 'complete')
  const rpc = mock.calls.find(({ url }) => url.pathname.endsWith('/rpc/append_journal_snapshot'))
  assert.ok(rpc)
  assert.deepEqual((await confirmJournalMeal(env, scope, dayId, 'meal-1', { foods: new Map() }, {
    snapshotId: 'meal-snapshot-1', confirmedAt: '2026-11-04T12:00:00.000Z', engineVersion: 'nutrition-engine-v1',
  }, mock.fetcher)).snapshot, result.snapshot)
})

test('corrections append one successor and preserve the autonomous predecessor snapshot', async () => {
  const mock = mockApi()
  const state = await persistInitialAndDraft(mock)
  const first = await confirmJournalMeal(env, scope, dayId, 'meal-1', { foods: new Map([[source.foodId, source]]) }, {
    snapshotId: 'meal-snapshot-1', confirmedAt: '2026-11-04T12:00:00.000Z', engineVersion: 'nutrition-engine-v1',
  }, mock.fetcher)
  const confirmedState = confirmMeal(state, dayId, 'meal-1', { foods: new Map([[source.foodId, source]]) }, {
    snapshotId: 'meal-snapshot-1', confirmedAt: '2026-11-04T12:00:00.000Z', engineVersion: 'nutrition-engine-v1',
  }).state
  let correction = createMealCorrectionDraft(confirmedState, 'meal-snapshot-1')
  const previousDayRevision = confirmedState.days[0]!.revision
  await saveJournalDayDraft(env, scope, correction.days[0]!, previousDayRevision, mock.fetcher)
  correction = setFoodJournalItemQuantity(correction, dayId, 'meal-1', 'item-1', {
    kind: 'physical', amount: '2', unit: 'g', weightNature: 'edible',
  })
  await saveJournalDayDraft(env, scope, correction.days[0]!, previousDayRevision + 1, mock.fetcher)
  const second = await confirmJournalMeal(env, scope, dayId, 'meal-1', { foods: new Map() }, {
    snapshotId: 'meal-snapshot-2', confirmedAt: '2026-11-04T13:00:00.000Z', engineVersion: 'nutrition-engine-v1',
  }, mock.fetcher)
  assert.equal(second.snapshot.supersedesSnapshotId, first.snapshot.snapshotId)
  assert.equal(second.snapshot.revision, first.snapshot.revision + 1)
  assert.equal(second.snapshot.items[0]?.kind === 'food' && second.snapshot.items[0].foodSnapshot.sourceReference, 'FDC:12345')
  assert.equal(mock.snapshots.length, 2)
  assert.deepEqual((await getActiveJournalSnapshots(env, scope, mock.fetcher)).map(({ snapshotId }) => snapshotId), ['meal-snapshot-2'])
})

test('stale day revisions conflict and active statistics exclude void successors', async () => {
  const mock = mockApi()
  const state = await persistInitialAndDraft(mock)
  const confirmed = confirmMeal(state, dayId, 'meal-1', { foods: new Map([[source.foodId, source]]) }, {
    snapshotId: 'meal-snapshot-1', confirmedAt: '2026-11-04T12:00:00.000Z', engineVersion: 'nutrition-engine-v1',
  })
  await confirmJournalMeal(env, scope, dayId, 'meal-1', { foods: new Map([[source.foodId, source]]) }, {
    snapshotId: 'meal-snapshot-1', confirmedAt: '2026-11-04T12:00:00.000Z', engineVersion: 'nutrition-engine-v1',
  }, mock.fetcher)
  await assert.rejects(confirmJournalMeal(env, scope, dayId, 'meal-1', { foods: new Map([[source.foodId, source]]) }, {
    snapshotId: 'another-snapshot', confirmedAt: '2026-11-04T13:00:00.000Z', engineVersion: 'nutrition-engine-v1',
  }, mock.fetcher), (error: unknown) => error instanceof JournalPersistenceError && error.code === 'REVISION_CONFLICT')

  const cancelled = await cancelJournalMeal(env, scope, 'meal-snapshot-1', {
    newSnapshotId: 'meal-snapshot-void', confirmedAt: '2026-11-04T14:00:00.000Z', engineVersion: 'nutrition-engine-v1',
  }, mock.fetcher)
  assert.equal(cancelled.status, 'void')
  assert.deepEqual(await cancelJournalMeal(env, scope, 'meal-snapshot-1', {
    newSnapshotId: 'meal-snapshot-void', confirmedAt: '2026-11-04T14:00:00.000Z', engineVersion: 'nutrition-engine-v1',
  }, mock.fetcher), cancelled)
  assert.deepEqual(await getActiveJournalSnapshots(env, scope, mock.fetcher), [])
  const totals = await calculatePersistedJournalDay(env, scope, dayId, mock.fetcher)
  assert.equal(totals.protein?.status, 'unknown')
  if (totals.protein?.status === 'unknown') assert.equal(totals.protein.missing[0]?.reason, 'no-contributions')
  assert.equal(mock.snapshots.length, 2)
})

test('journal drafts, snapshots, confirmation and cancellation are isolated between users', async () => {
  const mock = mockApi()
  await persistInitialAndDraft(mock)
  const confirmed = await confirmJournalMeal(env, scope, dayId, 'meal-1', { foods: new Map([[source.foodId, source]]) }, {
    snapshotId: 'meal-snapshot-owner-a', confirmedAt: '2026-11-04T12:00:00.000Z', engineVersion: 'nutrition-engine-v1',
  }, mock.fetcher)
  assert.equal(confirmed.snapshot.status, 'confirmed')

  assert.equal(await getJournalPersistence(env, otherScope, dayId, mock.fetcher), null)
  assert.deepEqual(await getActiveJournalSnapshots(env, otherScope, mock.fetcher), [])
  await assert.rejects(confirmJournalMeal(env, otherScope, dayId, 'meal-1', { foods: new Map([[source.foodId, source]]) }, {
    snapshotId: 'meal-snapshot-owner-b', confirmedAt: '2026-11-04T13:00:00.000Z', engineVersion: 'nutrition-engine-v1',
  }, mock.fetcher), { code: 'INVALID_JOURNAL' })
  await assert.rejects(cancelJournalMeal(env, otherScope, 'meal-snapshot-owner-a', {
    newSnapshotId: 'void-owner-b', confirmedAt: '2026-11-04T14:00:00.000Z', engineVersion: 'nutrition-engine-v1',
  }, mock.fetcher), { code: 'INVALID_JOURNAL' })
  const foreignClaim = createJournalDay(createJournalState(), { id: dayId, localDate: '2026-11-04', timeZone: 'UTC' }).days[0]!
  await assert.rejects(saveJournalDayDraft(env, otherScope, foreignClaim, 0, mock.fetcher), { code: 'REVISION_CONFLICT' })

  const ownerA = await getJournalPersistence(env, scope, dayId, mock.fetcher)
  assert.ok(ownerA)
  assert.equal(ownerA.snapshots.length, 1)
  assert.equal(mock.snapshots.length, 1)
  assert.ok(mock.calls.filter(({ url }) => url.pathname.endsWith('/journal_days') || url.pathname.endsWith('/journal_meal_snapshots'))
    .every(({ url }) => url.searchParams.get('user_id') === `eq.${scope.userId}` || url.searchParams.get('user_id') === `eq.${otherScope.userId}`))
})
