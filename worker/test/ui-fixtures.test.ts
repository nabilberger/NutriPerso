import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldEnableUiFixtures } from '../../src/ui-fixture-mode.ts'
import {
  calculateJournalDay, createMealCorrectionDraft, selectActiveMealSnapshots, setFoodJournalItemQuantity,
  type ConfirmedMealSnapshot, type JournalDayDraft,
} from '../../src/domain/nutrition/journal.ts'
import { buildMealReuseDraft, type MealReuseDTO } from '../../src/meal-reuse.ts'
import { createUuidV4 } from '../../src/secure-uuid.ts'
import type { ConfirmedRecipeSnapshot } from '../../src/domain/nutrition/recipe-snapshot.ts'
import { fixtureRequest } from '../../src/dev-ui-fixtures.ts'
import { missingWorkerVars } from '../../scripts/dev-stack-config.mjs'
test('fixtures require development and explicit opt-in; production stays disabled',()=>{
 assert.equal(shouldEnableUiFixtures(false,'1'),false)
 assert.equal(shouldEnableUiFixtures(true,undefined),false)
 assert.equal(shouldEnableUiFixtures(true,'true'),false)
 assert.equal(shouldEnableUiFixtures(true,'1'),true)
})
test('synthetic history exposes 20 recent meals and accent-insensitive search',async()=>{
 const page=await fixtureRequest<{meals:unknown[];total:number}>('/api/private/journal/history?limit=20')
 assert.equal(page.meals.length,20);assert.equal(page.total,24)
 const search=await fixtureRequest<{meals:Array<{label:string|null}>}>('/api/private/journal/history?q=dejeuner')
 assert.equal(search.meals.length,1);assert.equal(search.meals[0]?.label,'Déjeuner démo')
})
test('template changes are held in memory only',async()=>{
 const initial=await fixtureRequest<{templates:Array<{id:string;name:string}>}>('/api/private/meal-templates')
 assert.equal(initial.templates.length,1)
 const item=initial.templates[0]!
 const changed={id:item.id,name:'Renommé en recette',revision:2,meal:{id:item.id,name:'Renommé en recette',revision:2,meal:{kind:'breakfast',label:null,items:[]}}}
 const result=await fixtureRequest<{template:{name:string}}>('/api/private/meal-templates/'+item.id,{method:'PUT',body:JSON.stringify({template:changed,expectedRevision:1})})
 assert.equal(result.template.name,'Renommé en recette')
 await fixtureRequest<void>('/api/private/meal-templates/'+item.id,{method:'DELETE'})
 assert.equal((await fixtureRequest<{templates:unknown[]}>('/api/private/meal-templates')).templates.length,0)
})
test('unmapped fixture routes fail locally without a network fallback',async()=>{
 await assert.rejects(()=>fixtureRequest('/api/private/unmocked'),/aucun appel réseau effectué/)
})

test('connected local startup checks required variable names without printing or parsing their values',()=>{
 assert.deepEqual(missingWorkerVars(''),['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','FDC_API_KEY'])
 assert.deepEqual(missingWorkerVars('SUPABASE_URL=https://local.invalid\nSUPABASE_PUBLISHABLE_KEY=public\nSUPABASE_SECRET_KEY=private\nFDC_API_KEY=local'),[])
})

