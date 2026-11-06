import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConfirmedMealSnapshot } from '../../src/domain/nutrition/journal.ts'
import { filterMealHistory, paginateMealHistory } from '../src/meal-history.ts'

const meal = (id: string, date: string, status: 'confirmed' | 'void', label: string) =>
  ({ snapshotId: id, localDate: date, status, label, confirmedAt: date + 'T12:00:00Z', items: [] }) as unknown as ConfirmedMealSnapshot

test('history filters dates and text, sorts newest first, and excludes void snapshots', () => {
  const result = filterMealHistory([
    meal('old', '2026-11-01', 'confirmed', 'Petit-déjeuner'),
    meal('new', '2026-11-03', 'confirmed', 'Déjeuner'),
    meal('void', '2026-11-04', 'void', 'Déjeuner'),
  ], { query: 'dejeuner', from: '2026-11-02', to: '2026-11-04' })
  assert.deepEqual(result.map((item) => item.snapshotId), ['new'])
})

test('history pagination is bounded and reports total filtered rows', () => {
  const rows = Array.from({ length: 125 }, (_, i) => meal(String(i), '2026-11-01', 'confirmed', 'Repas'))
  const page = paginateMealHistory(rows, 20, 1000)
  assert.equal(page.total, 125)
  assert.equal(page.offset, 20)
  assert.equal(page.limit, 100)
  assert.equal(page.meals.length, 100)
})
