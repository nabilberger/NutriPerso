import type { ConfirmedMealSnapshot } from '../../src/domain/nutrition/journal.ts'

export type MealHistoryFilter = { readonly query?: string; readonly from?: string; readonly to?: string }
export function filterMealHistory(snapshots: readonly ConfirmedMealSnapshot[], filter: MealHistoryFilter): ConfirmedMealSnapshot[] {
  const query = filter.query?.trim().toLocaleLowerCase() ?? ''
  return snapshots.filter((snapshot) => snapshot.status === 'confirmed'
    && (!filter.from || snapshot.localDate >= filter.from) && (!filter.to || snapshot.localDate <= filter.to)
    && (!query || [snapshot.label ?? '', ...snapshot.items.map((item) => item.kind === 'food'
      ? item.foodSnapshot.description : item.recipeSnapshot.recipe.name)].join(' ').toLocaleLowerCase().includes(query)))
    .sort((a, b) => b.localDate.localeCompare(a.localDate) || b.confirmedAt.localeCompare(a.confirmedAt))
}
export function paginateMealHistory(snapshots: readonly ConfirmedMealSnapshot[], offset: number, limit: number) {
  const safeOffset = Math.max(0, Math.floor(offset))
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)))
  return { meals: snapshots.slice(safeOffset, safeOffset + safeLimit), total: snapshots.length, offset: safeOffset, limit: safeLimit }
}
