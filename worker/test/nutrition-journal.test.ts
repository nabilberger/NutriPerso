import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addFoodJournalItem,
  addRecipeJournalItem,
  calculateJournalDay,
  calculateJournalDayPreview,
  calculateJournalMeal,
  cancelConfirmedMeal,
  confirmMeal,
  createJournalDay,
  createJournalState,
  createMeal,
  createMealCorrectionDraft,
  removeJournalItem,
  removeMealDraft,
  selectActiveMealSnapshots,
  setFoodJournalItemQuantity,
  updateMealDetails,
  validateSnapshotHistory,
} from '../../src/domain/nutrition/journal.ts'
import { aggregateNutrients } from '../../src/domain/nutrition/aggregate-nutrients.ts'
import { makeFraction } from '../../src/domain/nutrition/decimal.ts'
import { createConfirmedRecipeSnapshot } from '../../src/domain/nutrition/recipe-snapshot.ts'
import { addRecipeIngredient, calculateFoodSnapshot, calculateRecipe, createRecipe, setRecipeFinalWeight, setRecipeServings, type FoodNutritionSnapshot } from '../../src/domain/nutrition/recipes.ts'
import { usdaDetailToFoodSnapshot } from '../../src/domain/nutrition/usda-food-snapshot.ts'
import { acknowledgeJournalAction, archiveJournalCache, emptyJournalCache, journalCacheKey, persistJournalCacheForKey, readJournalCache, resolveJournalCacheConflict, writeJournalCache } from '../../src/journal-cache.ts'
import { loadFoodSources } from '../../src/journal-sources.ts'
import { formatDashboardEnergy } from '../../src/dashboard-summary.ts'
import type { NutrientContribution, NutrientDatum } from '../../src/domain/nutrition/types.ts'

function food(id: string, protein = '10'): FoodNutritionSnapshot {
  const source = { sourceType: 'usda' as const, sourceName: 'USDA', sourceReference: `FDC:${id}`, nutrientSourceId: 1003 }
  const nutrients: NutrientDatum[] = [
    { status: 'reported', code: 'protein', sourceValue: protein, sourceUnit: 'g', basis: { amount: '100', unit: 'g', source: 'fdc_data_type' }, source },
    { status: 'reported', code: 'carbohydrate', sourceValue: '0', sourceUnit: 'g', basis: { amount: '100', unit: 'g', source: 'fdc_data_type' }, source: { ...source, nutrientSourceId: 1005 } },
  ]
  return {
    foodId: id, sourceType: 'usda', fdcId: Number(id), description: `Food ${id}`, category: null,
    dataType: 'Foundation', brandOwner: null, sourceName: 'USDA', sourceReference: `FDC:${id}`,
    sourceNotes: null, nutrients, portionEquivalences: [], edibleYieldConversions: [],
  }
}

function start(id = 'meal') {
  return createMeal(createJournalDay(createJournalState(), { id: 'day', localDate: '2026-11-04', timeZone: 'UTC' }), 'day', { id, kind: 'lunch' })
}

function withFood(state: ReturnType<typeof start>, id: string, foodId = '1', amount = '100') {
  return addFoodJournalItem(state, 'day', id, {
    id: `item-${foodId}`, foodId,
    quantity: { kind: 'physical', amount, unit: 'g', weightNature: 'edible' }, sortOrder: 0,
  })
}

function confirm(state: ReturnType<typeof start>, id: string, sources = new Map([["1", food('1')]]), snapshotId = 'snapshot-1') {
  return confirmMeal(state, 'day', id, { foods: sources }, {
    snapshotId, confirmedAt: '2026-11-04T12:00:00Z', engineVersion: 'test-engine-1',
  })
}

