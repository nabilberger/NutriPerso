import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWorkerApp } from '../src/index.ts'

const userId = '2fa33744-d81b-4403-9482-e6a7af550001'
const id = '2fa33744-d81b-4403-9482-e6a7af550004'
const env = { SUPABASE_URL: 'https://db.example.test', SUPABASE_PUBLISHABLE_KEY: 'test', SUPABASE_SECRET_KEY: 'test-only' }
const route = '/api/private/waist-measurements'
const headers = { Authorization: 'Bearer e30.e30.sig', 'Content-Type': 'application/json' }

test('waist endpoint scopes reads and deletes to the verified user and validates writes', async () => {
  const calls: string[] = []
  const app = createWorkerApp({ fetcher: async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/auth/v1/user') return Response.json({ id: userId })
    calls.push(init?.method ?? 'GET')
    assert.equal(url.pathname, '/rest/v1/waist_measurements')
    if (init?.method === 'POST') assert.deepEqual(JSON.parse(String(init.body)), { user_id: userId, measured_on: '2026-11-05', waist_cm: 81.2 })
    else assert.equal(url.searchParams.get('user_id'), 'eq.' + userId)
    if (init?.method === 'DELETE') {
      assert.equal(url.searchParams.get('id'), 'eq.' + id)
      return new Response(null, { status: 204 })
    }
    return Response.json([{ id, measured_on: '2026-11-05', waist_cm: '81.2' }])
  } })
  const post = (body: unknown) => app.request(route, { method: 'POST', headers, body: JSON.stringify(body) }, env)
  assert.equal((await app.request(route, {}, env)).status, 401)
  assert.equal((await post({ userId: 'other', measuredOn: '2026-11-05', waistCm: 81 })).status, 403)
  assert.equal((await post({ measuredOn: '2026-02-30', waistCm: 81 })).status, 400)
  assert.equal((await post({ measuredOn: '2026-11-05', waistCm: 5 })).status, 400)
  assert.equal((await post({ measuredOn: '2026-11-05', waistCm: 81.2 })).status, 201)
  assert.equal((await app.request(route, { headers }, env)).status, 200)
  assert.equal((await app.request(route + '/' + id, { method: 'DELETE', headers }, env)).status, 204)
  assert.deepEqual(calls, ['POST', 'GET', 'DELETE'])
})
