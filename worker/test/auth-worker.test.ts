import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addFoodJournalItem, createJournalDay, createJournalState, createMeal } from '../../src/domain/nutrition/journal.ts'
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

test('profile and weight routes reject client ownership and persist only under the verified JWT identity', async () => {
  const writes: Array<{ table: string; row: Record<string, unknown> }> = []
  const app = createWorkerApp({ fetcher: async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname.endsWith('/auth/v1/user')) return authResponse(jwtA)
    const table = url.pathname.endsWith('/user_profiles') ? 'user_profiles' : 'body_measurements'
    const row = JSON.parse(String(init.body)) as Record<string, unknown>
    writes.push({ table, row })
    return Response.json([{ ...row, id: row.id ?? userA, fasting_start: row.fasting_start, fasting_end: row.fasting_end }])
  } })
  const auth = { Authorization: `Bearer ${jwtA}`, 'Content-Type': 'application/json' }
  const profile = {
    displayName: 'Invité', avatarDataUrl: null, heightCm: null, targetWeightKg: null, goal: 'maintain',
    dietaryPattern: 'other', mealsPerDay: 2, fastingEnabled: false, fastingStart: null, fastingEnd: null,
    avoidAddedSalt: false, avoidAddedSugar: false, notes: '', timeZone: 'Africa/Casablanca',
  }
  const forgedProfile = await app.request('/api/private/profile', { method: 'PUT', headers: auth, body: JSON.stringify({ ...profile, user_id: userB }) }, env)
  const forgedMeasurement = await app.request('/api/private/measurements', { method: 'POST', headers: auth, body: JSON.stringify({ measuredOn: '2026-11-04', weightKg: 75, userId: userB }) }, env)
  assert.equal(forgedProfile.status, 403)
  assert.equal(forgedMeasurement.status, 403)
  assert.equal(writes.length, 0)

  const savedProfile = await app.request('/api/private/profile', { method: 'PUT', headers: auth, body: JSON.stringify(profile) }, env)
  const savedMeasurement = await app.request('/api/private/measurements', { method: 'POST', headers: auth, body: JSON.stringify({ measuredOn: '2026-11-04', weightKg: 75, note: '' }) }, env)
  assert.equal(savedProfile.status, 200)
  assert.equal(savedMeasurement.status, 201)
  assert.deepEqual(writes.map(({ table, row }) => [table, row.user_id]), [['user_profiles', userA], ['body_measurements', userA]])
})


