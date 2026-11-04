import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import app, { resolveNutrientBasis } from '../src/index.ts'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
function mockFetch(handler: (url: URL) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => handler(new URL(input instanceof Request ? input.url : input.toString()))) as typeof fetch
}

test('search normalizes results, omits nutrients, and never exposes its server key', async () => {
  const secret = 'test-usda-secret'
  mockFetch((url) => {
    assert.equal(url.pathname, '/fdc/v1/foods/search')
    assert.equal(url.searchParams.get('api_key'), secret)
    assert.equal(url.searchParams.get('query'), 'lentils')
    assert.equal(url.searchParams.get('pageNumber'), '1')
    assert.equal(url.searchParams.get('pageSize'), '25')
    return Response.json({ totalHits: 1, currentPage: 1, totalPages: 1, foods: [{ fdcId: 123, description: 'Lentils, raw', dataType: 'Foundation', score: 0.91, foodNutrients: [{ nutrientId: 1003, nutrientName: 'Protein', unitName: 'G', value: 24.6 }] }] })
  })
  const response = await app.request('/api/foods/search?q=lentils', {}, { FDC_API_KEY: secret })
  const body = await response.json() as { foods: Array<Record<string, unknown>> }
  assert.equal(response.status, 200)
  assert.equal(JSON.stringify(body).includes(secret), false)
  assert.deepEqual(body.foods, [{ fdcId: 123, description: 'Lentils, raw', dataType: 'Foundation', brandOwner: null, score: 0.91, foodCategory: 'generic' }])
  assert.equal('nutrients' in body.foods[0]!, false)
})

test('search puts a normalized exact description match first', async () => {
  mockFetch(() => Response.json({ totalHits: 2, foods: [
    { fdcId: 10, description: 'Lentils, raw', dataType: 'Foundation', score: 0.99 },
    { fdcId: 11, description: 'LÉNTILS', dataType: 'Branded', score: 0.2, brandOwner: 'Example' },
  ] }))
  const response = await app.request('/api/foods/search?q=lentils', {}, { FDC_API_KEY: 'test' })
  const body = await response.json() as { foods: Array<{ fdcId: number }> }
  assert.equal(body.foods[0]?.fdcId, 11)
})

test('search orders by USDA relevance score before source preference', async () => {
  mockFetch(() => Response.json({ totalHits: 2, foods: [
    { fdcId: 10, description: 'Lentils, dry', dataType: 'Foundation', score: 0.7 },
    { fdcId: 11, description: 'Lentils, dry green', dataType: 'Branded', score: 0.95 },
  ] }))
  const response = await app.request('/api/foods/search?q=lentils', {}, { FDC_API_KEY: 'test' })
  const body = await response.json() as { foods: Array<{ fdcId: number }> }
  assert.deepEqual(body.foods.map(({ fdcId }) => fdcId), [11, 10])
})

test('search prefers generic sources when relevance scores are comparable', async () => {
  mockFetch(() => Response.json({ totalHits: 4, foods: [
    { fdcId: 1, description: 'Lentils, prepared', dataType: 'Branded', score: 0.8, brandOwner: 'Example' },
    { fdcId: 2, description: 'Lentils, prepared', dataType: 'Survey (FNDDS)', score: 0.8 },
    { fdcId: 3, description: 'Lentils, cooked', dataType: 'SR Legacy', score: 0.8 },
    { fdcId: 4, description: 'Lentils, cooked green', dataType: 'Foundation', score: 0.8 },
  ] }))
  const response = await app.request('/api/foods/search?q=lentils', {}, { FDC_API_KEY: 'test' })
  const body = await response.json() as { foods: Array<{ fdcId: number }> }
  assert.deepEqual(body.foods.map(({ fdcId }) => fdcId), [4, 3, 2, 1])
})

test('search retains relevant prepared FNDDS and Branded foods', async () => {
  mockFetch(() => Response.json({ totalHits: 2, foods: [
    { fdcId: 20, description: 'Lentil soup, prepared', dataType: 'Survey (FNDDS)', score: 0.9 },
    // This Branded result is an exact text match, so it may rank ahead of the higher-scored FNDDS result.
    { fdcId: 21, description: 'Lentil soup', dataType: 'Branded', brandOwner: 'Example Co', score: 0.85 },
  ] }))
  const response = await app.request('/api/foods/search?q=lentil%20soup', {}, { FDC_API_KEY: 'test' })
  const body = await response.json() as { foods: Array<{ fdcId: number; foodCategory: string; dataType: string } & Record<string, unknown>> }
  assert.deepEqual(body.foods.map(({ fdcId }) => fdcId).sort(), [20, 21])
  assert.deepEqual(body.foods.map(({ foodCategory }) => foodCategory).sort(), ['branded', 'generic'])
  assert.ok(body.foods.some(({ fdcId, dataType }) => fdcId === 20 && dataType === 'Survey (FNDDS)'))
  assert.ok(body.foods.some(({ fdcId, dataType }) => fdcId === 21 && dataType === 'Branded'))
  assert.equal(body.foods.some((food) => 'nutrients' in food), false)
})

