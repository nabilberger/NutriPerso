import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateRecipe, createRecipe, addRecipeIngredient, updateRecipeName, type FoodNutritionSnapshot } from '../../src/domain/nutrition/recipes.ts'
import { createConfirmedRecipeSnapshot, type ConfirmedRecipeSnapshot } from '../../src/domain/nutrition/recipe-snapshot.ts'
import {
  confirmRecipe,
  getRecipePersistence,
  listRecipeDrafts,
  RecipePersistenceError,
  saveRecipeDraft,
} from '../src/supabase-recipes.ts'
import type { RecipeDraft } from '../../src/domain/nutrition/recipes.ts'

const recipeId = 'd4e8d688-56e0-4a66-a857-6b4f39d617a1'
const scope = { userId: '2fa33744-d81b-4403-9482-e6a7af550001' }
const otherScope = { userId: '2fa33744-d81b-4403-9482-e6a7af550002' }
const foodId = '1c77e5d2-05ca-4b45-9770-f16b9c78356c'
const env = { SUPABASE_URL: 'https://nutrip.persotest.invalid', SUPABASE_SECRET_KEY: 'secret-test-only' }

function mockDataApi() {
  const recipes = new Map<string, Record<string, unknown>>()
  const snapshots: Array<Record<string, unknown>> = []
  const requests: Array<{ url: URL; init: RequestInit }> = []
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    requests.push({ url, init })
    assert.equal(new Headers(init.headers).get('apikey'), env.SUPABASE_SECRET_KEY)
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${env.SUPABASE_SECRET_KEY}`)

    if (url.pathname.endsWith('/rpc/save_recipe_draft') && init.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { p_user_id: string; p_recipe_id: string; p_expected_revision: number; p_draft: RecipeDraft }
      const current = recipes.get(body.p_recipe_id)
      if (!current) {
        if (body.p_expected_revision !== 0 || body.p_draft.revision !== 1) return conflict()
        const saved = recipeRow(body.p_user_id, body.p_draft)
        recipes.set(body.p_recipe_id, saved)
        return Response.json([saved])
      }
      if (current.user_id !== body.p_user_id) return conflict()
      const currentDraft = current.draft as RecipeDraft
      if (body.p_expected_revision + 1 === currentDraft.revision
        && currentDraft.revision === body.p_draft.revision
        && JSON.stringify(currentDraft) === JSON.stringify(body.p_draft)) {
        return Response.json([current])
      }
      if (currentDraft.revision !== body.p_expected_revision || body.p_draft.revision !== body.p_expected_revision + 1) return conflict()
      const saved = recipeRow(body.p_user_id, body.p_draft)
      recipes.set(body.p_recipe_id, saved)
      return Response.json([saved])
    }

    if (url.pathname.endsWith('/rpc/append_recipe_snapshot') && init.method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        p_user_id: string
        p_recipe_id: string
        p_expected_revision: number
        p_expected_predecessor_snapshot_id: string | null
        p_snapshot: ConfirmedRecipeSnapshot
      }
      const current = recipes.get(body.p_recipe_id)
      if (!current || current.user_id !== body.p_user_id || (current.draft as RecipeDraft).revision !== body.p_expected_revision) return conflict()
      const storedDraft = current.draft as RecipeDraft
      const snapshotIngredients = body.p_snapshot.ingredients.map((item, position) => ({
        id: item.ingredientId, foodId: item.food.foodId, quantity: item.enteredQuantity, position,
      }))
      if (body.p_snapshot.recipe.id !== storedDraft.id || body.p_snapshot.recipe.name !== storedDraft.name
        || body.p_snapshot.recipe.revision !== storedDraft.revision
        || JSON.stringify(body.p_snapshot.recipe.servings) !== JSON.stringify(storedDraft.servings)
        || JSON.stringify(body.p_snapshot.recipe.finalWeight) !== JSON.stringify(storedDraft.finalWeight)
        || JSON.stringify(snapshotIngredients) !== JSON.stringify(storedDraft.ingredients)) return conflict()
      const existing = snapshots.find((row) => row.user_id === body.p_user_id && row.snapshot_id === body.p_snapshot.snapshotId)
      if (existing) {
        if (JSON.stringify(existing.snapshot) === JSON.stringify(body.p_snapshot)
          && existing.predecessor_snapshot_id === body.p_expected_predecessor_snapshot_id) return Response.json([existing])
        return conflict()
      }
      const history = snapshots.filter((row) => row.user_id === body.p_user_id && row.recipe_id === body.p_recipe_id)
      const head = history.find((row) => !history.some((child) => child.predecessor_snapshot_id === row.snapshot_id))
      const headId = (head?.snapshot_id as string | undefined) ?? null
      if (headId !== body.p_expected_predecessor_snapshot_id) return conflict()
      const saved = {
        snapshot_id: body.p_snapshot.snapshotId,
        user_id: body.p_user_id,
        recipe_id: body.p_recipe_id,
        recipe_revision: body.p_expected_revision,
        predecessor_snapshot_id: body.p_expected_predecessor_snapshot_id,
        snapshot: body.p_snapshot,
      }
      snapshots.push(saved)
      return Response.json([saved])
    }

    if (url.pathname.endsWith('/recipes') && (!init.method || init.method === 'GET')) {
      const id = url.searchParams.get('id')?.replace(/^eq\./, '')
      const userId = url.searchParams.get('user_id')?.replace(/^eq\./, '')
      const rows = [...recipes.values()].filter((row) => (!id || row.id === id) && (!userId || row.user_id === userId))
      return Response.json(rows)
    }
    if (url.pathname.endsWith('/recipe_snapshots') && (!init.method || init.method === 'GET')) {
      const id = url.searchParams.get('recipe_id')?.replace(/^eq\./, '')
      const userId = url.searchParams.get('user_id')?.replace(/^eq\./, '')
      return Response.json(snapshots.filter((row) => row.recipe_id === id && (!userId || row.user_id === userId)))
    }
    return Response.json({ code: 'UNEXPECTED_REQUEST' }, { status: 404 })
  }
  return { recipes, snapshots, requests, fetcher }
}

function recipeRow(user_id: string, draft: RecipeDraft): Record<string, unknown> {
  return { id: draft.id, user_id, name: draft.name, revision: draft.revision, draft, created_at: '2026-11-04T12:00:00Z', updated_at: '2026-11-04T12:00:00Z' }
}

function conflict(): Response {
  return Response.json({ code: '40001', message: 'RECIPE_REVISION_CONFLICT' }, { status: 409 })
}

function buildRecipe(): RecipeDraft {
  const recipe = createRecipe({ id: recipeId, name: 'Porridge' })
  return addRecipeIngredient(recipe, {
    id: 'ingredient-oats', foodId,
    quantity: { kind: 'physical', amount: '1', unit: 'g', weightNature: 'edible' },
  })
}

function buildFood(): FoodNutritionSnapshot {
  return {
    foodId, sourceType: 'usda', fdcId: 12345, description: 'Oats', category: null, dataType: 'Foundation',
    brandOwner: null, sourceName: 'USDA', sourceReference: 'fdc:12345', sourceNotes: null,
    nutrients: [{
      status: 'reported', code: 'protein', sourceValue: '1', sourceUnit: 'g',
      basis: { amount: '3', unit: 'g', source: 'fdc_data_type' },
      source: { sourceType: 'usda', sourceName: 'USDA', sourceReference: 'fdc:12345', nutrientSourceId: 1003 },
    }],
    portionEquivalences: [], edibleYieldConversions: [],
  }
}

function buildSnapshot(recipe: RecipeDraft, confirmedAt: string, snapshotId: string): ConfirmedRecipeSnapshot {
  const calculation = calculateRecipe(recipe, new Map([[foodId, buildFood()]]))
  return createConfirmedRecipeSnapshot(recipe, calculation, 'nutrition-engine-v1', confirmedAt, snapshotId)
}

test('saves and lists recipe drafts with their ingredient quantities and exact string values', async () => {
  const mock = mockDataApi()
  const initial = createRecipe({ id: recipeId, name: 'Porridge' })
  await saveRecipeDraft(env, scope, initial, 0, mock.fetcher)
  const draft = buildRecipe()
  const saved = await saveRecipeDraft(env, scope, draft, 1, mock.fetcher)
  assert.deepEqual(saved, draft)
  assert.deepEqual(await listRecipeDrafts(env, scope, 10, mock.fetcher), [draft])
  const rpc = mock.requests.filter(({ url }) => url.pathname.endsWith('/rpc/save_recipe_draft')).at(-1)
  assert.ok(rpc)
  const body = JSON.parse(String(rpc.init.body)) as { p_draft: RecipeDraft }
  assert.equal(body.p_draft.ingredients[0]?.quantity.amount, '1')
  assert.equal(body.p_expected_revision, 1)
})

test('draft retries are idempotent and stale edits return a revision conflict', async () => {
  const mock = mockDataApi()
  const initial = createRecipe({ id: recipeId, name: 'Porridge' })
  await saveRecipeDraft(env, scope, initial, 0, mock.fetcher)
  const draft = buildRecipe()
  await saveRecipeDraft(env, scope, draft, 1, mock.fetcher)
  await saveRecipeDraft(env, scope, draft, 1, mock.fetcher)
  const changed = updateRecipeName(draft, 'Porridge complet')
  await saveRecipeDraft(env, scope, changed, draft.revision, mock.fetcher)
  await assert.rejects(saveRecipeDraft(env, scope, updateRecipeName(draft, 'Modification périmée'), draft.revision, mock.fetcher), {
    code: 'REVISION_CONFLICT',
  })
  assert.equal(mock.recipes.size, 1)
})

test('initial saves require revision one and identical retries must keep their original expected revision', async () => {
  const mock = mockDataApi()
  await assert.rejects(saveRecipeDraft(env, scope, buildRecipe(), 0, mock.fetcher), { code: 'INVALID_RECIPE' })

  const initial = createRecipe({ id: recipeId, name: 'Porridge' })
  await saveRecipeDraft(env, scope, initial, 0, mock.fetcher)
  const updated = buildRecipe()
  await saveRecipeDraft(env, scope, updated, 1, mock.fetcher)

  // Simulate a stale retry that sends the same revision-2 payload with revision 0 as its base.
  const response = await mock.fetcher(new URL('/rest/v1/rpc/save_recipe_draft', env.SUPABASE_URL), {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` },
    body: JSON.stringify({ p_user_id: scope.userId, p_recipe_id: recipeId, p_expected_revision: 0, p_draft: updated }),
  })
  assert.equal(response.status, 409)
  assert.deepEqual(await saveRecipeDraft(env, scope, updated, 1, mock.fetcher), updated)
  assert.equal(mock.recipes.size, 1)
})

