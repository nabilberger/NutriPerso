import {
  assertFractionAtMost,
  compareFractions,
  decimalToFraction,
  divideFractions,
  isPositive,
  makeFraction,
  parseDecimal,
  type ExactFraction,
} from './decimal.ts'
import { aggregateNutrients } from './aggregate-nutrients.ts'
import { calculateNutrient, selectEnergyDatum } from './calculate-nutrient.ts'
import {
  resolveFoodQuantity,
  type EdibleYieldConversion,
  type FoodPortionEquivalence,
  type FoodQuantityInput,
  type ResolvedFoodQuantity,
} from './portions.ts'
import { MAX_CONSUMED_QUANTITY } from './units.ts'
import {
  NutritionError,
  NUTRIENT_CODES,
  type CalculationUnknownReason,
  type NutrientCode,
  type NutrientComponent,
  type NutrientContribution,
  type NutrientDatum,
  type NutrientSource,
  type NutrientTotal,
} from './types.ts'

export type RecipeIngredient = {
  readonly id: string
  readonly foodId: string
  readonly quantity: FoodQuantityInput
  readonly position: number
}

export type RecipeDraft = {
  readonly description?: string
  readonly instructions?: string
  readonly archived?: boolean
  readonly id: string
  readonly name: string
  readonly ingredients: readonly RecipeIngredient[]
  readonly servings: string | null
  readonly finalWeight: { readonly amount: string; readonly unit: 'g'; readonly weightNature: 'edible' } | null
  readonly revision: number
}

export type FoodNutritionSnapshot = {
  readonly foodId: string
  readonly sourceType: 'usda' | 'local' | 'custom'
  readonly fdcId: number | null
  readonly description: string
  readonly category: string | null
  readonly dataType: string | null
  readonly brandOwner: string | null
  readonly sourceName: string | null
  readonly sourceReference: string | null
  readonly sourceNotes: string | null
  readonly nutrients: readonly NutrientDatum[]
  readonly portionEquivalences: readonly FoodPortionEquivalence[]
  readonly edibleYieldConversions: readonly EdibleYieldConversion[]
}

export type RecipeAllocation =
  | { readonly kind: 'total' }
  | { readonly kind: 'per-serving' }
  | { readonly kind: 'by-weight'; readonly consumedWeight: { readonly amount: string; readonly unit: 'g'; readonly weightNature: 'edible' } }

export type RecipeCalculation = {
  readonly recipeId: string
  readonly recipeRevision: number
  readonly allocation: RecipeAllocationResult
  readonly ingredients: readonly {
    readonly ingredientId: string
    readonly food: FoodNutritionSnapshot
    readonly enteredQuantity: FoodQuantityInput
    readonly resolvedQuantity: ResolvedFoodQuantity
    readonly equivalenceSnapshot: FoodPortionEquivalence | null
    readonly contributions: NutrientComponent['nutrients']
  }[]
  readonly totals: Partial<Record<NutrientCode, NutrientTotal>>
}

export type RecipeAllocationResult =
  | { readonly kind: 'total' }
  | { readonly kind: 'per-serving'; readonly servings: string }
  | {
      readonly kind: 'by-weight'
      readonly finalWeight: { readonly amount: string; readonly unit: 'g'; readonly weightNature: 'edible' }
      readonly consumedWeight: { readonly amount: string; readonly unit: 'g'; readonly weightNature: 'edible' }
      readonly assumption: 'homogeneous-preparation'
    }

export function createRecipe(input: { readonly id: string; readonly name: string }): RecipeDraft {
  if (!input.id.trim() || !input.name.trim()) throw new NutritionError('INVALID_RECIPE', 'Une recette doit avoir un identifiant et un nom.')
  return { id: input.id, name: input.name.trim(), ingredients: [], servings: null, finalWeight: null, revision: 1 }
}

export function updateRecipeName(recipe: RecipeDraft, name: string): RecipeDraft {
  if (!name.trim()) throw new NutritionError('INVALID_RECIPE', 'Le nom de la recette ne peut pas être vide.')
  return { ...recipe, name: name.trim(), revision: recipe.revision + 1 }
}

export type FoodSnapshotCalculation = {
  readonly resolvedQuantity: ResolvedFoodQuantity
  readonly equivalenceSnapshot: FoodPortionEquivalence | null
  readonly contributions: NutrientComponent['nutrients']
}

export function addRecipeIngredient(recipe: RecipeDraft, ingredient: Omit<RecipeIngredient, 'position'>): RecipeDraft {
  if (!ingredient.id.trim() || !ingredient.foodId.trim() || recipe.ingredients.some((item) => item.id === ingredient.id)) {
    throw new NutritionError('INVALID_RECIPE', 'L’ingrédient doit avoir un identifiant unique et un aliment.')
  }
  return revise(recipe, [...recipe.ingredients, { ...clonePlain(ingredient), position: recipe.ingredients.length }])
}