test('partial exact contributions aggregate without losing nested missing reasons or legacy output shape', () => {
  const origin = { kind: 'recipe-snapshot' as const, recipeId: 'r', snapshotId: 'recipe-s1', recipeVersion: 2 }
  const source = { sourceType: 'usda' as const, sourceName: 'USDA', sourceReference: 'fdc', nutrientSourceId: 1003 }
  const partial: NutrientContribution = {
    status: 'partial', code: 'protein', unit: 'g', exactKnownSubtotal: makeFraction(1n, 3n),
    missing: [{ itemId: 'nested-item', reason: 'nutrient-not-reported', path: ['child', 'leaf'] }],
    origin, provenance: { sources: [source], origins: [origin] },
  }
  const result = aggregateNutrients([{ itemId: 'recipe', nutrients: { protein: partial } }], ['protein'], { multiplier: makeFraction(3n, 1n), includeExact: true }).protein
  assert.equal(result?.status, 'partial')
  if (result?.status === 'partial') {
    assert.equal(result.knownSubtotal, '1.000000')
    assert.deepEqual(result.exactKnownSubtotal, { numerator: '1', denominator: '1' })
    assert.deepEqual(result.missing[0]?.path, ['nested-item', 'child', 'leaf'])
  }
  const complete: NutrientContribution = { status: 'complete', code: 'protein', unit: 'g', exactValue: makeFraction(1n, 1n), source }
  assert.deepEqual(aggregateNutrients([{ itemId: 'a', nutrients: { protein: complete } }], ['protein']).protein,
    { status: 'complete', code: 'protein', value: '1.000000', unit: 'g' })
})

test('meal confirmation recalculates current draft and stores immutable autonomous source data', () => {
  let state = withFood(start(), 'meal')
  const calculation = calculateJournalMeal(state, 'day', 'meal', { foods: new Map([["1", food('1')]]) })
  state = setFoodJournalItemQuantity(state, 'day', 'meal', 'item-1', { kind: 'physical', amount: '50', unit: 'g', weightNature: 'edible' })
  const result = confirm(state, 'meal')
  assert.equal(result.snapshot.items[0]?.kind, 'food')
  assert.equal(result.snapshot.totals.protein?.status, 'complete')
  if (result.snapshot.totals.protein?.status === 'complete') assert.equal(result.snapshot.totals.protein.value, '5.000000')
  assert.equal(calculation.mealRevision + 1, result.snapshot.mealRevision)
  assert.equal(Object.isFrozen(result.state.snapshots[0]), true)
  assert.equal(result.snapshot.items[0]?.kind === 'food' && result.snapshot.items[0].foodSnapshot.description, 'Food 1')
})

test('correction revisions reject stale branches, preserve history, and statistics count only active version', () => {
  const first = confirm(withFood(start(), 'meal'), 'meal')
  const correctionBase = createMealCorrectionDraft(first.state, 'snapshot-1')
  const changed = setFoodJournalItemQuantity(correctionBase, 'day', 'meal', 'item-1', { kind: 'physical', amount: '200', unit: 'g', weightNature: 'edible' })
  const corrected = confirm(changed, 'meal', new Map(), 'snapshot-2')
  assert.equal(corrected.snapshot.supersedesSnapshotId, 'snapshot-1')
  assert.equal(corrected.snapshot.revision, 2)
  assert.equal(corrected.state.snapshots.length, 2)
  assert.equal(selectActiveMealSnapshots(corrected.state.snapshots).length, 1)
  const duplicateBranch = { ...corrected.snapshot, snapshotId: 'racing-snapshot', supersedesSnapshotId: 'snapshot-1', revision: 2 }
  assert.throws(() => validateSnapshotHistory([...corrected.state.snapshots, duplicateBranch]), { code: 'JOURNAL_HISTORY_CONFLICT' })
  assert.equal(calculateJournalDay(corrected.state, 'day').protein?.status, 'complete')
  if (calculateJournalDay(corrected.state, 'day').protein?.status === 'complete') {
    assert.equal(calculateJournalDay(corrected.state, 'day').protein?.value, '20.000000')
  }
})