test('appends immutable autonomous snapshots as one linear history and reloads without catalogue reads', async () => {
  const mock = mockDataApi()
  const initial = createRecipe({ id: recipeId, name: 'Porridge' })
  await saveRecipeDraft(env, scope, initial, 0, mock.fetcher)
  let draft = buildRecipe()
  await saveRecipeDraft(env, scope, draft, 1, mock.fetcher)
  const first = await confirmRecipe(env, scope, draft, new Map([[foodId, buildFood()]]), { kind: 'total' },
    'nutrition-engine-v1', '2026-11-04T12:00:00.000Z', null, mock.fetcher)
  assert.equal(first.referenceTotals.find(({ code }) => code === 'protein')?.exactNumerator, '1')
  assert.equal(first.referenceTotals.find(({ code }) => code === 'protein')?.exactDenominator, '3')
  await confirmRecipe(env, scope, draft, new Map([[foodId, buildFood()]]), { kind: 'total' },
    'nutrition-engine-v1', '2026-11-04T12:00:00.000Z', null, mock.fetcher)

  draft = updateRecipeName(draft, 'Porridge corrigé')
  await saveRecipeDraft(env, scope, draft, draft.revision - 1, mock.fetcher)
  const second = await confirmRecipe(env, scope, draft, new Map([[foodId, buildFood()]]), { kind: 'total' },
    'nutrition-engine-v1', '2026-11-04T13:00:00.000Z', first.snapshotId, mock.fetcher)
  await assert.rejects(confirmRecipe(env, scope, draft, new Map([[foodId, buildFood()]]), { kind: 'total' },
    'nutrition-engine-v1', '2026-11-04T14:00:00.000Z', first.snapshotId, mock.fetcher), { code: 'REVISION_CONFLICT' })

  const beforeReads = mock.requests.length
  const restored = await getRecipePersistence(env, scope, recipeId, mock.fetcher)
  assert.ok(restored)
  assert.deepEqual(restored.draft, draft)
  assert.deepEqual(restored.snapshots, [first, second])
  assert.equal(mock.requests.slice(beforeReads).some(({ url }) => /foods|food_nutrients/.test(url.pathname)), false)
  assert.equal(mock.snapshots.length, 2)
})

