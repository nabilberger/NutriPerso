import {PrivateApiError} from './auth/private-json-response'
import type { JournalDayDraft } from './domain/nutrition/journal.ts'
import type { FoodNutritionSnapshot } from './domain/nutrition/recipes.ts'
import { usdaDetailToFoodSnapshot, type UsdaFoodDetailForNutrition } from './domain/nutrition/usda-food-snapshot.ts'
import { uiFixtureMode } from './ui-fixture-mode'
import { getFixtureFoodSource } from './dev-ui-fixtures'

export async function loadFoodSources(
  day: JournalDayDraft,
  cached: Readonly<Record<string, FoodNutritionSnapshot>>,
  isActive: () => boolean,
  fetcher: typeof fetch = fetch,
  personalLoader?: (id:string)=>Promise<FoodNutritionSnapshot>,
): Promise<Readonly<Record<string, FoodNutritionSnapshot>>> {
  if (uiFixtureMode) return resolveFixtureFoodSources(day, cached, isActive)
  const ids = unresolvedFoodIds(day, cached)
  const entries = await Promise.all(ids.map(async (foodId) => {
    if (foodId.startsWith('catalog:') || /^[0-9a-f-]{36}$/i.test(foodId)) {
      try { const load=personalLoader??(await import('./recipe-foods')).loadRecipeFood;return [foodId,await load(foodId)] as const } catch(e) { return e instanceof PrivateApiError && (e.status===403||e.status===404) ? [foodId, null] as const : null }
    }
    const match = /^usda:(\d+)$/.exec(foodId)
    if (!match) return null
    try {
      const response = await fetcher('/api/foods/' + match[1], { cache: 'no-store' })
      if (!response.ok) return null
      const detail = await response.json() as UsdaFoodDetailForNutrition
      return [foodId, usdaDetailToFoodSnapshot(detail)] as const
    } catch { return null }
  }))
  const next: Record<string, FoodNutritionSnapshot> = { ...cached }
  for (const entry of entries) if(entry) { if(entry[1]) next[entry[0]]=entry[1]; else if(cached[entry[0]])next[entry[0]]={...cached[entry[0]]!,nutrients:[],portionEquivalences:[],dataType:'Indisponible'} }
  return isActive() ? next : cached
}

/** Resolves the explicit synthetic catalogue entries used by the isolated UI fixture mode. */
export function resolveFixtureFoodSources(
  day: JournalDayDraft,
  cached: Readonly<Record<string, FoodNutritionSnapshot>>,
  isActive: () => boolean,
): Readonly<Record<string, FoodNutritionSnapshot>> {
  const next: Record<string, FoodNutritionSnapshot> = { ...cached }
  for(const id of unresolvedFoodIds(day,cached)){const food=getFixtureFoodSource(id);if(food)next[id]=food;else if(id.startsWith('catalog:')&&cached[id])next[id]={...cached[id]!,nutrients:[],portionEquivalences:[],dataType:'Indisponible'}}
  return isActive()?next:cached
}

function unresolvedFoodIds(
  day: JournalDayDraft,
  cached: Readonly<Record<string, FoodNutritionSnapshot>>,
): string[] {
  return [...new Set(day.meals.flatMap((meal) => meal.items.flatMap((item) =>
    item.kind === 'food' && (!cached[item.foodId] || item.foodId.startsWith('catalog:') || /^[0-9a-f-]{36}$/i.test(item.foodId)) && !item.pinnedFoodSnapshot ? [item.foodId] : [])))]
}

/** Preserve sources selected by the user while an earlier catalogue refresh was pending. */
export function mergeLoadedFoodSources(before:Readonly<Record<string,FoodNutritionSnapshot>>,current:Readonly<Record<string,FoodNutritionSnapshot>>,loaded:Readonly<Record<string,FoodNutritionSnapshot>>):Readonly<Record<string,FoodNutritionSnapshot>>{
 const next={...current}
 for(const [id,food] of Object.entries(loaded))if(current[id]===before[id])next[id]=food
 return next
}
