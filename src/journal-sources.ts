import type { JournalDayDraft } from './domain/nutrition/journal.ts'
import type { FoodNutritionSnapshot } from './domain/nutrition/recipes.ts'
import { usdaDetailToFoodSnapshot, type UsdaFoodDetailForNutrition } from './domain/nutrition/usda-food-snapshot.ts'

export async function loadFoodSources(
  day: JournalDayDraft,
  cached: Readonly<Record<string, FoodNutritionSnapshot>>,
  isActive: () => boolean,
  fetcher: typeof fetch = fetch,
): Promise<Readonly<Record<string, FoodNutritionSnapshot>>> {
  const ids = [...new Set(day.meals.flatMap((meal) => meal.items.flatMap((item) =>
    item.kind === 'food' && !cached[item.foodId] && !item.pinnedFoodSnapshot ? [item.foodId] : [])))]
  const entries = await Promise.all(ids.map(async (foodId) => {
    const match = /^usda:(\d+)$/.exec(foodId)
    if (!match) return null
    try {
      const response = await fetcher('/api/foods/' + match[1], { cache: 'no-store' })
      if (!response.ok) return null
      const detail = await response.json() as UsdaFoodDetailForNutrition
      return [foodId, usdaDetailToFoodSnapshot(detail)] as const
    } catch { return null }
  }))
  return isActive()
    ? { ...cached, ...Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null)) }
    : cached
}