test('snapshot ingredient projection preserves ordered IDs, quantities, units and position', async () => {
  const mock = mockDataApi()
  const secondFoodId = '6a5c42d3-6a40-4c2c-80b7-ecc95c41673c'
  const initial = createRecipe({ id: recipeId, name: 'Porridge' })
  await saveRecipeDraft(env, scope, initial, 0, mock.fetcher)
  const firstIngredient = buildRecipe()
  await saveRecipeDraft(env, scope, firstIngredient, 1, mock.fetcher)
  const draft = addRecipeIngredient(firstIngredient, {
    id: 'ingredient-liquid',
    foodId: secondFoodId,
    quantity: { kind: 'physical', amount: '125.50', unit: 'ml', weightNature: 'not-applicable' },
  })
  await saveRecipeDraft(env, scope, draft, firstIngredient.revision, mock.fetcher)

  const snapshot = await confirmRecipe(env, scope, draft, new Map([
    [foodId, buildFood()],
    [secondFoodId, { ...buildFood(), foodId: secondFoodId }],
  ]), { kind: 'total' }, 'nutrition-engine-v1', '2026-11-04T12:00:00.000Z', null, mock.fetcher)
  assert.deepEqual(snapshot.ingredients.map(({ ingredientId, enteredQuantity }) => ({ ingredientId, enteredQuantity })), draft.ingredients.map(({ id, quantity }) => ({ ingredientId: id, enteredQuantity: quantity })))
  assert.equal(mock.snapshots.length, 1)
})