test('confirmation rejects when a correction revision is stale and void snapshots remove meals from statistics', () => {
  const first = confirm(withFood(start(), 'meal'), 'meal')
  const correctionA = createMealCorrectionDraft(first.state, 'snapshot-1')
  const correctionB = createMealCorrectionDraft(first.state, 'snapshot-1')
  const winning = confirm(correctionA, 'meal', new Map(), 'snapshot-2')
  const staleMergedState = { ...correctionB, snapshots: winning.state.snapshots }
  assert.throws(() => confirm(staleMergedState, 'meal', new Map(), 'snapshot-3'), { code: 'JOURNAL_HISTORY_CONFLICT' })
  const voided = cancelConfirmedMeal(winning.state, 'snapshot-2', {
    newSnapshotId: 'snapshot-void', confirmedAt: '2026-11-04T13:00:00Z', engineVersion: 'test-engine-1',
  })
  assert.equal(voided.snapshot.status, 'void')
  assert.equal(voided.state.snapshots.length, 3)
  assert.deepEqual(selectActiveMealSnapshots(voided.state.snapshots), [])
  assert.equal(calculateJournalDay(voided.state, 'day').protein?.status, 'unknown')
  assert.equal(voided.state.snapshots[0]?.snapshotId, 'snapshot-1')
})

test('removing an item preserves unknown nutrients rather than converting missing data to zero', () => {
  const state = withFood(start(), 'meal')
  const result = confirm(state, 'meal')
  assert.equal(result.snapshot.totals.fiber?.status, 'unknown')
  const changed = createMealCorrectionDraft(result.state, result.snapshot.snapshotId)
  const removed = removeJournalItem(changed, 'day', 'meal', 'item-1')
  assert.equal(removed.days[0]?.revision, changed.days[0]?.revision + 1)
  assert.equal(calculateJournalMeal(removed, 'day', 'meal', { foods: new Map() }).totals.protein?.status, 'unknown')
})

test('gross food quantity remains unknown without a validated edible yield conversion', () => {
  const state = addFoodJournalItem(start(), 'day', 'meal', {
    id: 'gross-item', foodId: '1',
    quantity: { kind: 'physical', amount: '100', unit: 'g', weightNature: 'gross' }, sortOrder: 0,
  })
  const result = confirm(state, 'meal')
  assert.equal(result.snapshot.totals.protein?.status, 'unknown')
  const item = result.snapshot.items[0]
  assert.equal(item?.kind === 'food' ? item.resolvedQuantity.status === 'resolved' && item.resolvedQuantity.weightNature : false, 'gross')
})

test('recipe journal entry uses whole-recipe exact reference totals and fractional serving multiplier', () => {
  const sourceFood = food('5', '12')
  let recipe = addRecipeIngredient(createRecipe({ id: 'recipe-5', name: 'Recipe' }), {
    id: 'ingredient-5', foodId: '5', quantity: { kind: 'physical', amount: '100', unit: 'g', weightNature: 'edible' },
  })
  recipe = setRecipeServings(recipe, '2')
  const recipeSnapshot = createConfirmedRecipeSnapshot(recipe, calculateRecipe(recipe, new Map([['5', sourceFood]])), 'engine-1', '2026-11-04T11:00:00Z', 'recipe-snapshot-1')
  assert.equal(recipeSnapshot.referenceTotals.find((total) => total.code === 'protein')?.exactNumerator, '12')
  let state = createJournalDay(createJournalState(), { id: 'day', localDate: '2026-11-04', timeZone: 'UTC' })
  state = createMeal(state, 'day', { id: 'recipe-meal', kind: 'dinner' })
  state = addRecipeJournalItem(state, 'day', 'recipe-meal', {
    id: 'recipe-item', recipeSnapshot,
    quantity: { kind: 'servings', amount: '0.5' }, sortOrder: 0,
  })
  const result = confirm(state, 'recipe-meal', new Map(), 'recipe-meal-snapshot')
  assert.equal(result.snapshot.totals.protein?.status, 'complete')
  if (result.snapshot.totals.protein?.status === 'complete') assert.equal(result.snapshot.totals.protein.value, '3.000000')
})

