import { catalogNutritionSnapshot } from '../../src/catalog-nutrition.ts'
import { calculateFoodSnapshot } from '../../src/domain/nutrition/recipes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  getCatalogNutrition, importUsdaFood,
  searchCatalogFoods,
  SupabaseCatalogError,
  type UsdaFoodDetail,
} from '../src/supabase-catalog.ts'
import app, { importUsdaFoodByFdcId } from '../src/index.ts'

const env = { SUPABASE_URL: 'https://nutriperso.test', SUPABASE_SECRET_KEY: 'server-secret-test-only' }

function mockSupabase() {
  const foods = new Map<number, Record<string, unknown>>()
  const nutrients = new Map<string, Record<string, unknown>>()
  const requests: Array<{ url: URL; init: RequestInit }> = []
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    requests.push({ url, init })
    assert.equal(new Headers(init.headers).get('apikey'), env.SUPABASE_SECRET_KEY)
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${env.SUPABASE_SECRET_KEY}`)
    if (url.pathname.endsWith('/foods') && init.method === 'POST') {
      const row = JSON.parse(String(init.body)) as Record<string, unknown>
      const fdcId = row.fdc_id as number
      const existing = foods.get(fdcId)
      const saved = { id: existing?.id ?? `food-${fdcId}`, ...existing, ...row }
      foods.set(fdcId, saved)
      return Response.json([saved])
    }
    if (url.pathname.endsWith('/food_nutrients') && init.method === 'POST') {
      const rows = JSON.parse(String(init.body)) as Array<Record<string, unknown>>
      const saved = rows.map((row) => {
        const key = `${row.food_id}:${row.nutrient_code}`
        const merged = { ...nutrients.get(key), ...row }
        nutrients.set(key, merged)
        return merged
      })
      return Response.json(saved)
    }
    if (url.pathname.endsWith('/foods') && (!init.method || init.method === 'GET')) {
      return Response.json([...foods.values()])
    }
    return Response.json({ message: 'unexpected mock request' }, { status: 404 })
  }
  return { foods, nutrients, requests, fetcher }
}

const detail: UsdaFoodDetail = {
  fdcId: 12345,
  description: 'Oats, rolled',
  dataType: 'Foundation',
  foodCategory: 'Cereal Grains and Pasta',
  brandOwner: null,
  nutrients: [
    { id: 1003, name: 'Protein', unitName: 'g', value: '13.15', basis: { quantity: 100, unit: 'g', source: 'fdc_data_type' } },
  ],
}

test('searches foods through the server-side Data API with a bounded result limit', async () => {
  const mock = mockSupabase()
  const results = await searchCatalogFoods(env, 'oats', 1_000, mock.fetcher)
  assert.deepEqual(results, [])
  assert.equal(mock.requests.length, 1)
  assert.equal(mock.requests[0]?.url.searchParams.get('limit'), '100')
  assert.equal(mock.requests[0]?.url.searchParams.get('description'), 'ilike.*oats*')
})

test('imports a USDA food and nutrients idempotently by FDC and nutrient identifiers', async () => {
  const mock = mockSupabase()
  const duplicateNutrient = { ...detail.nutrients[0]!, name: 'Protein duplicate' }
  const input = { ...detail, nutrients: [...detail.nutrients, duplicateNutrient] }
  const first = await importUsdaFood(env, input, mock.fetcher, new Date('2026-11-03T12:00:00.000Z'))
  const second = await importUsdaFood(env, { ...input, description: 'Oats, rolled, updated' }, mock.fetcher, new Date('2026-11-04T12:00:00.000Z'))

  assert.equal(first.food.id, second.food.id)
  assert.equal(mock.foods.size, 1)
  assert.equal(mock.nutrients.size, 1)
  assert.equal(first.nutrients.length, 1)
  assert.equal(second.food.description, 'Oats, rolled, updated')
  assert.equal(second.nutrients[0]?.nutrient_code, 'fdc:1003')
  assert.equal(second.nutrients[0]?.value, '13.15')
  assert.equal(mock.requests.filter(({ url }) => url.pathname.endsWith('/foods') && url.searchParams.has('on_conflict')).length, 2)
  const nutrientUpserts = mock.requests.filter(({ url }) => url.pathname.endsWith('/food_nutrients'))
  assert.equal(nutrientUpserts.length, 2)
  assert.ok(nutrientUpserts.every(({ url }) => url.searchParams.get('on_conflict') === 'food_id,nutrient_code'))
  assert.ok(nutrientUpserts.every(({ init }) => new Headers(init.headers).get('prefer') === 'resolution=merge-duplicates,return=representation'))
  assert.ok(mock.requests.filter(({ url }) => url.pathname.endsWith('/foods') && url.searchParams.has('on_conflict'))
    .every(({ url }) => url.searchParams.get('on_conflict') === 'fdc_id'))
  assert.ok(mock.requests.every(({ init }) => new Headers(init.headers).get('authorization') === `Bearer ${env.SUPABASE_SECRET_KEY}`))
})

test('imports from the full FNDDS detail by FDC ID, retaining every valid value and its 100 g basis', async () => {
  const mock = mockSupabase()
  const usdaRequests: URL[] = []
  const usdaFetcher: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    usdaRequests.push(url)
    return Response.json({
      fdcId: 987654,
      description: 'Sample FNDDS food',
      dataType: 'Survey (FNDDS)',
      foodCategory: 'Restaurant Foods',
      brandOwner: null,
      servingSize: 1,
      servingSizeUnit: 'cup',
      foodNutrients: [
        { nutrient: { id: 1008, name: 'Energy', unitName: 'kcal' }, amount: 0 },
        { nutrient: { id: 1003, name: 'Protein', unitName: 'g' }, amount: 4.25 },
        { nutrient: { id: 1093, name: 'Sodium, Na', unitName: 'mg' }, amount: 85 },
      ],
    })
  }

  const first = await importUsdaFoodByFdcId({ ...env, FDC_API_KEY: 'test-fdc-key' }, 987654, usdaFetcher, mock.fetcher)
  const second = await importUsdaFoodByFdcId({ ...env, FDC_API_KEY: 'test-fdc-key' }, 987654, usdaFetcher, mock.fetcher)

  assert.equal(usdaRequests.length, 2)
  assert.ok(usdaRequests.every((url) => url.pathname === '/fdc/v1/food/987654'))
  assert.ok(usdaRequests.every((url) => url.searchParams.get('api_key') === 'test-fdc-key'))
  assert.ok(usdaRequests.every((url) => !url.pathname.includes('/foods/search')))
  assert.equal(first.food.id, second.food.id)
  assert.equal(mock.foods.size, 1)
  assert.equal(mock.nutrients.size, 3)
  assert.deepEqual(first.nutrients.map(({ fdc_nutrient_id, value, reference_quantity, reference_unit, basis_source }) => ({
    fdc_nutrient_id, value, reference_quantity, reference_unit, basis_source,
  })), [
    { fdc_nutrient_id: 1008, value: '0', reference_quantity: '100', reference_unit: 'g', basis_source: 'fdc_data_type' },
    { fdc_nutrient_id: 1003, value: '4.25', reference_quantity: '100', reference_unit: 'g', basis_source: 'fdc_data_type' },
    { fdc_nutrient_id: 1093, value: '85', reference_quantity: '100', reference_unit: 'g', basis_source: 'fdc_data_type' },
  ])
})

test('preserves exact raw USDA decimal tokens through Worker parsing and Supabase numeric upsert', async () => {
  const mock = mockSupabase()
  const rawUsda = '{"fdcId":555,"description":"Exact decimals","dataType":"Foundation","foodNutrients":[{"nutrient":{"id":1008,"name":"Energy","unitName":"kcal"},"amount":0},{"nutrient":{"id":1003,"name":"Protein","unitName":"g"},"amount":1.2345678901234567e-2},{"nutrient":{"id":1004,"name":"Fat","unitName":"g"},"amount":1.234567890123456789}]} '
  const usdaFetcher: typeof fetch = async () => new Response(rawUsda)

  const result = await importUsdaFoodByFdcId({ ...env, FDC_API_KEY: 'test-fdc-key' }, 555, usdaFetcher, mock.fetcher)
  assert.deepEqual(result.nutrients.map(({ fdc_nutrient_id, value }) => ({ fdc_nutrient_id, value })), [
    { fdc_nutrient_id: 1008, value: '0' },
    { fdc_nutrient_id: 1003, value: '1.2345678901234567e-2' },
    { fdc_nutrient_id: 1004, value: '1.234567890123456789' },
  ])

  const nutrientWrite = mock.requests.find(({ url }) => url.pathname.endsWith('/food_nutrients'))
  assert.ok(nutrientWrite)
  const rows = JSON.parse(String(nutrientWrite.init.body)) as Array<{ value: string }>
  assert.deepEqual(rows.map(({ value }) => value), ['0', '1.2345678901234567e-2', '1.234567890123456789'])
})

test('skips unknown values but preserves a valid nutrient even when USDA omitted its nutrient ID', async () => {
  const mock = mockSupabase()
  const result = await importUsdaFood(env, {
    ...detail,
    nutrients: [
      { id: 1003, name: 'Protein', unitName: 'g', value: null, basis: null },
      { id: 1004, name: 'Fat', unitName: 'g', value: 'NaN', basis: null },
      { id: null, name: 'Unidentified nutrient', unitName: 'g', value: '1', basis: null },
    ],
  }, mock.fetcher)
  assert.equal(result.nutrients.length, 1)
  assert.equal(result.nutrients[0]?.nutrient_name, 'Unidentified nutrient')
  assert.equal(result.nutrients[0]?.fdc_nutrient_id, null)
  assert.equal(result.nutrients[0]?.nutrient_code, 'name:unidentified-nutrient:g')
  assert.equal(mock.nutrients.size, 1)
  assert.equal(mock.requests.filter(({ url }) => url.pathname.endsWith('/food_nutrients')).length, 1)
})

test('requires server Supabase configuration before making a request', async () => {
  let called = false
  const fetcher: typeof fetch = async () => { called = true; return Response.json([]) }
  await assert.rejects(searchCatalogFoods({}, 'oats', 25, fetcher), SupabaseCatalogError)
  assert.equal(called, false)
})

test('does not expose a public route for privileged arbitrary catalogue imports', async () => {
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = (async () => { called = true; return Response.json([]) }) as typeof fetch
  try {
    const response = await app.request('/api/catalog/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source_type: 'usda', fdc_id: 12345, value: 100 }),
    }, { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY, FDC_API_KEY: 'test-usda-key' })
    assert.equal(response.status, 404)
    assert.equal(called, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

const personalEntry = { id: '10000000-0000-4000-8000-000000000005', source_type: 'custom' as const, fdc_id: null, description: 'Farine maison', category: null,
  data_type: null, brand_owner: null, source_name: 'Étiquette', source_reference: 'Mesure maison', source_notes: null, imported_at: null }
test('personal catalogue snapshots preserve exact bases, real zero and missing nutrients', () => {
  const food = catalogNutritionSnapshot(personalEntry, [
    { nutrient_code: 'name:protein:g', fdc_nutrient_id: null, value: '1', unit: 'G', reference_quantity: '3', reference_unit: 'g', basis_source: 'manual' },
    { nutrient_code: 'carbohydrate', fdc_nutrient_id: null, value: '0', unit: 'g', reference_quantity: '100', reference_unit: 'g', basis_source: 'manual' },
    { nutrient_code: 'energy', fdc_nutrient_id: null, value: '44', unit: 'KCAL', reference_quantity: null, reference_unit: null, basis_source: null },
  ])
  const calc = calculateFoodSnapshot(food, { kind: 'physical', amount: '1', unit: 'g', weightNature: 'edible' })
  assert.equal(calc.contributions.protein?.status, 'complete')
  if(calc.contributions.protein?.status === 'complete') assert.equal(calc.contributions.protein.exactValue.denominator, 3n)
  assert.equal(calc.contributions.carbohydrate?.status, 'complete')
  assert.equal(calc.contributions.energy?.status, 'unknown')
  assert.equal(calc.contributions.fiber?.status, 'unknown')
  assert.equal(food.sourceType, 'custom')
})
test('local catalogue reads validate the requested food identity and keep unknown bases unknown', async () => {
  const requested: URL[] = []
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input)); requested.push(url)
    return Response.json(url.pathname.endsWith('/foods') ? [personalEntry] : [])
  }
  const food = await getCatalogNutrition(env, personalEntry.id, fetcher)
  assert.equal(food?.foodId, 'catalog:' + personalEntry.id)
  assert.equal(food?.nutrients.length, 0)
  assert.equal(requested[0]!.searchParams.get('id'), 'eq.' + personalEntry.id)
  assert.equal(requested[1]!.searchParams.get('food_id'), 'eq.' + personalEntry.id)
  await assert.rejects(getCatalogNutrition(env, 'invalid', fetcher), /Identifiant/)
  assert.equal(await getCatalogNutrition(env, personalEntry.id, async () => Response.json([])), null)
})