test('search strictly deduplicates FDC IDs and keeps the duplicate with the higher score', async () => {
  mockFetch(() => Response.json({ totalHits: 3, foods: [
    { fdcId: 30, description: 'Lentils, raw', dataType: 'SR Legacy', score: 0.7 },
    { fdcId: 30, description: 'Lentils, raw', dataType: 'Foundation', score: 0.9 },
    { fdcId: 31, description: 'Lentils, raw', dataType: 'Foundation', score: 0.8 },
  ] }))
  const response = await app.request('/api/foods/search?q=lentils', {}, { FDC_API_KEY: 'test' })
  const body = await response.json() as { foods: Array<{ fdcId: number; dataType: string }> }
  assert.deepEqual(body.foods.map(({ fdcId }) => fdcId), [30, 31])
  assert.equal(body.foods.find(({ fdcId }) => fdcId === 30)?.dataType, 'Foundation')
})

test('search excludes results without an FDC ID or usable description and omits missing score', async () => {
  mockFetch(() => Response.json({ totalHits: 4, foods: [
    { description: 'Lentils', dataType: 'Foundation' },
    { fdcId: 41, dataType: 'Foundation' },
    { fdcId: 42, description: '  ', dataType: 'Foundation' },
    { fdcId: 43, description: 'Lentils', dataType: 'Foundation' },
  ] }))
  const response = await app.request('/api/foods/search?q=lentils', {}, { FDC_API_KEY: 'test' })
  const body = await response.json() as { foods: Array<Record<string, unknown>> }
  assert.equal(body.foods.length, 1)
  assert.equal(body.foods[0]?.fdcId, 43)
  assert.equal('score' in body.foods[0]!, false)
})

test('search pagination validates page and caps pageSize at 25', async () => {
  mockFetch((url) => {
    assert.equal(url.searchParams.get('pageNumber'), '3')
    assert.equal(url.searchParams.get('pageSize'), '25')
    return Response.json({ totalHits: 26, currentPage: 3, totalPages: 2, foods: [] })
  })
  const response = await app.request('/api/foods/search?q=lentils&page=3&pageSize=80', {}, { FDC_API_KEY: 'test' })
  const body = await response.json() as { currentPage: number; pageSize: number }
  assert.equal(response.status, 200)
  assert.equal(body.currentPage, 3)
  assert.equal(body.pageSize, 25)
})

test('search rejects invalid pagination without contacting USDA', async () => {
  let calls = 0
  globalThis.fetch = (async () => { calls += 1; return Response.json({}) }) as typeof fetch
  const invalidPage = await app.request('/api/foods/search?q=lentils&page=1.5', {}, { FDC_API_KEY: 'test' })
  const invalidSize = await app.request('/api/foods/search?q=lentils&pageSize=0', {}, { FDC_API_KEY: 'test' })
  assert.equal(invalidPage.status, 400)
  assert.equal(invalidSize.status, 400)
  assert.equal(calls, 0)
})

test('search rejects an empty query before making an upstream request', async () => {
  let called = false
  globalThis.fetch = (async () => { called = true; return Response.json({}) }) as typeof fetch
  const response = await app.request('/api/foods/search?q=%20%20', {}, { FDC_API_KEY: 'test' })
  assert.equal(response.status, 400)
  assert.equal(called, false)
})

test('detail selects key nutrients and retains USDA amounts and units', async () => {
  mockFetch((url) => {
    assert.equal(url.pathname, '/fdc/v1/food/123')
    return Response.json({ fdcId: 123, description: 'Lentils, raw', dataType: 'Foundation', foodNutrients: [
      { nutrient: { id: 1008, name: 'Energy', unitName: 'kcal' }, amount: 352 },
      { nutrient: { id: 1003, name: 'Protein', unitName: 'g' }, amount: 24.63 },
      { nutrient: { id: 1005, name: 'Carbohydrate, by difference', unitName: 'g' }, amount: 63.1 },
      { nutrient: { id: 1004, name: 'Total lipid (fat)', unitName: 'g' }, amount: 1.06 },
      { nutrient: { id: 1079, name: 'Fiber, total dietary', unitName: 'g' }, amount: 10.7 },
    ] })
  })
  const response = await app.request('/api/foods/123', {}, { FDC_API_KEY: 'test' })
  const body = await response.json() as { keyNutrients: Record<string, { id: number; name: string; value: string; unitName: string; basis: { quantity: number; unit: string; source: string } | null } | null> }
  assert.equal(response.status, 200)
  assert.deepEqual(body.keyNutrients, {
    energy: { id: 1008, name: 'Energy', unitName: 'kcal', value: '352', basis: { quantity: 100, unit: 'g', source: 'fdc_data_type' } },
    protein: { id: 1003, name: 'Protein', unitName: 'g', value: '24.63', basis: { quantity: 100, unit: 'g', source: 'fdc_data_type' } },
    carbohydrates: { id: 1005, name: 'Carbohydrate, by difference', unitName: 'g', value: '63.1', basis: { quantity: 100, unit: 'g', source: 'fdc_data_type' } },
    fat: { id: 1004, name: 'Total lipid (fat)', unitName: 'g', value: '1.06', basis: { quantity: 100, unit: 'g', source: 'fdc_data_type' } },
    fiber: { id: 1079, name: 'Fiber, total dietary', unitName: 'g', value: '10.7', basis: { quantity: 100, unit: 'g', source: 'fdc_data_type' } },
  })
})