test('recipe journal weight allocation uses measured edible final weight and records homogeneity assumption', () => {
  const sourceFood = food('6', '8')
  let recipe = addRecipeIngredient(createRecipe({ id: 'recipe-weight', name: 'Weighted recipe' }), {
    id: 'ingredient-weight', foodId: '6', quantity: { kind: 'physical', amount: '100', unit: 'g', weightNature: 'edible' },
  })
  recipe = setRecipeFinalWeight(recipe, { amount: '400', unit: 'g', weightNature: 'edible' })
  const snapshot = createConfirmedRecipeSnapshot(recipe, calculateRecipe(recipe, new Map([['6', sourceFood]])), 'engine-1', '2026-11-04T11:00:00Z', 'weighted-recipe-snapshot')
  let state = createJournalDay(createJournalState(), { id: 'day', localDate: '2026-11-04', timeZone: 'UTC' })
  state = createMeal(state, 'day', { id: 'weighted-meal', kind: 'dinner' })
  state = addRecipeJournalItem(state, 'day', 'weighted-meal', {
    id: 'weighted-recipe-item', recipeSnapshot: snapshot,
    quantity: { kind: 'weight', amount: '100', unit: 'g', weightNature: 'edible' }, sortOrder: 0,
  })
  const result = confirm(state, 'weighted-meal', new Map(), 'weighted-meal-snapshot')
  assert.equal(result.snapshot.totals.protein?.status, 'complete')
  if (result.snapshot.totals.protein?.status === 'complete') assert.equal(result.snapshot.totals.protein.value, '2.000000')
  const item = result.snapshot.items[0]
  assert.equal(item?.kind === 'recipe' ? item.allocationAssumption : null, 'homogeneous-preparation')
})


test('journal preview combines exact drafts and confirmed meals, while a correction replaces its predecessor', () => {
  const firstDraft = withFood(start('meal-preview'), 'meal-preview')
  const first = confirm(firstDraft, 'meal-preview', new Map([['1', food('1')]]), 'snapshot-preview')
  const correction = createMealCorrectionDraft(first.state, 'snapshot-preview')
  const changed = setFoodJournalItemQuantity(correction, 'day', 'meal-preview', 'item-1', {
    kind: 'physical', amount: '200', unit: 'g', weightNature: 'edible',
  })
  const preview = calculateJournalDayPreview(changed, 'day', { foods: new Map([['1', food('1')]]) })
  assert.equal(preview.protein?.status, 'complete')
  if (preview.protein?.status === 'complete') assert.deepEqual(preview.protein.exactValue, { numerator: '20', denominator: '1' })
  const removed = removeMealDraft(changed, 'day', 'meal-preview')
  assert.equal(removed.days[0]?.meals.length, 0)
  assert.equal(removed.snapshots[0]?.snapshotId, 'snapshot-preview')
  const afterRemovingCorrection = calculateJournalDayPreview(removed, 'day', { foods: new Map([['1', food('1')]]) })
  assert.equal(afterRemovingCorrection.protein?.status, 'complete')
  if (afterRemovingCorrection.protein?.status === 'complete') assert.deepEqual(afterRemovingCorrection.protein.exactValue, { numerator: '10', denominator: '1' })
})

test('USDA detail adapter preserves exact source strings, zero, basis, and selects one energy datum', () => {
  const snapshot = usdaDetailToFoodSnapshot({
    fdcId: 2706091, description: 'Chicken, ground', dataType: 'Survey (FNDDS)', foodCategory: 'Poultry', brandOwner: null,
    nutrients: [
      { id: 1008, name: 'Energy', unitName: 'kcal', value: '999', basis: { quantity: 100, unit: 'g', source: 'fdc_data_type' } },
      { id: 2048, name: 'Energy (Atwater Specific)', unitName: 'kcal', value: '201', basis: { quantity: 100, unit: 'g', source: 'fdc_data_type' } },
      { id: 1003, name: 'Protein', unitName: 'g', value: '27.123456789012345678', basis: { quantity: 100, unit: 'g', source: 'fdc_data_type' } },
      { id: 1005, name: 'Carbohydrate', unitName: 'g', value: '0', basis: { quantity: 100, unit: 'g', source: 'fdc_data_type' } },
      { id: 1004, name: 'Total lipid', unitName: 'g', value: '10.3', basis: { quantity: 100, unit: 'g', source: 'fdc_data_type' } },
      { id: 1079, name: 'Fiber', unitName: 'g', value: null, basis: { quantity: 100, unit: 'g', source: 'fdc_data_type' } },
    ],
  })
  assert.equal(snapshot.foodId, 'usda:2706091')
  const protein = snapshot.nutrients.find((datum) => datum.code === 'protein')
  assert.equal(protein?.status === 'reported' ? protein.sourceValue : null, '27.123456789012345678')
  const calculation = calculateFoodSnapshot(snapshot, { kind: 'physical', amount: '100', unit: 'g', weightNature: 'edible' })
  assert.equal(calculation.contributions.energy?.status, 'complete')
  if (calculation.contributions.energy?.status === 'complete') assert.deepEqual(calculation.contributions.energy.exactValue, { numerator: 201n, denominator: 1n })
  assert.equal(calculation.contributions.carbohydrate?.status, 'complete')
  if (calculation.contributions.carbohydrate?.status === 'complete') assert.deepEqual(calculation.contributions.carbohydrate.exactValue, { numerator: 0n, denominator: 1n })
  assert.equal(calculation.contributions.fiber?.status, 'unknown')
})

