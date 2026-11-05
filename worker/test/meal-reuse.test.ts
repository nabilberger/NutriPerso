import assert from 'node:assert/strict'
import test from 'node:test'
import { createJournalDay, type ConfirmedMealSnapshot, type JournalState } from '../../src/domain/nutrition/journal.ts'
import { buildMealReuseDraft, selectCurrentRecipeSnapshot, type MealReuseDTO } from '../../src/meal-reuse.ts'
import type { ConfirmedRecipeSnapshot } from '../../src/domain/nutrition/recipe-snapshot.ts'

test('reuse creates fresh editable draft identifiers without linking or changing its source snapshot', () => {
  const created = createJournalDay({ days: [], snapshots: [] }, {
    id: '00000000-0000-4000-8000-000000000001', localDate: '2026-11-06', timeZone: 'Africa/Casablanca',
  })
  const historical = { snapshotId: 'historic-snapshot', logicalMealId: 'historic-meal', status: 'confirmed' } as unknown as ConfirmedMealSnapshot
  const state: JournalState = { days: created.days, snapshots: [historical] }
  const before = structuredClone(state.snapshots)
  const source: MealReuseDTO = { sourceKind: 'consumption', sourceId: historical.snapshotId, label: 'Déjeuner',
    mealKind: 'lunch', items: [{ kind: 'food', foodId: 'food-1', quantity: {
      kind: 'physical', amount: '125', unit: 'g', weightNature: 'edible',
    }, sortOrder: 0 }] }
  const ids = ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003']
  const next = buildMealReuseDraft(state, { id: created.days[0]!.id, localDate: '2026-11-06', timeZone: 'Africa/Casablanca' },
    source, {}, () => ids.shift()!)
  const reused = next.days[0]!.meals[0]!
  assert.notEqual(reused.id, historical.logicalMealId)
  assert.equal(reused.supersedesSnapshotId, null)
  assert.equal(reused.items[0]?.id, '00000000-0000-4000-8000-000000000003')
  assert.equal(reused.items[0]?.kind, 'food')
  if (reused.items[0]?.kind === 'food') {
    assert.equal(reused.items[0].pinnedFoodSnapshot, undefined)
    assert.equal(reused.items[0].quantity.amount, '125')
  }
  assert.deepEqual(next.snapshots, before)
  assert.equal(next.days[0]?.meals.length, 1)
})

test('newly reused meal is only a draft and cannot create a confirmed snapshot automatically', () => {
  const day = createJournalDay({ days: [], snapshots: [] }, {
    id: '00000000-0000-4000-8000-000000000011', localDate: '2026-11-06', timeZone: 'UTC',
  }).days[0]!
  const result = buildMealReuseDraft({ days: [day], snapshots: [] },
    { id: day.id, localDate: day.localDate, timeZone: day.timeZone },
    { sourceKind: 'template', sourceId: 'template-1', label: 'Modèle', mealKind: 'snack',
      items: [{ kind: 'food', foodId: 'food-1', quantity: { kind: 'physical', amount: '30', unit: 'g', weightNature: 'edible' }, sortOrder: 0 }] },
    {}, (() => { let n = 20; return () => `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}` })())
  assert.equal(result.snapshots.length, 0)
  assert.equal(result.days[0]?.meals[0]?.items.length, 1)
})

test('recipe reuse selects highest confirmed revision and keeps the source snapshot unchanged', () => {
  const makeRecipe = (revision: number, snapshotId: string) => ({
    schemaVersion: '1', snapshotId, engineVersion: 'test', confirmedAt: `2026-11-0${revision}T12:00:00.000Z`,
    recipe: { id: 'recipe-1', name: 'Soupe', revision, servings: '2', finalWeight: null },
  }) as unknown as ConfirmedRecipeSnapshot
  const old = makeRecipe(1, 'recipe-snap-1')
  const current = makeRecipe(3, 'recipe-snap-3')
  const chosen = selectCurrentRecipeSnapshot([current, old], 'recipe-1')
  assert.equal(chosen?.snapshotId, 'recipe-snap-3')
  const original = structuredClone(current)
  const day = createJournalDay({ days: [], snapshots: [] }, {
    id: '00000000-0000-4000-8000-000000000021', localDate: '2026-11-06', timeZone: 'UTC',
  }).days[0]!
  const source: MealReuseDTO = { sourceKind: 'consumption', sourceId: 'old-meal', label: null, mealKind: 'dinner',
    items: [{ kind: 'recipe', recipeId: 'recipe-1', quantity: { kind: 'servings', amount: '1' }, sortOrder: 0 }] }
  const result = buildMealReuseDraft({ days: [day], snapshots: [] },
    { id: day.id, localDate: day.localDate, timeZone: day.timeZone }, source, { 'recipe-1': chosen! },
    (() => { let i = 30; return () => `00000000-0000-4000-8000-${String(i++).padStart(12, '0')}` })())
  const item = result.days[0]?.meals[0]?.items[0]
  assert.equal(item?.kind, 'recipe')
  if (item?.kind === 'recipe') {
    assert.equal(item.recipeSnapshot.snapshotId, 'recipe-snap-3')
    assert.equal(item.quantity.amount, '1')
  }
  assert.deepEqual(current, original)
  assert.equal(result.snapshots.length, 0)
})