function asReuseDto(snapshot: ConfirmedMealSnapshot): MealReuseDTO {
  return { sourceKind: 'consumption', sourceId: snapshot.snapshotId, label: snapshot.label, mealKind: snapshot.mealKind,
    items: snapshot.items.map((item) => item.kind === 'food'
      ? { kind: 'food', foodId: item.foodId, quantity: item.enteredQuantity, sortOrder: item.sortOrder }
      : { kind: 'recipe', recipeId: item.recipeSnapshot.recipe.id, quantity: item.quantity, sortOrder: item.sortOrder }) }
}
async function saveFixtureDraft(day: JournalDayDraft, expectedRevision: number): Promise<JournalDayDraft> {
  const saved = await fixtureRequest<{ draft: JournalDayDraft }>(`/api/private/journal/${day.id}/draft`, {
    method: 'PUT', body: JSON.stringify({ expectedRevision, draft: { ...day, revision: expectedRevision + 1 } }),
  })
  return saved.draft
}
async function confirmFixtureDraft(day: JournalDayDraft, snapshotId: string): Promise<ConfirmedMealSnapshot> {
  const meal = day.meals.at(-1)!
  const result = await fixtureRequest<{ day: JournalDayDraft; snapshot: ConfirmedMealSnapshot }>(
    `/api/private/journal/${day.id}/meals/${meal.id}/confirm`,
    { method: 'POST', body: JSON.stringify({ snapshotId, confirmedAt: new Date().toISOString(), engineVersion: 'nutrition-engine-v1-fixture' }) },
  )
  return result.snapshot
}