test('offline journal cache preserves draft, exact USDA strings, pending actions, and conflict copies', () => {
  const records = new Map<string, string>()
  const storage = {
    getItem(key: string) { return records.get(key) ?? null },
    setItem(key: string, value: string) { records.set(key, value) },
  }
  const key = journalCacheKey('user-a', '2026-11-05')
  assert.notEqual(key, journalCacheKey('user-b', '2026-11-05'))
  const day = withFood(start('offline-meal'), 'offline-meal').days[0]!
  const cache = {
    ...emptyJournalCache(), day, dirty: true,
    sources: { '1': food('1', '27.123456789012345678') },
    pendingConfirm: { mealId: 'offline-meal', snapshotId: 'snapshot-pending', confirmedAt: '2026-11-05T11:00:00Z', engineVersion: 'nutrition-engine-v1' },
    pendingCancels: [{ snapshotId: 'snapshot-old', newSnapshotId: 'snapshot-void', confirmedAt: '2026-11-05T12:00:00Z', engineVersion: 'nutrition-engine-v1' }],
  }
  assert.equal(writeJournalCache(storage, key, cache), true)
  const restored = readJournalCache(storage, key)
  assert.deepEqual(restored, cache)
  assert.equal(restored?.sources['1']?.nutrients.find((datum) => datum.code === 'protein')?.status === 'reported'
    ? restored.sources['1']?.nutrients.find((datum) => datum.code === 'protein')?.sourceValue : null, '27.123456789012345678')
  assert.equal(archiveJournalCache(storage, key, cache, 'conflict-1'), true)
  assert.deepEqual(readJournalCache(storage, key + ':conflict-copy:conflict-1'), cache)
  assert.equal(archiveJournalCache(storage, key, cache, '../escape'), false)
})

test('meal category and time edits are immutable and keep the other draft fields', () => {
  const state = withFood(start('edit-meal'), 'edit-meal')
  const changed = updateMealDetails(state, 'day', 'edit-meal', { kind: 'dinner', label: 'Souper', occurredAt: '2026-11-04T19:30:00Z' })
  assert.equal(state.days[0]?.meals[0]?.kind, 'lunch')
  assert.equal(changed.days[0]?.meals[0]?.kind, 'dinner')
  assert.equal(changed.days[0]?.meals[0]?.label, 'Souper')
  assert.equal(changed.days[0]?.meals[0]?.occurredAt, '2026-11-04T19:30:00.000Z')
  assert.equal(changed.days[0]?.meals[0]?.items.length, 1)
})

test('automatic offline conflict resolution keeps the latest server-confirmed session', () => {
  const localDay = withFood(start('meal-session-a'), 'meal-session-a').days[0]!
  const serverDay = createMeal(createJournalDay(createJournalState(), {
    id: 'day', localDate: '2026-11-04', timeZone: 'UTC',
  }), 'day', { id: 'meal-session-b', kind: 'dinner' }).days[0]!
  const local = { ...emptyJournalCache(), day: localDay, serverRevision: 1, dirty: true,
    sources: { '1': food('1') } }
  const resolved = resolveJournalCacheConflict(local, { day: serverDay, snapshots: [] })
  assert.equal(resolved.day?.meals[0]?.id, 'meal-session-b')
  assert.equal(resolved.dirty, false)
  assert.equal(resolved.conflict, false)
  assert.equal(resolved.serverRevision, serverDay.revision)
  assert.deepEqual(resolved.sources, local.sources)
})

