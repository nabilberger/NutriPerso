import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import app from '../src/index.ts'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
function mockFetch(handler: (url: URL) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => handler(new URL(input instanceof Request ? input.url : input.toString()))) as typeof fetch
}

test('search normalizes USDA foods without exposing its server key', async () => {
  const secret = 'test-usda-secret'
  mockFetch((url) => {
    assert.equal(url.pathname, '/fdc/v1/foods/search')
    assert.equal(url.searchParams.get('api_key'), secret)
    assert.equal(url.searchParams.get('query'), 'lentils')
    return Response.json({ totalHits: 1, currentPage: 1, totalPages: 1, foods: [{ fdcId: 123, description: 'Lentils, raw', dataType: 'Foundation', foodNutrients: [{ nutrientId: 1003, nutrientName: 'Protein', unitName: 'G', value: 24.6 }] }] })
  })
  const response = await app.request('/api/foods/search?q=lentils', {}, { FDC_API_KEY: secret })
  const body = await response.text()
  assert.equal(response.status, 200)
  assert.equal(body.includes(secret), false)
  assert.match(body, /\"fdcId\":123/)
  assert.match(body, /\"value\":24.6/)
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
  const body = await response.json() as { keyNutrients: Record<string, { id: number; name: string; value: number; unitName: string } | null> }
  assert.equal(response.status, 200)
  assert.deepEqual(body.keyNutrients, {
    energy: { id: 1008, name: 'Energy', unitName: 'kcal', value: 352 },
    protein: { id: 1003, name: 'Protein', unitName: 'g', value: 24.63 },
    carbohydrates: { id: 1005, name: 'Carbohydrate, by difference', unitName: 'g', value: 63.1 },
    fat: { id: 1004, name: 'Total lipid (fat)', unitName: 'g', value: 1.06 },
    fiber: { id: 1079, name: 'Fiber, total dietary', unitName: 'g', value: 10.7 },
  })
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
