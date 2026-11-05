import assert from 'node:assert/strict'
import test from 'node:test'
import { listMealTemplates, saveMealTemplate, MealTemplateError } from '../src/supabase-meal-templates.ts'

const env = { SUPABASE_URL: 'https://db.example.test', SUPABASE_SECRET_KEY: 'secret' }
const id = '00000000-0000-4000-8000-000000000001'
const row = { id, user_id: 'user-a', name: 'Déjeuner', revision: 1,
  template: { id, name: 'Déjeuner', revision: 1, meal: { kind: 'lunch', items: [] } },
  created_at: '2026-11-06T00:00:00.000Z', updated_at: '2026-11-06T00:00:00.000Z' }

test('meal template listing is scoped to the authenticated owner', async () => {
  let requested = ''
  const result = await listMealTemplates(env, { userId: 'user-a' }, (async (input) => {
    requested = String(input)
    return Response.json([row])
  }) as typeof fetch)
  assert.equal(new URL(requested).searchParams.get('user_id'), 'eq.user-a')
  assert.equal(result[0]?.name, 'Déjeuner')
})

test('meal template listing rejects any foreign-owner row defensively', async () => {
  await assert.rejects(() => listMealTemplates(env, { userId: 'user-a' }, (async () => Response.json([{ ...row, user_id: 'user-b' }])) as typeof fetch),
    (error: unknown) => error instanceof MealTemplateError)
})

test('template edits require a monotonically increasing expected revision', async () => {
  await assert.rejects(() => saveMealTemplate(env, { userId: 'user-a' },
    { id, name: 'Déjeuner', revision: 3, meal: {} }, 1, (async () => Response.json([row])) as typeof fetch),
    (error: unknown) => error instanceof MealTemplateError && error.status === 409)
})

test('template and immutable revision are submitted through one atomic RPC', async () => {
  let calls = 0
  const bodies: Record<string, unknown>[] = []
  const result = await saveMealTemplate(env, { userId: 'user-a' },
    { id, name: 'Déjeuner', revision: 1, meal: { items: [] } }, null,
    (async (input, init) => {
      calls += 1
      assert.equal(new URL(String(input)).pathname, '/rest/v1/rpc/save_meal_template_atomic')
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return Response.json([row])
    }) as typeof fetch)
  assert.equal(calls, 1)
  assert.equal(bodies[0]?.p_expected_revision, null)
  assert.equal(result.revision, 1)
})

test('failed atomic RPC cannot leave a template row written by a preceding request', async () => {
  let calls = 0
  await assert.rejects(() => saveMealTemplate(env, { userId: 'user-a' },
    { id, name: 'Déjeuner', revision: 1, meal: { items: [] } }, null,
    (async () => { calls += 1; return new Response('database unavailable', { status: 503 }) }) as typeof fetch),
    (error: unknown) => error instanceof MealTemplateError)
  assert.equal(calls, 1)
})

test('database revision conflict is surfaced without accepting a stale edit', async () => {
  await assert.rejects(() => saveMealTemplate(env, { userId: 'user-a' },
    { id, name: 'Déjeuner', revision: 2, meal: { items: [] } }, 1,
    (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      assert.equal(body.p_expected_revision, 1)
      return new Response('revision conflict', { status: 409 })
    }) as typeof fetch),
    (error: unknown) => error instanceof MealTemplateError && error.status === 409)
})