test('server confirmation recalculates totals with the existing deterministic recipe engine', async () => {
  const mock = mockDataApi()
  const initial = createRecipe({ id: recipeId, name: 'Porridge' })
  await saveRecipeDraft(env, scope, initial, 0, mock.fetcher)
  const draft = buildRecipe()
  await saveRecipeDraft(env, scope, draft, 1, mock.fetcher)
  const snapshot = await confirmRecipe(
    env, scope, draft, new Map([[foodId, buildFood()]]), { kind: 'total' },
    'nutrition-engine-v1', '2026-11-04T12:00:00.000Z', null, mock.fetcher,
  )
  const protein = snapshot.referenceTotals.find(({ code }) => code === 'protein')
  assert.equal(protein?.exactNumerator, '1')
  assert.equal(protein?.exactDenominator, '3')
  assert.equal(mock.snapshots.length, 1)
})

test('confirmation rejects source composition that differs from the stored draft at the same revision', async () => {
  const mock = mockDataApi()
  const initial = createRecipe({ id: recipeId, name: 'Porridge' })
  await saveRecipeDraft(env, scope, initial, 0, mock.fetcher)
  const draft = buildRecipe()
  await saveRecipeDraft(env, scope, draft, 1, mock.fetcher)
  const forged = { ...draft, name: 'Unstored name' }
  await assert.rejects(confirmRecipe(
    env, scope, forged, new Map([[foodId, buildFood()]]), { kind: 'total' },
    'nutrition-engine-v1', '2026-11-04T12:00:00.000Z', null, mock.fetcher,
  ), { code: 'REVISION_CONFLICT' })
  assert.equal(mock.snapshots.length, 0)
})

