import type { FoodQuantityInput, RecipeJournalQuantity } from './domain/nutrition/portions.ts'
import type { MealKind } from './domain/nutrition/journal.ts'

export type MealReuseItem =
  | { readonly kind: 'food'; readonly foodId: string; readonly quantity: FoodQuantityInput; readonly sortOrder: number }
  | { readonly kind: 'recipe'; readonly recipeId: string; readonly quantity: RecipeJournalQuantity; readonly sortOrder: number }

export type MealReuseDTO = {
  readonly sourceKind: 'consumption' | 'template'
  readonly sourceId: string
  readonly label: string | null
  readonly mealKind: MealKind
  readonly items: readonly MealReuseItem[]
}
