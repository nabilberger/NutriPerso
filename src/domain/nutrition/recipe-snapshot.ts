import { NutritionError, type NutrientCode, type NutrientDatum, type NutrientSource, type NutrientTotal } from './types.ts'
import { NUTRIENT_CODES, type MissingNutrientReason, type NutrientComponent, type ContributionOrigin, type ContributionProvenance } from './types.ts'
import { aggregateNutrients } from './aggregate-nutrients.ts'
import type { RecipeCalculation, RecipeDraft } from './recipes.ts'
import type { EdibleYieldConversion, FoodPortionEquivalence } from './portions.ts'

export type ConfirmedRecipeSnapshot = {
  readonly schemaVersion: '1'
  readonly snapshotId: string
  readonly engineVersion: string
  readonly confirmedAt: string
  readonly recipe: {
    readonly id: string
    readonly name: string
    readonly revision: number
    readonly servings: string | null
    readonly finalWeight: RecipeDraft['finalWeight']
  }
  readonly allocation: RecipeCalculation['allocation']
  readonly referenceTotals: readonly ConfirmedRecipeNutrientTotal[]
  readonly ingredients: readonly ConfirmedRecipeIngredientSnapshot[]
  readonly totals: readonly ConfirmedRecipeNutrientTotal[]
}

export type ConfirmedRecipeIngredientSnapshot = {
  readonly ingredientId: string
  readonly food: {
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
  }
  readonly enteredQuantity: RecipeCalculation['ingredients'][number]['enteredQuantity']
  readonly resolvedQuantity:
    | {
        readonly status: 'resolved'
        readonly exactNumerator: string
        readonly exactDenominator: string
        readonly unit: 'g' | 'ml'
        readonly weightNature: 'edible' | 'gross' | 'unknown' | 'not-applicable'
        readonly edibleNumerator: string | null
        readonly edibleDenominator: string | null
        readonly yieldConversion: EdibleYieldConversion | null
      }
    | { readonly status: 'unknown'; readonly reason: string; readonly equivalenceId: string }
  readonly equivalenceSnapshot: FoodPortionEquivalence | null
  readonly sourceNutrients: readonly NutrientDatum[]
  readonly nutrients: readonly ConfirmedIngredientNutrient[]
}

export type ConfirmedIngredientNutrient = {
  readonly datum: NutrientDatum
  readonly contribution:
    | { readonly status: 'complete'; readonly numerator: string; readonly denominator: string; readonly unit: 'kcal' | 'g'; readonly source: NutrientSource }
    | { readonly status: 'partial'; readonly numerator: string; readonly denominator: string; readonly unit: 'kcal' | 'g'; readonly missing: readonly MissingNutrientReason[]; readonly provenance: ContributionProvenance; readonly origin: ContributionOrigin }
    | { readonly status: 'unknown'; readonly reason: string; readonly unit: 'kcal' | 'g'; readonly source: NutrientSource | null; readonly origin?: ContributionOrigin }
}

export type ConfirmedRecipeNutrientTotal = {
  readonly code: NutrientCode
  readonly status: NutrientTotal['status']
  readonly unit: 'kcal' | 'g'
  readonly displayedValue: string | null
  readonly exactNumerator: string | null
  readonly exactDenominator: string | null
  readonly missing: readonly MissingNutrientReason[]
}

