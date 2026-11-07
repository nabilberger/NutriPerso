import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWorkerApp } from '../src/index.ts'

const user = '2fa33744-d81b-4403-9482-e6a7af550001'
const env = {
  SUPABASE_URL: 'https://db.example.test', SUPABASE_PUBLISHABLE_KEY: 'test-publishable',
  SUPABASE_SECRET_KEY: 'test-service', GEMINI_API_KEY: 'test-model', GEMINI_MODEL: 'mock-model',
  AI_REQUEST_MAX_DH: '0.10', COACH_ENABLED: '1',
}
const request = (payload: unknown, token = true): RequestInit => ({
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer e30.e30.sig' } : {}) },
  body: JSON.stringify(payload),
})

test('Coach checks auth, activation and input before reading user data', async () => {
  const calls: string[] = []
  const app = createWorkerApp({ fetcher: async input => {
    calls.push(new URL(String(input)).pathname)
    return Response.json({ id: user })
  } })
  assert.equal((await app.request('/api/private/coach', request({}, false), env)).status, 401)
  assert.equal((await app.request('/api/private/coach', request({}), { ...env, COACH_ENABLED: undefined })).status, 503)
  assert.equal((await app.request('/api/private/coach', request({ skill: '__proto__', question: 'test' }), env)).status, 400)
  assert.deepEqual(calls, ['/auth/v1/user', '/auth/v1/user'])
})

test('Coach isolates scope, minimizes context and reserves the shared budget before Gemini', async () => {
  const calls: string[] = []
  const answer = { recorded: 'Aucune donnée', suggestions: 'Préparer des lentilles', uncertainty: 'Portions inconnues' }
  let reservedId: string | undefined
  const app = createWorkerApp({ fetcher: async (input, init) => {
    const url = new URL(String(input))
    calls.push(url.pathname)
    if (url.pathname === '/auth/v1/user') return Response.json({ id: user, email: 'private@example.test' })
    if (url.pathname === '/rest/v1/user_profiles') {
      assert.equal(url.searchParams.get('user_id'), 'eq.' + user)
      return Response.json([])
    }
    if (url.pathname.endsWith('/reserve_photo_analysis')) {
      const body = JSON.parse(String(init?.body))
      assert.equal(body.p_user, user)
      assert.equal(body.p_cost, 0.1)
      reservedId = body.p_id
      return new Response(null, { status: 204 })
    }
    if (url.pathname.endsWith(':generateContent')) {
      const body = JSON.parse(String(init?.body))
      const input = JSON.parse(body.contents[0].parts[0].text)
      assert.deepEqual(Object.keys(input.context).sort(), ['avoidAddedSalt', 'avoidAddedSugar', 'dietaryPattern'])
      assert.equal(input.question, 'Que préparer avec des lentilles ?')
      assert.ok(!JSON.stringify(body).includes('private@example.test'))
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(answer) }] } }], usageMetadata: { totalTokenCount: 100 } })
    }
    assert.ok(url.pathname.endsWith('/finish_photo_analysis'))
    assert.deepEqual(JSON.parse(String(init?.body)), { p_user: user, p_id: reservedId, p_tokens: 100 })
    return new Response(null, { status: 204 })
  } })
  const response = await app.request('/api/private/coach', request({ skill: 'recipe', question: 'Que préparer avec des lentilles ?', userId: 'foreign' }), env)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { answer })
  assert.deepEqual(calls, ['/auth/v1/user', '/rest/v1/user_profiles', '/rest/v1/rpc/reserve_photo_analysis', '/v1beta/models/mock-model:generateContent', '/rest/v1/rpc/finish_photo_analysis'])
})

test('Coach makes no provider call when budget reservation fails', async () => {
  const app = createWorkerApp({ fetcher: async input => {
    const path = new URL(String(input)).pathname
    if (path === '/auth/v1/user') return Response.json({ id: user })
    if (path === '/rest/v1/user_profiles') return Response.json([])
    assert.ok(path.endsWith('/reserve_photo_analysis'))
    return new Response(null, { status: 400 })
  } })
  assert.equal((await app.request('/api/private/coach', request({ skill: 'cooking', question: 'Par quoi remplacer la crème ?' }), env)).status, 503)
})