export function removeRecipeIngredient(recipe: RecipeDraft, ingredientId: string): RecipeDraft {
  if (!recipe.ingredients.some((item) => item.id === ingredientId)) throw new NutritionError('RECIPE_INGREDIENT_NOT_FOUND', 'Ingrédient introuvable.')
  const ingredients = recipe.ingredients.filter((item) => item.id !== ingredientId).map((item, position) => ({ ...item, position }))
  return revise(recipe, ingredients)
}

export function updateRecipeIngredientQuantity(recipe: RecipeDraft, ingredientId: string, quantity: FoodQuantityInput): RecipeDraft {
  if (!recipe.ingredients.some((item) => item.id === ingredientId)) throw new NutritionError('RECIPE_INGREDIENT_NOT_FOUND', 'Ingrédient introuvable.')
  return revise(recipe, recipe.ingredients.map((item) => item.id === ingredientId ? { ...item, quantity: clonePlain(quantity) } : item))
}

export function setRecipeServings(recipe: RecipeDraft, servings: string | null): RecipeDraft {
  if (servings !== null && !isPositive(decimalToFraction(parseDecimal(servings)))) {
    throw new NutritionError('INVALID_RECIPE', 'Le nombre de portions doit être strictement positif.')
  }
  if (servings !== null) assertFractionAtMost(decimalToFraction(parseDecimal(servings)), MAX_CONSUMED_QUANTITY)
  return { ...recipe, servings, revision: recipe.revision + 1 }
}

export function setRecipeFinalWeight(
  recipe: RecipeDraft,
  finalWeight: RecipeDraft['finalWeight'],
): RecipeDraft {
  if (finalWeight && !isPositive(decimalToFraction(parseDecimal(finalWeight.amount)))) {
    throw new NutritionError('INVALID_RECIPE', 'Le poids final comestible doit être strictement positif.')
  }
  if (finalWeight) assertFractionAtMost(decimalToFraction(parseDecimal(finalWeight.amount)), MAX_CONSUMED_QUANTITY)
  return { ...recipe, finalWeight: finalWeight ? clonePlain(finalWeight) : null, revision: recipe.revision + 1 }
}

export function calculateRecipe(
  recipe: RecipeDraft,
  foods: ReadonlyMap<string, FoodNutritionSnapshot>,
  allocation: RecipeAllocation = { kind: 'total' },
): RecipeCalculation {
  const calculatedIngredients = recipe.ingredients.map((ingredient) => {
    const sourceFood = foods.get(ingredient.foodId)
    if (!sourceFood) throw new NutritionError('FOOD_SNAPSHOT_NOT_FOUND', `Aliment introuvable: ${ingredient.foodId}`)
    const food = clonePlain(sourceFood)
    return { ingredient, food, ...calculateFoodSnapshot(food, ingredient.quantity) }
  })

  const multiplier = allocationMultiplier(recipe, allocation)
  const components: NutrientComponent[] = calculatedIngredients.map(({ ingredient, contributions }) => ({
    itemId: ingredient.id,
    nutrients: contributions,
  }))
  const totals = aggregateNutrients(components, NUTRIENT_CODES, { multiplier: multiplier.multiplier, includeExact: true })
  return {
    recipeId: recipe.id,
    recipeRevision: recipe.revision,
    allocation: multiplier.result,
    ingredients: calculatedIngredients.map(({ ingredient, food, resolvedQuantity, equivalenceSnapshot, contributions }) => ({
      ingredientId: ingredient.id,
      food,
      enteredQuantity: clonePlain(ingredient.quantity),
      resolvedQuantity,
      equivalenceSnapshot,
      contributions,
    })),
    totals,
  }
}

/** Shared food calculation path for recipes and journal food entries. */
export function calculateFoodSnapshot(food: FoodNutritionSnapshot, quantity: FoodQuantityInput): FoodSnapshotCalculation {
  const resolvedQuantity = resolveFoodQuantity(food.foodId, quantity, food.portionEquivalences, food.edibleYieldConversions)
  const selectedNutrients = selectNutrients(food.nutrients)
  const contributions: Partial<Record<NutrientCode, NutrientContribution>> = {}
  for (const code of NUTRIENT_CODES) {
    const datum = selectedNutrients.get(code)
    contributions[code] = datum
      ? calculateFoodNutrient(datum, resolvedQuantity)
      : unknownContribution(code, 'nutrient-not-reported')
  }
  let equivalenceSnapshot: FoodPortionEquivalence | null = null
  if (quantity.kind === 'serving') {
    const equivalenceId = quantity.equivalenceId
    equivalenceSnapshot = food.portionEquivalences.find((item) => item.id === equivalenceId) ?? null
  }
  return { resolvedQuantity, equivalenceSnapshot, contributions }
}