export function createConfirmedRecipeSnapshot(
  recipe: RecipeDraft,
  calculation: RecipeCalculation,
  engineVersion: string,
  confirmedAt: string,
  snapshotId = `${recipe.id}@${recipe.revision}:${engineVersion}:${confirmedAt}`,
): ConfirmedRecipeSnapshot {
  if (!snapshotId.trim() || !engineVersion.trim() || !Number.isFinite(Date.parse(confirmedAt))) {
    throw new NutritionError('INVALID_RECIPE', 'La version du moteur et la date de confirmation sont requises.')
  }
  if (calculation.recipeId !== recipe.id || calculation.recipeRevision !== recipe.revision) {
    throw new NutritionError('INVALID_RECIPE', 'Le calcul ne correspond plus à la version courante de la recette.')
  }

  const ingredients: ConfirmedRecipeIngredientSnapshot[] = calculation.ingredients.map((ingredient) => {
    const datumByCode = new Map<NutrientCode, NutrientDatum>()
    for (const datum of ingredient.food.nutrients) datumByCode.set(datum.code, datum)
    const nutrients: ConfirmedIngredientNutrient[] = []
    for (const [rawCode, contribution] of Object.entries(ingredient.contributions)) {
      const code = rawCode as NutrientCode
      if (!contribution) continue
      const allMatchingData = ingredient.food.nutrients.filter((candidate) => candidate.code === code)
      const contributionSource = 'source' in contribution ? contribution.source : undefined
      const matchingSourceDatum = contributionSource
        ? allMatchingData.find((candidate) => candidate.source?.sourceType === contributionSource.sourceType
          && candidate.source?.nutrientSourceId === contributionSource.nutrientSourceId
          && candidate.source?.sourceReference === contributionSource.sourceReference)
        : undefined
      const datum = matchingSourceDatum ?? datumByCode.get(code) ?? ({ status: 'missing', code, reason: 'not-reported' } as const)
      if (contribution.status === 'complete') {
        const complete: ConfirmedIngredientNutrient = {
          datum,
          contribution: {
            status: 'complete',
            numerator: contribution.exactValue.numerator.toString(),
            denominator: contribution.exactValue.denominator.toString(),
            unit: contribution.unit,
            source: contribution.source,
          },
        }
        nutrients.push(complete)
      } else if (contribution.status === 'partial') {
        nutrients.push({
          datum,
          contribution: {
            status: 'partial',
            numerator: contribution.exactKnownSubtotal.numerator.toString(),
            denominator: contribution.exactKnownSubtotal.denominator.toString(),
            unit: contribution.unit,
            missing: contribution.missing,
            provenance: contribution.provenance,
            origin: contribution.origin,
          },
        })
      } else {
        const unknownNutrient: ConfirmedIngredientNutrient = {
          datum,
          contribution: {
            status: 'unknown',
            reason: contribution.reason,
            unit: contribution.unit,
            source: contribution.source ?? null,
            ...(contribution.origin ? { origin: contribution.origin } : {}),
          },
        }
        nutrients.push(unknownNutrient)
      }
    }
    const resolved = ingredient.resolvedQuantity
    return {
      ingredientId: ingredient.ingredientId,
      food: {
        foodId: ingredient.food.foodId,
        sourceType: ingredient.food.sourceType,
        fdcId: ingredient.food.fdcId,
        description: ingredient.food.description,
        category: ingredient.food.category,
        dataType: ingredient.food.dataType,
        brandOwner: ingredient.food.brandOwner,
        sourceName: ingredient.food.sourceName,
        sourceReference: ingredient.food.sourceReference,
        sourceNotes: ingredient.food.sourceNotes,
      },
      enteredQuantity: ingredient.enteredQuantity,
      resolvedQuantity: resolved.status === 'resolved'
        ? {
            status: 'resolved',
            exactNumerator: resolved.exactAmount.numerator.toString(),
            exactDenominator: resolved.exactAmount.denominator.toString(),
            unit: resolved.unit,
            weightNature: resolved.weightNature,
            edibleNumerator: resolved.edibleAmount?.numerator.toString() ?? null,
            edibleDenominator: resolved.edibleAmount?.denominator.toString() ?? null,
            yieldConversion: resolved.yieldConversion ?? null,
          }
        : { status: 'unknown', reason: resolved.reason, equivalenceId: resolved.equivalenceId },
      equivalenceSnapshot: ingredient.equivalenceSnapshot,
      sourceNutrients: ingredient.food.nutrients,
      nutrients,
    }
  })

  const totals = Object.entries(calculation.totals).flatMap(([rawCode, total]) => {
    if (!total) return []
    const code = rawCode as NutrientCode
    return [serializeTotal(code, total)]
  })
  const referenceComponents: NutrientComponent[] = calculation.ingredients.map((ingredient) => ({
    itemId: ingredient.ingredientId,
    nutrients: ingredient.contributions,
  }))
  const referenceTotals = Object.entries(aggregateNutrients(referenceComponents, NUTRIENT_CODES, { includeExact: true }))
    .flatMap(([rawCode, total]) => total ? [serializeTotal(rawCode as NutrientCode, total)] : [])

  const snapshot: ConfirmedRecipeSnapshot = {
    schemaVersion: '1',
    snapshotId,
    engineVersion,
    confirmedAt,
    recipe: {
      id: recipe.id,
      name: recipe.name,
      revision: recipe.revision,
      servings: recipe.servings,
      finalWeight: recipe.finalWeight,
    },
    allocation: calculation.allocation,
    referenceTotals,
    ingredients,
    totals,
  }
  return deepFreeze(clonePlain(snapshot))
}

function serializeTotal(code: NutrientCode, total: NutrientTotal): ConfirmedRecipeNutrientTotal {
  if (total.status === 'complete') {
    return {
      code, status: total.status, unit: total.unit, displayedValue: total.value,
      exactNumerator: total.exactValue?.numerator ?? null,
      exactDenominator: total.exactValue?.denominator ?? null,
      missing: [],
    }
  }
  if (total.status === 'partial') {
    return {
      code, status: total.status, unit: total.unit, displayedValue: total.knownSubtotal,
      exactNumerator: total.exactKnownSubtotal?.numerator ?? null,
      exactDenominator: total.exactKnownSubtotal?.denominator ?? null,
      missing: total.missing,
    }
  }
  return { code, status: total.status, unit: total.unit, displayedValue: null, exactNumerator: null, exactDenominator: null, missing: total.missing }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  }
  return value
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