test('detail omits nutrients with absent or unknown values so they cannot become catalog rows', async () => {
  mockFetch(() => Response.json({
    fdcId: 456,
    description: 'Food with incomplete nutrient data',
    dataType: 'Foundation',
    foodNutrients: [
      { nutrient: { id: 1003, name: 'Protein', unitName: 'g' }, amount: null },
      { nutrient: { id: 1004, name: 'Total lipid (fat)', unitName: 'g' } },
      { nutrient: { id: 1005, name: 'Carbohydrate', unitName: 'g' }, amount: 'not reported' },
      { nutrient: { id: 1008, name: 'Energy', unitName: 'kcal' }, amount: 0 },
    ],
  }))
  const response = await app.request('/api/foods/456', {}, { FDC_API_KEY: 'test' })
  const body = await response.json() as { nutrients: Array<{ id: number; name: string; value: string }> }
  assert.equal(response.status, 200)
  assert.deepEqual(body.nutrients.map(({ id, value }) => ({ id, value })), [{ id: 1008, value: '0' }])
})

test('Branded detail keeps the serving separate from the documented 100-unit nutrient basis', async () => {
  mockFetch(() => Response.json({
    fdcId: 2431290,
    description: 'LENTILS',
    dataType: 'Branded',
    servingSize: 48,
    servingSizeUnit: 'g',
    foodNutrients: [{
      nutrient: { id: 1008, name: 'Energy', unitName: 'kcal' },
      amount: 292,
      foodNutrientDerivation: { id: 70, code: 'LCCS', description: 'Calculated from value per serving size measure' },
    }],
  }))
  const response = await app.request('/api/foods/2431290', {}, { FDC_API_KEY: 'test' })
  const body = await response.json() as {
    servingSize: number
    servingSizeUnit: string
    nutrients: Array<{ id: number; name: string; value: string; unitName: string; basis: { quantity: number; unit: string; source: string } | null }>
  }
  assert.equal(response.status, 200)
  assert.equal(body.servingSize, 48)
  assert.equal(body.servingSizeUnit, 'g')
  assert.deepEqual(body.nutrients[0], {
    id: 1008,
    name: 'Energy',
    unitName: 'kcal',
    value: '292',
    basis: { quantity: 100, unit: 'g', source: 'fdc_branded_standardization' },
  })
})

test('Branded nutrient bases require USDA derivation metadata and an explicit gram or milliliter unit', () => {
  assert.deepEqual(resolveNutrientBasis('Branded', 'g', 'kcal', true), {
    quantity: 100, unit: 'g', source: 'fdc_branded_standardization',
  })
  assert.deepEqual(resolveNutrientBasis('Branded', 'ml', 'mg', true), {
    quantity: 100, unit: 'ml', source: 'fdc_branded_standardization',
  })
})

test('unknown or non-mass nutrient bases remain null', () => {
  assert.equal(resolveNutrientBasis('Branded', null, 'g'), null)
  assert.equal(resolveNutrientBasis('Branded', 'g', 'g', false), null)
  assert.equal(resolveNutrientBasis('Branded', 'oz', 'g', true), null)
  assert.equal(resolveNutrientBasis('Experimental', 'g', 'g', true), null)
  assert.equal(resolveNutrientBasis('Foundation', null, '%'), null)
})

test('USDA errors are normalized and their body and key are not forwarded', async () => {
  const secret = 'test-usda-secret'
  globalThis.fetch = (async () => new Response('upstream echoed ' + secret, { status: 500 })) as typeof fetch
  const response = await app.request('/api/foods/search?q=beans', {}, { FDC_API_KEY: secret })
  const body = await response.text()
  assert.equal(response.status, 502)
  assert.equal(body.includes(secret), false)
  assert.equal(body.includes('upstream echoed'), false)
})

test('missing server key fails closed without contacting USDA', async () => {
  let called = false
  globalThis.fetch = (async () => { called = true; return Response.json({}) }) as typeof fetch
  const response = await app.request('/api/foods/search?q=beans', {}, {})
  assert.equal(response.status, 503)
  assert.equal(called, false)
})