function calculateFoodNutrient(datum: NutrientDatum, resolved: ResolvedFoodQuantity): NutrientContribution {
  if (datum.status === 'missing') {
    const reason = datum.reason === 'invalid-source-value' ? 'invalid-source-value' : 'nutrient-not-reported'
    return unknownContribution(datum.code, reason, datum.source)
  }
  if (resolved.status === 'unknown') {
    const reasons = {
      'equivalence-not-found': 'portion-equivalence-not-found',
      'equivalence-unvalidated': 'portion-equivalence-unvalidated',
      'food-mismatch': 'portion-equivalence-food-mismatch',
      'unit-mismatch': 'portion-equivalence-unit-mismatch',
    } as const
    return unknownContribution(datum.code, reasons[resolved.reason], datum.source)
  }
  if (resolved.unit === 'g' && resolved.weightNature === 'unknown') {
    return unknownContribution(datum.code, 'weight-nature-unknown', datum.source)
  }
  if (resolved.unit === 'g' && resolved.weightNature === 'gross') {
    if (!resolved.edibleAmount) return unknownContribution(datum.code, 'gross-weight-without-edible-conversion', datum.source)
    return calculateNutrient(datum, { exactAmount: resolved.edibleAmount, unit: 'g' })
  }
  if (resolved.weightNature === 'edible' && resolved.unit === 'g') {
    return calculateNutrient(datum, { exactAmount: resolved.edibleAmount ?? resolved.exactAmount, unit: 'g' })
  }
  if (resolved.unit === 'ml' && resolved.weightNature === 'not-applicable') {
    return calculateNutrient(datum, { exactAmount: resolved.exactAmount, unit: 'ml' })
  }
  return unknownContribution(datum.code, 'weight-nature-unknown', datum.source)
}

function selectNutrients(nutrients: readonly NutrientDatum[]): Map<NutrientCode, NutrientDatum> {
  const selected = new Map<NutrientCode, NutrientDatum>()
  const energy = selectEnergyDatum(nutrients)
  if (energy) selected.set('energy', energy)
  for (const datum of nutrients) {
    if (datum.code === 'energy') continue
    if (selected.has(datum.code)) throw new NutritionError('DUPLICATE_NUTRIENT', `Plusieurs valeurs source pour ${datum.code}.`)
    selected.set(datum.code, datum)
  }
  return selected
}

function allocationMultiplier(recipe: RecipeDraft, allocation: RecipeAllocation): { multiplier: ExactFraction; result: RecipeAllocationResult } {
  if (allocation.kind === 'total') return { multiplier: makeFraction(1n, 1n), result: { kind: 'total' } }
  if (allocation.kind === 'per-serving') {
    if (!recipe.servings) throw new NutritionError('INVALID_RECIPE_ALLOCATION', 'Le nombre de portions doit être défini.')
    const servings = decimalToFraction(parseDecimal(recipe.servings))
    if (!isPositive(servings)) throw new NutritionError('INVALID_RECIPE_ALLOCATION', 'Le nombre de portions doit être positif.')
    return { multiplier: divideFractions(makeFraction(1n, 1n), servings), result: { kind: 'per-serving', servings: recipe.servings } }
  }
  const finalWeight = recipe.finalWeight
  if (!finalWeight) throw new NutritionError('INVALID_RECIPE_ALLOCATION', 'Le poids final réel de la préparation doit être mesuré.')
  const consumed = decimalToFraction(parseDecimal(allocation.consumedWeight.amount))
  const final = decimalToFraction(parseDecimal(finalWeight.amount))
  assertFractionAtMost(consumed, MAX_CONSUMED_QUANTITY)
  assertFractionAtMost(final, MAX_CONSUMED_QUANTITY)
  if (!isPositive(consumed) || !isPositive(final) || compareFractions(consumed, final) > 0) {
    throw new NutritionError('INVALID_RECIPE_ALLOCATION', 'Le poids consommé doit être positif et ne pas dépasser le poids final.')
  }
  return {
    multiplier: divideFractions(consumed, final),
    result: {
      kind: 'by-weight', finalWeight: clonePlain(finalWeight), consumedWeight: clonePlain(allocation.consumedWeight),
      assumption: 'homogeneous-preparation',
    },
  }
}

function unknownContribution(code: NutrientCode, reason: CalculationUnknownReason, source?: NutrientSource): NutrientContribution {
  return {
    status: 'unknown', code, unit: code === 'energy' ? 'kcal' : 'g', reason,
    ...(source ? { source } : {}),
  }
}

function revise(recipe: RecipeDraft, ingredients: readonly RecipeIngredient[]): RecipeDraft {
  return { ...recipe, ingredients, revision: recipe.revision + 1 }
}

function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => clonePlain(item)) as T
  if (value && typeof value === 'object') {
    const clone: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) clone[key] = clonePlain(nested)
    return clone as T
  }
  return value
}
