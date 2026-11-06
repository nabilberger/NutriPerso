import { requestPrivateJson } from './auth/client'
import { requestFoodCatalog } from './catalog-client'
import { usdaDetailToFoodSnapshot, type UsdaFoodDetailForNutrition } from './domain/nutrition/usda-food-snapshot.ts'
import type { FoodNutritionSnapshot } from './domain/nutrition/recipes.ts'
export async function loadRecipeFood(id: string): Promise<FoodNutritionSnapshot> {
  if (id.startsWith('catalog:') || /^[0-9a-f-]{36}$/i.test(id)) {
    const food = (await requestPrivateJson<{ food: FoodNutritionSnapshot }>('/api/private/catalog/' + encodeURIComponent(id.startsWith('catalog:') ? id.slice(8) : id))).food
    return { ...food, foodId: id }
  }
  const match = /^usda:(\d+)$/.exec(id)
  if (!match) throw new Error('Source alimentaire non prise en charge.')
  const response = await requestFoodCatalog('/api/foods/' + match[1])
  if (!response.ok) throw new Error('Fiche USDA indisponible. Réessayez sans fermer votre recette.')
  return usdaDetailToFoodSnapshot(await response.json() as UsdaFoodDetailForNutrition)
}