test('a server-confirmed void snapshot defeats an older local meal draft', () => {
  const confirmed = confirm(withFood(start('meal-delete'), 'meal-delete'), 'meal-delete')
  const voided = cancelConfirmedMeal(confirmed.state, 'snapshot-1', {
    newSnapshotId: 'snapshot-void-priority', confirmedAt: '2026-11-04T13:00:00Z', engineVersion: 'test-engine-1',
  })
  const local = { ...emptyJournalCache(), day: withFood(start('meal-delete'), 'meal-delete').days[0]!, dirty: true }
  const resolved = resolveJournalCacheConflict(local, { day: voided.state.days[0]!, snapshots: voided.state.snapshots })
  assert.equal(resolved.day?.meals.length, 0)
  assert.equal(selectActiveMealSnapshots(resolved.snapshots).length, 0)
  assert.equal(resolved.snapshots.at(-1)?.status, 'void')
})

test('a compatible pending confirmation survives auto-reconciliation while stale local edits do not', () => {
  const day = withFood(start('meal-pending'), 'meal-pending').days[0]!
  const pending = { mealId: 'meal-pending', snapshotId: 'snapshot-op', confirmedAt: '2026-11-04T12:00:00Z', engineVersion: 'v1' }
  const local = { ...emptyJournalCache(), day, dirty: true, serverRevision: day.revision - 1, pendingConfirm: pending }
  const serverDay = { ...day, revision: day.revision + 2 }
  assert.deepEqual(resolveJournalCacheConflict(local, { day: serverDay, snapshots: [] }).pendingConfirm, pending)
  const changedServerDay = { ...serverDay, meals: serverDay.meals.map((meal) => ({ ...meal, label: 'updated elsewhere' })) }
  assert.equal(resolveJournalCacheConflict(local, { day: changedServerDay, snapshots: [] }).pendingConfirm, null)
})

test('late day-A sync results persist under A and cannot update day-B view', () => {
  const records = new Map<string, string>()
  const storage = { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => { records.set(key, value) } }
  const keyA = journalCacheKey('user', '2026-11-04')
  const keyB = journalCacheKey('user', '2026-11-05')
  const cacheA = { ...emptyJournalCache(), day: createJournalDay(createJournalState(), { id: 'day-a', localDate: '2026-11-04', timeZone: 'UTC' }).days[0]! }
  const cacheB = { ...emptyJournalCache(), day: createJournalDay(createJournalState(), { id: 'day-b', localDate: '2026-11-05', timeZone: 'UTC' }).days[0]! }
  assert.equal(writeJournalCache(storage, keyB, cacheB), true)
  const result = persistJournalCacheForKey(storage, keyA, keyB, cacheA)
  assert.equal(result.persisted, true)
  assert.equal(result.updateActiveView, false)
  assert.equal(readJournalCache(storage, keyA)?.day?.id, 'day-a')
  assert.equal(readJournalCache(storage, keyB)?.day?.id, 'day-b')
})

test('quota failures are visible as unsaved and cannot restore the unpersisted edit after reload', () => {
  const key = journalCacheKey('user', '2026-11-05')
  const oldCache = { ...emptyJournalCache(), serverRevision: 1, dirty: false }
  const stored = new Map<string, string>([[key, JSON.stringify(oldCache)]])
  const storage = { getItem: (entry: string) => stored.get(entry) ?? null, setItem: (_entry: string, _value: string) => { throw new DOMException('quota exceeded', 'QuotaExceededError') } }
  const attempted = { ...emptyJournalCache(), serverRevision: 2, dirty: true }
  assert.equal(writeJournalCache(storage, key, attempted), false)
  const afterReload = readJournalCache(storage, key)
  assert.deepEqual(afterReload, oldCache)
  assert.notDeepEqual(afterReload, attempted)
})

test('late USDA food-source loading is discarded after switching dates', async () => {
  const day = addFoodJournalItem(start('meal-load'), 'day', 'meal-load', {
    id: 'usda-item', foodId: 'usda:2706091',
    quantity: { kind: 'physical', amount: '100', unit: 'g', weightNature: 'edible' }, sortOrder: 0,
  }).days[0]!
  let finish!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { finish = resolve })
  let active = true
  const cached = { keep: food('keep') }
  const loading = loadFoodSources(day, cached, () => active, async () => pending)
  active = false
  finish(Response.json({ fdcId: 2706091, description: 'Chicken, ground', dataType: 'Survey (FNDDS)', foodCategory: 'Poultry', brandOwner: null, nutrients: [] }))
  assert.deepEqual(await loading, cached)
})

