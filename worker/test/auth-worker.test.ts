import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createJournalDay, createJournalState } from '../../src/domain/nutrition/journal.ts'
import { createWorkerApp } from '../src/index.ts'

const userA = '2fa33744-d81b-4403-9482-e6a7af550001'
const userB = '2fa33744-d81b-4403-9482-e6a7af550002'
const recipeId = 'd4e8d688-56e0-4a66-a857-6b4f39d617a1'
const dayId = 'a2d42001-436f-4ac6-9a1a-d231a8eb0001'
const env = {
  SUPABASE_URL: 'https://nutrip.persotest.invalid',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SECRET_KEY: 'sb_secret_test_only',
}
const jwtA = 'e30.e30.sigA'
const jwtB = 'e30.e30.sigB'
const recipeDraft = { id: recipeId, name: 'Porridge', revision: 1, ingredients: [], servings: null, finalWeight: null }
const dayDraft = createJournalDay(createJournalState(), { id: dayId, localDate: '2026-11-04', timeZone: 'UTC' }).days[0]!

function authResponse(token: string): Response {
  const user = token === jwtB ? userB : userA
  return Response.json({ id: user, email: `${user}@example.test`, is_anonymous: false })
}

test('private routes reject missing, expired and anonymous sessions before reading personal data', async () => {
  const calls: URL[] = []
  const app = createWorkerApp({ fetcher: async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input)); calls.push(url)
    return url.pathname.endsWith('/auth/v1/user')
      ? Response.json({ message: 'expired' }, { status: 401 })
      : Response.json([])
  } })
  const missing = await app.request('/api/private/recipes', {}, env)
  assert.equal(missing.status, 401)
  assert.equal(calls.length, 0)
  const expired = await app.request('/api/private/recipes', { headers: { Authorization: 'Bearer e30.e30.sig' } }, env)
  assert.equal(expired.status, 401)
  assert.deepEqual((await expired.json() as { error: { code: string } }).error.code, 'AUTH_INVALID')
  assert.equal(calls.length, 1)

  const anonymousApp = createWorkerApp({ fetcher: async () => Response.json({ id: userA, is_anonymous: true }) })
  const anonymous = await anonymousApp.request('/api/private/session', { headers: { Authorization: 'Bearer e30.e30.sig' } }, env)
  assert.equal(anonymous.status, 403)
  assert.equal((await anonymous.json() as { error: { code: string } }).error.code, 'AUTH_FORBIDDEN')
})

test('Auth service failures fail closed with 503 and no personal adapter call', async () => {
  let dataApiCalls = 0
  const app = createWorkerApp({ fetcher: async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname.endsWith('/auth/v1/user')) return Response.json({ message: 'unavailable' }, { status: 503 })
    dataApiCalls += 1
    return Response.json([])
  } })
  const response = await app.request('/api/private/journal/' + dayId, { headers: { Authorization: 'Bearer e30.e30.sig' } }, env)
  assert.equal(response.status, 503)
  assert.equal(dataApiCalls, 0)
})

test('authenticated identity comes only from Supabase Auth and is passed to both persistence adapters', async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = []
  const app = createWorkerApp({ fetcher: async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)); calls.push({ url, init })
    if (url.pathname.endsWith('/auth/v1/user')) {
      assert.equal(new Headers(init.headers).get('apikey'), env.SUPABASE_PUBLISHABLE_KEY)
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${jwtA}`)
      return authResponse(jwtA)
    }
    assert.equal(new Headers(init.headers).get('apikey'), env.SUPABASE_SECRET_KEY)
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${env.SUPABASE_SECRET_KEY}`)
    if (url.pathname.endsWith('/rpc/save_recipe_draft')) {
      const body = JSON.parse(String(init.body)) as { p_user_id: string; p_draft: unknown; p_expected_revision: number }
      assert.equal(body.p_user_id, userA)
      assert.equal(body.p_expected_revision, 0)
      return Response.json([{ user_id: userA, draft: body.p_draft }])
    }
    if (url.pathname.endsWith('/rpc/save_journal_day_draft')) {
      const body = JSON.parse(String(init.body)) as { p_user_id: string; p_draft: unknown; p_expected_revision: number }
      assert.equal(body.p_user_id, userA)
      assert.equal(body.p_expected_revision, 0)
      return Response.json([{ user_id: userA, draft: body.p_draft }])
    }
    return Response.json({ message: 'unexpected' }, { status: 404 })
  } })

  const recipeResponse = await app.request(`/api/private/recipes/${recipeId}/draft`, {
    method: 'PUT', headers: { Authorization: `Bearer ${jwtA}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft: recipeDraft, expectedRevision: 0, user_id: userB }),
  }, env)
  assert.equal(recipeResponse.status, 403)
  assert.equal(calls.length, 1)

  const recipeSave = await app.request(`/api/private/recipes/${recipeId}/draft`, {
    method: 'PUT', headers: { Authorization: `Bearer ${jwtA}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft: recipeDraft, expectedRevision: 0 }),
  }, env)
  assert.equal(recipeSave.status, 200)
  assert.deepEqual((await recipeSave.json() as { draft: typeof recipeDraft }).draft, recipeDraft)

  const journalSave = await app.request(`/api/private/journal/${dayId}/draft`, {
    method: 'PUT', headers: { Authorization: `Bearer ${jwtA}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft: dayDraft, expectedRevision: 0 }),
  }, env)
  assert.equal(journalSave.status, 200)
  assert.equal((await journalSave.json() as { draft: { id: string } }).draft.id, dayId)
  assert.equal(calls.filter(({ url }) => url.pathname.endsWith('/auth/v1/user')).length, 3)
  assert.equal(calls.filter(({ url }) => url.pathname.includes('/rpc/')).length, 2)
})

test('cross-user reads are indistinguishable from missing rows and remain scoped in Data API filters', async () => {
  const calls: URL[] = []
  const app = createWorkerApp({ fetcher: async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)); calls.push(url)
    if (url.pathname.endsWith('/auth/v1/user')) {
      const token = new Headers(init.headers).get('authorization')?.slice('Bearer '.length) ?? ''
      return authResponse(token)
    }
    if (url.pathname.endsWith('/recipes')) {
      const requestedUser = url.searchParams.get('user_id')?.slice('eq.'.length)
      const requestedRecipe = url.searchParams.get('id')?.slice('eq.'.length)
      assert.ok(requestedUser === userA || requestedUser === userB)
      if (requestedRecipe !== recipeId || requestedUser !== userB) return Response.json([])
      return Response.json([{ user_id: userB, draft: recipeDraft }])
    }
    return Response.json([])
  } })
  const response = await app.request(`/api/private/recipes/${recipeId}`, { headers: { Authorization: `Bearer ${jwtA}` } }, env)
  assert.equal(response.status, 404)
  const ownerResponse = await app.request(`/api/private/recipes/${recipeId}`, { headers: { Authorization: `Bearer ${jwtB}` } }, env)
  assert.equal(ownerResponse.status, 200)
  const reads = calls.filter((url) => url.pathname.endsWith('/recipes'))
  assert.equal(reads.length, 2)
  assert.equal(reads[0]?.searchParams.get('user_id'), `eq.${userA}`)
  assert.equal(reads[1]?.searchParams.get('user_id'), `eq.${userB}`)
})
