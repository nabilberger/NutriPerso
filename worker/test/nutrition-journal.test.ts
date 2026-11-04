import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addFoodJournalItem,
  addRecipeJournalItem,
  calculateJournalDay,
  calculateJournalMeal,
  cancelConfirmedMeal,
  confirmMeal,
  createJournalDay,
  createJournalState,
  createMeal,
  createMealCorrectionDraft,
  removeJournalItem,
  selectActiveMealSnapshots,
  setFoodJournalItemQuantity,
  validateSnapshotHistory,
} from '../../src/domain/nutrition/journal.ts'
import { aggregateNutrients } from '../../src/domain/nutrition/aggregate-nutrients.ts'
import { makeFraction } from '../../src/domain/nutrition/decimal.ts'
import { createConfirmedRecipeSnapshot } from '../../src/domain/nutrition/recipe-snapshot.ts'
import { addRecipeIngredient, calculateRecipe, createRecipe, setRecipeFinalWeight, setRecipeServings, type FoodNutritionSnapshot } from '../../src/domain/nutrition/recipes.ts'
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
