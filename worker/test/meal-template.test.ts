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