test('rejects restored snapshots whose exact fractions were converted to JSON numbers', async () => {
  const mock = mockDataApi()
  const draft = buildRecipe()
  const snapshot = buildSnapshot(draft, '2026-11-04T12:00:00.000Z', 'snapshot-bad')
  mock.recipes.set(draft.id, recipeRow(scope.userId, draft))
  const altered = structuredClone(snapshot) as unknown as Record<string, unknown>
  const totals = altered.referenceTotals as Array<Record<string, unknown>>
  const protein = totals.find((total) => total.code === 'protein')!
  protein.exactNumerator = 1
  mock.snapshots.push({ user_id: scope.userId, recipe_id: draft.id, snapshot: altered })
  await assert.rejects(getRecipePersistence(env, scope, draft.id, mock.fetcher), {
    code: 'INVALID_RECIPE',
  })
  assert.equal(mock.requests.length, 2)
})

test('rejects non-UUID persistent recipe IDs and missing server configuration', async () => {
  const mock = mockDataApi()
  await assert.rejects(getRecipePersistence(env, scope, 'recipe-1', mock.fetcher), { code: 'INVALID_RECIPE' })
  await assert.rejects(saveRecipeDraft({}, scope, buildRecipe(), 0, mock.fetcher), RecipePersistenceError)
  assert.equal(mock.requests.length, 0)
})

test('recipe drafts and snapshots are isolated by user on reads and writes', async () => {
  const mock = mockDataApi()
  const initial = createRecipe({ id: recipeId, name: 'Porridge' })
  await saveRecipeDraft(env, scope, initial, 0, mock.fetcher)
  const draft = buildRecipe()
  await saveRecipeDraft(env, scope, draft, 1, mock.fetcher)
  await confirmRecipe(env, scope, draft, new Map([[foodId, buildFood()]]), { kind: 'total' },
    'nutrition-engine-v1', '2026-11-04T12:00:00.000Z', null, mock.fetcher)
  assert.deepEqual(await getRecipePersistence(env, otherScope, draft.id, mock.fetcher), null)
  assert.deepEqual(await listRecipeDrafts(env, otherScope, 10, mock.fetcher), [])
  await assert.rejects(saveRecipeDraft(env, otherScope, updateRecipeName(draft, 'Cross-user edit'), 2, mock.fetcher), {
    code: 'REVISION_CONFLICT',
  })
  await assert.rejects(confirmRecipe(env, otherScope, draft, new Map([[foodId, buildFood()]]), { kind: 'total' },
    'nutrition-engine-v1', '2026-11-04T12:00:00.000Z', null, mock.fetcher), { code: 'REVISION_CONFLICT' })
  const ownerData = await getRecipePersistence(env, scope, draft.id, mock.fetcher)
  assert.equal(ownerData?.draft.name, 'Porridge')
  assert.equal(ownerData?.snapshots.length, 1)
  assert.equal(mock.recipes.size, 1)
  assert.equal(mock.snapshots.length, 1)
  assert.ok(mock.requests.filter(({ url }) => url.pathname.endsWith('/recipes')).every(({ url }) => url.searchParams.get('user_id') === `eq.${scope.userId}` || url.searchParams.get('user_id') === `eq.${otherScope.userId}`))
})