test('fixture adapter runs reuse → confirmation → correction → confirmation → cancel → reuse/correction with one active snapshot per meal', async () => {
  const sourcePage = await fixtureRequest<{ meals: ConfirmedMealSnapshot[] }>('/api/private/journal/history?limit=20')
  const source = sourcePage.meals.find((meal) => meal.items.some((item) => item.kind === 'recipe'))!
  const recipeResult = await fixtureRequest<{ snapshots: ConfirmedRecipeSnapshot[] }>('/api/private/recipes/fixture-recipe-bowl')
  const recipe = recipeResult.snapshots[0]!
  const today = source.localDate
  const initial = await fixtureRequest<{ journal: { day: JournalDayDraft; snapshots: ConfirmedMealSnapshot[] } | null }>(`/api/private/journal?date=${today}`)
  assert.ok(initial.journal?.day)
  const initialDay = initial.journal.day
  const baseline = calculateJournalDay({ days: [initialDay], snapshots: initial.journal.snapshots }, initialDay.id).protein
  const makeDraft = (day: JournalDayDraft, snapshots: readonly ConfirmedMealSnapshot[]) => {
    const state = buildMealReuseDraft({ days: [day], snapshots }, { id: day.id, localDate: today, timeZone: day.timeZone },
      asReuseDto(source), { [recipe.recipe.id]: recipe }, () => createUuidV4())
    return state.days[0]!
  }
  const activeFor = async (logicalMealId: string) => {
    const response = await fixtureRequest<{ meals: ConfirmedMealSnapshot[] }>('/api/private/journal/history?limit=100')
    return response.meals.filter((snapshot) => snapshot.logicalMealId === logicalMealId)
  }
  const firstDraft = await saveFixtureDraft(makeDraft(initialDay, initial.journal.snapshots), initialDay.revision)
  const first = await confirmFixtureDraft(firstDraft, createUuidV4())
  const originalCopy = structuredClone(first)
  assert.equal(first.revision, 1)
  assert.equal((await activeFor(first.logicalMealId)).length, 1)

  const afterFirst = await fixtureRequest<{ journal: { day: JournalDayDraft; snapshots: ConfirmedMealSnapshot[] } }>(`/api/private/journal?date=${today}`)
  let correctionState = createMealCorrectionDraft({ days: [afterFirst.journal.day], snapshots: afterFirst.journal.snapshots }, first.snapshotId)
  const correctionMeal = correctionState.days[0]!.meals.at(-1)!
  const foodItem = correctionMeal.items.find((item) => item.kind === 'food')
  assert.ok(foodItem?.kind === 'food')
  correctionState = setFoodJournalItemQuantity(correctionState, correctionState.days[0]!.id, correctionMeal.id, foodItem.id,
    { ...foodItem.quantity, amount: '200' })
  const correctionDay = correctionState.days[0]!
  const savedCorrection = await saveFixtureDraft(correctionDay, afterFirst.journal.day.revision)
  const corrected = await confirmFixtureDraft(savedCorrection, createUuidV4())
  assert.equal(corrected.revision, 2)
  assert.equal(corrected.supersedesSnapshotId, first.snapshotId)
  assert.deepEqual(first, originalCopy)
  assert.equal((await activeFor(first.logicalMealId)).length, 1)
  assert.notDeepEqual(corrected.totals.protein, first.totals.protein)
  const afterCorrection = await fixtureRequest<{ journal: { day: JournalDayDraft; snapshots: ConfirmedMealSnapshot[] } }>(`/api/private/journal?date=${today}`)
  const correctedDaily = calculateJournalDay({ days: [afterCorrection.journal.day], snapshots: afterCorrection.journal.snapshots }, afterCorrection.journal.day.id).protein
  assert.ok(correctedDaily)
  assert.ok(baseline)
  assert.equal(selectActiveMealSnapshots(afterCorrection.journal.snapshots).filter(s => s.logicalMealId === first.logicalMealId).length, 1)

  const cancel = await fixtureRequest<{ day: JournalDayDraft; snapshot: ConfirmedMealSnapshot }>(
    `/api/private/journal/snapshots/${corrected.snapshotId}/cancel`,
    { method: 'POST', body: JSON.stringify({ newSnapshotId: createUuidV4(), confirmedAt: new Date().toISOString(), engineVersion: 'nutrition-engine-v1-fixture' }) },
  )
  assert.equal(cancel.snapshot.status, 'void')
  assert.equal(cancel.snapshot.supersedesSnapshotId, corrected.snapshotId)
  const afterCancel = await fixtureRequest<{ journal: { day: JournalDayDraft; snapshots: ConfirmedMealSnapshot[] } }>(`/api/private/journal?date=${today}`)
  assert.equal(selectActiveMealSnapshots(afterCancel.journal.snapshots).filter(s => s.logicalMealId === first.logicalMealId).length, 0)
  const cancelledDaily = calculateJournalDay({ days: [afterCancel.journal.day], snapshots: afterCancel.journal.snapshots }, afterCancel.journal.day.id).protein
  assert.deepEqual(cancelledDaily, baseline)
  assert.deepEqual(first, originalCopy)

  const remaining = await fixtureRequest<{ meals: ConfirmedMealSnapshot[] }>('/api/private/journal/history?limit=100')
  const nextSource = remaining.meals[0]!
  const nextDraft = await saveFixtureDraft(makeDraft(afterCancel.journal.day, afterCancel.journal.snapshots), afterCancel.journal.day.revision)
  const second = await confirmFixtureDraft(nextDraft, createUuidV4())
  const afterSecond = await fixtureRequest<{ journal: { day: JournalDayDraft; snapshots: ConfirmedMealSnapshot[] } }>(`/api/private/journal?date=${today}`)
  let secondCorrection = createMealCorrectionDraft({ days: [afterSecond.journal.day], snapshots: afterSecond.journal.snapshots }, second.snapshotId)
  const secondMeal = secondCorrection.days[0]!.meals.at(-1)!
  secondCorrection = setFoodJournalItemQuantity(secondCorrection, secondCorrection.days[0]!.id, secondMeal.id,
    secondMeal.items.find(i => i.kind === 'food')!.id,
    { kind: 'physical', amount: '150', unit: 'g', weightNature: 'edible' })
  const secondCorrectionDay = await saveFixtureDraft(secondCorrection.days[0]!, afterSecond.journal.day.revision)
  const secondCorrected = await confirmFixtureDraft(secondCorrectionDay, createUuidV4())
  assert.equal(secondCorrected.logicalMealId, second.logicalMealId)
  assert.equal((await activeFor(second.logicalMealId)).length, 1)
  assert.equal((await activeFor(first.logicalMealId)).length, 0)
  assert.equal(remaining.meals.some(s=>s.snapshotId===nextSource.snapshotId),true)
})