test('dashboard energy rounds exact kcal to whole units and marks partial totals', () => {
  assert.equal(formatDashboardEnergy({ status: 'complete', code: 'energy', value: '251.250000', unit: 'kcal',
    exactValue: { numerator: '1005', denominator: '4' } }, true), '251')
  assert.equal(formatDashboardEnergy({ status: 'complete', code: 'energy', value: '251.500000', unit: 'kcal',
    exactValue: { numerator: '503', denominator: '2' } }, true), '252')
  assert.equal(formatDashboardEnergy({ status: 'partial', code: 'energy', knownSubtotal: '251.500000', unit: 'kcal',
    missing: [], exactKnownSubtotal: { numerator: '503', denominator: '2' } }, true), '252*')
  assert.equal(formatDashboardEnergy(undefined, false), '—')
  assert.equal(formatDashboardEnergy({ status: 'unknown', code: 'energy', unit: 'kcal', missing: [] }, true), 'Inconnu')
})

function pendingConfirmationCache() {
  const state = withFood(start(), 'meal')
  const day = state.days[0]!
  const pendingConfirm = { mealId: 'meal', snapshotId: 'snapshot-1', confirmedAt: '2026-11-04T12:00:00Z', engineVersion: 'v1' }
  const sent = { ...emptyJournalCache(), day, serverRevision: day.revision, pendingConfirm }
  const confirmed = confirm(state, 'meal')
  return { state, sent, result: { day: confirmed.state.days[0]!, snapshot: confirmed.snapshot } }
}

test('late confirmation keeps a newly created draft dirty and counts only the acknowledged meal', () => {
  const { state, sent, result } = pendingConfirmationCache()
  const edited = createMeal(state, 'day', { id: 'new-meal', kind: 'dinner' })
  const latest = { ...sent, day: edited.days[0]!, dirty: true, photoDataUrl: 'new-photo' }
  const ack = acknowledgeJournalAction(sent, latest, result)
  assert.deepEqual(ack.day!.meals.map(m => m.id), ['new-meal'])
  assert.equal(ack.dirty, true)
  assert.equal(ack.serverRevision, result.day.revision)
  assert.ok(ack.day!.revision > ack.serverRevision)
  assert.equal(ack.pendingConfirm, null)
  assert.equal(ack.photoDataUrl, 'new-photo')
  assert.equal(selectActiveMealSnapshots(ack.snapshots).length, 1)
  assert.equal(calculateJournalDay({ days: [ack.day!], snapshots: ack.snapshots }, 'day').protein?.value, '10.000000')
})

test('quantity edited during confirmation becomes an independent pending correction without double counting', () => {
  const { state, sent, result } = pendingConfirmationCache()
  const edited = setFoodJournalItemQuantity(state, 'day', 'meal', 'item-1',
    { kind: 'physical', amount: '234', unit: 'g', weightNature: 'edible' })
  const ack = acknowledgeJournalAction(sent, { ...sent, day: edited.days[0]!, dirty: true }, result)
  assert.equal(ack.day!.meals[0]!.supersedesSnapshotId, result.snapshot.snapshotId)
  assert.equal(ack.dirty, true)
  const nextState = { days: [ack.day!], snapshots: ack.snapshots }
  assert.equal(calculateJournalDay(nextState, 'day').protein?.value, '10.000000')
  assert.equal(calculateJournalDayPreview(nextState, 'day', { foods: new Map([['1', food('1')]]) }).protein?.value, '23.400000')
  const nextConfirmation = confirm(nextState, 'meal', new Map([['1', food('1')]]), 'snapshot-2')
  assert.equal(selectActiveMealSnapshots(nextConfirmation.state.snapshots).length, 1)
  assert.equal(calculateJournalDay(nextConfirmation.state, 'day').protein?.value, '23.400000')
  assert.deepEqual(nextConfirmation.state.snapshots[0], result.snapshot)
})

