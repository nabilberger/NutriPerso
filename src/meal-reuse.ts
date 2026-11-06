import type { FoodQuantityInput } from './domain/nutrition/portions.ts'
import type { RecipeJournalQuantity } from './domain/nutrition/journal.ts'
import type { MealKind } from './domain/nutrition/journal.ts'

export type MealReuseItem =
  | { readonly kind: 'food'; readonly foodId: string; readonly quantity: FoodQuantityInput; readonly sortOrder: number }
  | { readonly kind: 'recipe'; readonly recipeId: string; readonly quantity: RecipeJournalQuantity; readonly sortOrder: number }

export type MealReuseDTO = {
  readonly sourceKind: 'consumption' | 'template' | 'recipe'
  readonly sourceId: string
  readonly label: string | null
  readonly mealKind: MealKind
  readonly items: readonly MealReuseItem[]
}

import {
  addFoodJournalItem, addRecipeJournalItem, createJournalDay, createMeal,
  type JournalState,
} from './domain/nutrition/journal.ts'
import type { ConfirmedRecipeSnapshot } from './domain/nutrition/recipe-snapshot.ts'

export function selectCurrentRecipeSnapshot(snapshots: readonly ConfirmedRecipeSnapshot[], recipeId: string): ConfirmedRecipeSnapshot | null {
  return snapshots.filter((snapshot) => snapshot.recipe.id === recipeId)
    .slice().sort((a, b) => b.recipe.revision - a.recipe.revision || b.confirmedAt.localeCompare(a.confirmedAt))[0] ?? null
}

export function buildMealReuseDraft(
  initial: JournalState,
  dayInput: { readonly id: string; readonly localDate: string; readonly timeZone: string },
  source: MealReuseDTO,
  recipes: Readonly<Record<string, ConfirmedRecipeSnapshot>>,
  makeId: () => string,
): JournalState {
  let state = initial
  if (!state.days.some((day) => day.id === dayInput.id)) state = createJournalDay(state, dayInput)
  state = createMeal(state, dayInput.id, { id: makeId(), kind: source.mealKind, label: source.label, occurredAt: null })
  const mealId = state.days.find((day) => day.id === dayInput.id)!.meals.at(-1)!.id
  for (const item of source.items) {
    const id = makeId()
    if (item.kind === 'food') {
      state = addFoodJournalItem(state, dayInput.id, mealId, { id, foodId: item.foodId, quantity: item.quantity, sortOrder: item.sortOrder })
    } else {
      const recipeSnapshot = recipes[item.recipeId]
      if (!recipeSnapshot || recipeSnapshot.recipe.id !== item.recipeId) throw new Error('Snapshot courant de recette manquant.')
      state = addRecipeJournalItem(state, dayInput.id, mealId, { id, recipeSnapshot, quantity: item.quantity, sortOrder: item.sortOrder })
    }
  }
  return state
}
