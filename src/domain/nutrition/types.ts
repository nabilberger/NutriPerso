import type { ExactFraction } from './decimal.ts'

export const NUTRIENT_CODES = ['energy', 'protein', 'carbohydrate', 'fat', 'fiber'] as const
export type NutrientCode = typeof NUTRIENT_CODES[number]

export type NutrientSourceUnit = 'kcal' | 'kJ' | 'g' | 'mg' | 'ug' | 'µg' | 'μg'
export type CanonicalNutrientUnit = 'kcal' | 'g'
export type BasisUnit = 'g' | 'ml'

export type BasisSource = 'fdc_data_type' | 'fdc_branded_standardization' | 'source_documentation' | 'manual'

export type ReferenceBasis = {
  readonly amount: string
  readonly unit: BasisUnit
  readonly source: BasisSource
}

export type NutrientSource = {
  readonly sourceType: 'usda' | 'local' | 'custom'
  readonly sourceName: string | null
  readonly sourceReference: string | null
  readonly nutrientSourceId: number | null
}

export type NutrientDatum =
  | {
      readonly status: 'reported'
      readonly code: NutrientCode
      readonly sourceValue: string
      readonly sourceUnit: NutrientSourceUnit
      readonly basis: ReferenceBasis | null
      readonly source: NutrientSource
    }
  | {
      readonly status: 'missing'
      readonly code: NutrientCode
      readonly reason: 'not-reported' | 'invalid-source-value'
      readonly source?: NutrientSource
    }

export type QuantityUnit = 'ug' | 'µg' | 'μg' | 'mg' | 'g' | 'kg' | 'ml' | 'l'

export type CalculationUnknownReason =
  | 'nutrient-not-reported'
  | 'invalid-source-value'
  | 'reference-basis-unknown'
  | 'incompatible-basis-unit'
  | 'unsupported-nutrient-unit'
  | 'no-contributions'
  | 'portion-equivalence-not-found'
  | 'portion-equivalence-unvalidated'
  | 'portion-equivalence-food-mismatch'
  | 'portion-equivalence-unit-mismatch'
  | 'gross-weight-without-edible-conversion'
  | 'weight-nature-unknown'

export type ContributionOrigin =
  | { readonly kind: 'food-snapshot'; readonly foodId: string; readonly snapshotId: string }
  | { readonly kind: 'recipe-snapshot'; readonly recipeId: string; readonly snapshotId: string; readonly recipeVersion: number }
  | { readonly kind: 'meal-snapshot'; readonly logicalMealId: string; readonly snapshotId: string }

export type ContributionProvenance = {
  readonly sources: readonly NutrientSource[]
  readonly origins: readonly ContributionOrigin[]
}

export type MissingNutrientReason = MissingNutrientContribution & {
  readonly path?: readonly string[]
  readonly origin?: ContributionOrigin
}

export type NutrientContribution =
  | {
      readonly status: 'complete'
      readonly code: NutrientCode
      readonly exactValue: ExactFraction
      readonly unit: CanonicalNutrientUnit
      readonly source: NutrientSource
      readonly provenance?: ContributionProvenance
      readonly origin?: ContributionOrigin
    }
  | {
      readonly status: 'partial'
      readonly code: NutrientCode
      readonly exactKnownSubtotal: ExactFraction
      readonly unit: CanonicalNutrientUnit
      readonly missing: readonly MissingNutrientReason[]
      readonly provenance: ContributionProvenance
      readonly origin: ContributionOrigin
    }
  | {
      readonly status: 'unknown'
      readonly code: NutrientCode
      readonly unit: CanonicalNutrientUnit
      readonly reason: CalculationUnknownReason
      readonly missing?: readonly MissingNutrientReason[]
      readonly source?: NutrientSource
      readonly origin?: ContributionOrigin
      readonly provenance?: ContributionProvenance
    }

export type NutrientComponent = {
  readonly itemId: string
  readonly nutrients: Partial<Record<NutrientCode, NutrientContribution>>
}

export type MissingNutrientContribution = {
  readonly itemId: string | null
  readonly reason: CalculationUnknownReason
}

export type SerializedExactFraction = {
  readonly numerator: string
  readonly denominator: string
}

/** Returned amounts are decimal strings quantized only at the aggregate result boundary. */
export type NutrientTotal =
  | { readonly status: 'complete'; readonly code: NutrientCode; readonly value: string; readonly unit: CanonicalNutrientUnit; readonly exactValue?: SerializedExactFraction }
  | { readonly status: 'partial'; readonly code: NutrientCode; readonly knownSubtotal: string; readonly unit: CanonicalNutrientUnit; readonly missing: readonly MissingNutrientReason[]; readonly exactKnownSubtotal?: SerializedExactFraction }
  | { readonly status: 'unknown'; readonly code: NutrientCode; readonly unit: CanonicalNutrientUnit; readonly missing: readonly MissingNutrientReason[] }

export type NutritionErrorCode =
  | 'INVALID_QUANTITY'
  | 'INVALID_REFERENCE_BASIS'
  | 'NEGATIVE_NUTRIENT_VALUE'
  | 'DUPLICATE_NUTRIENT'
  | 'DUPLICATE_COMPONENT'
  | 'NUTRIENT_CODE_MISMATCH'
  | 'NUTRIENT_UNIT_MISMATCH'
  | 'TOO_MANY_COMPONENTS'
  | 'INVALID_PORTION_EQUIVALENCE'
  | 'INVALID_RECIPE'
  | 'RECIPE_INGREDIENT_NOT_FOUND'
  | 'FOOD_SNAPSHOT_NOT_FOUND'
  | 'INVALID_RECIPE_ALLOCATION'
  | 'INVALID_AGGREGATE_MULTIPLIER'
  | 'INVALID_PARTIAL_CONTRIBUTION'
  | 'INVALID_JOURNAL'
  | 'JOURNAL_DAY_NOT_FOUND'
  | 'JOURNAL_MEAL_NOT_FOUND'
  | 'JOURNAL_ITEM_NOT_FOUND'
  | 'JOURNAL_SOURCE_NOT_FOUND'
  | 'JOURNAL_HISTORY_CONFLICT'
  | 'JOURNAL_HISTORY_INVALID'
  | 'DUPLICATE_SNAPSHOT'

export class NutritionError extends Error {
  readonly code: NutritionErrorCode

  constructor(code: NutritionErrorCode, message: string) {
    super(message)
    this.name = 'NutritionError'
    this.code = code
  }
}