test('late cancellation keeps edits and new drafts while the void remains excluded from totals', () => {
  const { result } = pendingConfirmationCache()
  const existing = withFood(createMeal({ days: [result.day], snapshots: [result.snapshot] }, 'day', { id: 'other', kind: 'dinner' }), 'other')
  const cancelled = cancelConfirmedMeal(existing, result.snapshot.snapshotId,
    { newSnapshotId: 'void-1', confirmedAt: '2026-11-04T13:00:00Z', engineVersion: 'v1' })
  const pending = { snapshotId: result.snapshot.snapshotId, newSnapshotId: 'void-1', confirmedAt: '2026-11-04T13:00:00Z', engineVersion: 'v1' }
  const sent = { ...emptyJournalCache(), day: existing.days[0]!, snapshots: cancelled.state.snapshots, pendingCancels: [pending] }
  const edited = createMeal(setFoodJournalItemQuantity(existing, 'day', 'other', 'item-1',
    { kind: 'physical', amount: '234', unit: 'g', weightNature: 'edible' }), 'day', { id: 'new', kind: 'snack' })
  const ack = acknowledgeJournalAction(sent, { ...sent, day: edited.days[0]!, dirty: true },
    { day: { ...existing.days[0]!, revision: existing.days[0]!.revision + 1 }, snapshot: cancelled.snapshot })
  assert.equal(ack.day!.meals.length, 2)
  assert.equal(ack.dirty, true)
  assert.equal(ack.pendingCancels.length, 0)
  assert.equal(selectActiveMealSnapshots(ack.snapshots).length, 0)
  assert.equal(ack.snapshots.length, 2)
})

test('photo-only changes survive acknowledgment without becoming a remote draft mutation', () => {
  const { sent, result } = pendingConfirmationCache()
  const ack = acknowledgeJournalAction(sent, { ...sent, photoDataUrl: 'replacement-photo', sources: { '1': food('1') } }, result)
  assert.equal(ack.dirty, false)
  assert.equal(ack.photoDataUrl, 'replacement-photo')
  assert.equal(ack.sources['1']!.description, 'Food 1')
  assert.equal(ack.day, result.day)
})

test('acknowledgment preserves unrelated pending operations and local draft deletions', () => {
  const { state, sent, result } = pendingConfirmationCache()
  const extra = createMeal(state, 'day', { id: 'extra', kind: 'dinner' }).days[0]!
  const pending = { mealId: 'later', snapshotId: 'later-confirm', confirmedAt: '2026-11-04T12:00:00Z', engineVersion: 'v1' }
  const cancel = { snapshotId: 'other-snapshot', newSnapshotId: 'other-void', confirmedAt: '2026-11-04T12:00:00Z', engineVersion: 'v1' }
  const ack = acknowledgeJournalAction({ ...sent, day: extra }, { ...sent, pendingConfirm: pending, pendingCancels: [cancel] },
    { ...result, day: { ...result.day, meals: extra.meals.filter(m => m.id === 'extra') } })
  assert.equal(ack.day!.meals.length, 0)
  assert.equal(ack.dirty, true)
  assert.deepEqual(ack.pendingConfirm, pending)
  assert.deepEqual(ack.pendingCancels, [cancel])
})

test('a late action persists its rebased dirty draft under day A and survives a storage reload', () => {
  const { state, sent, result } = pendingConfirmationCache()
  const latest = { ...sent, day: createMeal(state, 'day', { id: 'new', kind: 'dinner' }).days[0]!, dirty: true }
  const ack = acknowledgeJournalAction(sent, latest, result)
  const records = new Map<string, string>()
  const storage = { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => { records.set(key, value) } }
  const keyA = journalCacheKey('user', '2026-11-04'), keyB = journalCacheKey('user', '2026-11-05')
  writeJournalCache(storage, keyB, emptyJournalCache())
  assert.equal(persistJournalCacheForKey(storage, keyA, keyB, ack).updateActiveView, false)
  assert.equal(readJournalCache(storage, keyA)!.day!.meals[0]!.id, 'new')
  assert.equal(readJournalCache(storage, keyA)!.dirty, true)
  assert.equal(readJournalCache(storage, keyB)!.day, null)
})