test('private journal confirmation fetches full USDA detail and ignores no client nutrition totals', async () => {
  const dayWithMeal = createMeal(createJournalDay(createJournalState(), {
    id: dayId, localDate: '2026-11-04', timeZone: 'UTC',
  }), dayId, { id: 'meal-usda', kind: 'lunch', occurredAt: '2026-11-04T12:00:00Z' })
  const draft = addFoodJournalItem(dayWithMeal, dayId, 'meal-usda', {
    id: 'item-usda', foodId: 'usda:2706091',
    quantity: { kind: 'physical', amount: '100', unit: 'g', weightNature: 'edible' }, sortOrder: 0,
  }).days[0]!
  const calls: string[] = []
  let storedSnapshot: Record<string, unknown> | null = null
  const app = createWorkerApp({ fetcher: async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push(url.pathname)
    if (url.pathname.endsWith('/auth/v1/user')) return authResponse(jwtA)
    if (url.hostname === 'api.nal.usda.gov') {
      assert.equal(url.pathname, '/fdc/v1/food/2706091')
      return Response.json({
        fdcId: 2706091, description: 'Chicken, ground', dataType: 'Survey (FNDDS)', foodCategory: 'Poultry',
        foodNutrients: [
          { nutrient: { id: 1008, name: 'Energy', unitName: 'kcal' }, amount: 201 },
          { nutrient: { id: 1003, name: 'Protein', unitName: 'g' }, amount: 27.1 },
          { nutrient: { id: 1005, name: 'Carbohydrate', unitName: 'g' }, amount: 0 },
          { nutrient: { id: 1004, name: 'Total lipid', unitName: 'g' }, amount: 10.3 },
          { nutrient: { id: 1079, name: 'Fiber', unitName: 'g' }, amount: 0 },
        ],
      })
    }
    if (url.pathname.endsWith('/journal_days')) {
      const id = url.searchParams.get('id')?.replace(/^eq\./, '')
      return Response.json([{ id: dayId, user_id: userA, draft }].filter((row) => !id || row.id === id).map((row) => ({ draft: row.draft, user_id: row.user_id, id: row.id })))
    }
    if (url.pathname.endsWith('/journal_meal_snapshots')) return Response.json([])
    if (url.pathname.endsWith('/rpc/append_journal_snapshot')) {
      const body = JSON.parse(String(init.body)) as { p_user_id: string; p_snapshot: Record<string, unknown> }
      assert.equal(body.p_user_id, userA)
      storedSnapshot = body.p_snapshot
      return Response.json([{ user_id: userA, snapshot: body.p_snapshot }])
    }
    return Response.json({ message: 'unexpected' }, { status: 404 })
  } })
  const response = await app.request(`/api/private/journal/${dayId}/meals/meal-usda/confirm`, {
    method: 'POST', headers: { Authorization: `Bearer ${jwtA}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshotId: 'journal-usda-snapshot', confirmedAt: '2026-11-04T12:30:00Z', engineVersion: 'nutrition-engine-v1' }),
  }, { ...env, FDC_API_KEY: 'DEMO_KEY' })
  assert.equal(response.status, 200)
  const payload = await response.json() as { snapshot: { status: string; items: Array<{ foodSnapshot: { description: string; nutrients: Array<{ sourceValue?: string }> } }>; totals: Record<string, { status: string; value?: string }> } }
  assert.equal(payload.snapshot.status, 'confirmed')
  assert.equal(payload.snapshot.items[0]?.foodSnapshot.description, 'Chicken, ground')
  assert.equal(payload.snapshot.items[0]?.foodSnapshot.nutrients.find((datum) => datum.sourceValue === '27.1')?.sourceValue, '27.1')
  assert.equal(payload.snapshot.totals.energy?.status, 'complete')
  assert.equal(payload.snapshot.totals.energy?.value, '201.000000')
  assert.equal(payload.snapshot.totals.carbohydrate?.value, '0.000000')
  assert.ok(storedSnapshot)
  assert.ok(calls.indexOf('/fdc/v1/food/2706091') > calls.indexOf('/rest/v1/journal_meal_snapshots'))
  assert.ok(calls.some((path) => path.endsWith('/rpc/append_journal_snapshot')))

  const forgedCalls: string[] = []
  const forgedApp = createWorkerApp({ fetcher: async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input)); forgedCalls.push(url.pathname)
    return url.pathname.endsWith('/auth/v1/user') ? authResponse(jwtA) : Response.json([])
  } })
  const forged = await forgedApp.request(`/api/private/journal/${dayId}/meals/meal-usda/confirm`, {
    method: 'POST', headers: { Authorization: `Bearer ${jwtA}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshotId: 'fake', confirmedAt: '2026-11-04T12:30:00Z', engineVersion: 'nutrition-engine-v1', totals: { energy: 9999 } }),
  }, { ...env, FDC_API_KEY: 'DEMO_KEY' })
  assert.equal(forged.status, 400)
  assert.deepEqual(forgedCalls, ['/auth/v1/user'])
})

test('journal date lookup is authenticated and scopes the date query to the verified user', async () => {
  const calls: URL[] = []
  const app = createWorkerApp({ fetcher: async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)); calls.push(url)
    if (url.pathname.endsWith('/auth/v1/user')) return authResponse(jwtA)
    if (url.pathname.endsWith('/journal_days')) {
      if (url.searchParams.has('local_date')) {
        assert.equal(url.searchParams.get('local_date'), 'eq.2026-11-04')
        assert.equal(url.searchParams.get('user_id'), `eq.${userA}`)
        return Response.json([{ id: dayId, user_id: userA }])
      }
      return Response.json([{ id: dayId, user_id: userA, draft: dayDraft }])
    }
    if (url.pathname.endsWith('/journal_meal_snapshots')) return Response.json([])
    return Response.json({ message: 'unexpected' }, { status: 404 })
  } })
  const response = await app.request('/api/private/journal?date=2026-11-04', { headers: { Authorization: `Bearer ${jwtA}` } }, env)
  assert.equal(response.status, 200)
  assert.equal((await response.json() as { journal: { day: { id: string } } }).journal.day.id, dayId)
  const dateRead = calls.find((url) => url.searchParams.has('local_date'))
  assert.equal(dateRead?.searchParams.get('user_id'), `eq.${userA}`)
})
