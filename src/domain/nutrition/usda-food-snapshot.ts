import { parseDecimal } from './decimal.ts'
import type { FoodNutritionSnapshot } from './recipes.ts'
import type { BasisSource, NutrientCode, NutrientDatum, NutrientSourceUnit } from './types.ts'

export type UsdaFoodDetailForNutrition = {
  readonly fdcId: number
  readonly description: string | null
  readonly dataType: string | null
  readonly foodCategory: string | null
  readonly brandOwner: string | null
  readonly nutrients: readonly {
    readonly id: number | null
    readonly name: string
    readonly unitName: string
    readonly value: string | null
    readonly basis: { readonly quantity: number | string; readonly unit: 'g' | 'ml'; readonly source: string } | null
  }[]
}

const NUTRIENT_CODE_BY_FDC_ID: Readonly<Record<number, NutrientCode>> = {
  1008: 'energy', 2047: 'energy', 2048: 'energy',
  1003: 'protein', 1005: 'carbohydrate', 1004: 'fat', 1079: 'fiber',
}
const BASIS_SOURCES = new Set<BasisSource>(['fdc_data_type', 'fdc_branded_standardization', 'source_documentation', 'manual'])

/** Converts an exact-string USDA detail response to the shared deterministic-engine input. */
export function usdaDetailToFoodSnapshot(detail: UsdaFoodDetailForNutrition): FoodNutritionSnapshot {
  if (!Number.isSafeInteger(detail.fdcId) || detail.fdcId <= 0 || !detail.description?.trim()) {
    throw new TypeError('USDA detail must contain a valid FDC ID and description.')
  }
  const sourceReference = `https://fdc.nal.usda.gov/food-details/${detail.fdcId}/nutrients`
  const nutrients: NutrientDatum[] = []
  for (const nutrient of detail.nutrients) {
    const code = nutrient.id === null ? undefined : NUTRIENT_CODE_BY_FDC_ID[nutrient.id]
    if (!code) continue
    const source = { sourceType: 'usda' as const, sourceName: 'USDA FoodData Central', sourceReference, nutrientSourceId: nutrient.id }
    const sourceUnit = normalizeUnit(nutrient.unitName)
    const basis = nutrient.basis && Number.isFinite(Number(nutrient.basis.quantity)) && Number(nutrient.basis.quantity) > 0
      && (nutrient.basis.unit === 'g' || nutrient.basis.unit === 'ml') && BASIS_SOURCES.has(nutrient.basis.source as BasisSource)
      ? { amount: String(nutrient.basis.quantity), unit: nutrient.basis.unit, source: nutrient.basis.source as BasisSource }
      : null
    if (typeof nutrient.value !== 'string' || !sourceUnit) {
      nutrients.push({ status: 'missing', code, reason: nutrient.value === null ? 'not-reported' : 'invalid-source-value', source })
      continue
    }
    try { parseDecimal(nutrient.value) } catch {
      nutrients.push({ status: 'missing', code, reason: 'invalid-source-value', source })
      continue
    }
    nutrients.push({ status: 'reported', code, sourceValue: nutrient.value, sourceUnit, basis, source })
  }
  return {
    foodId: `usda:${detail.fdcId}`,
    sourceType: 'usda',
    fdcId: detail.fdcId,
    description: detail.description.trim(),
    category: detail.foodCategory,
    dataType: detail.dataType,
    brandOwner: detail.brandOwner,
    sourceName: 'USDA FoodData Central',
    sourceReference,
    sourceNotes: null,
    nutrients,
    portionEquivalences: [],
    edibleYieldConversions: [],
  }
}

function normalizeUnit(value: string): NutrientSourceUnit | null {
  const unit = value.trim().toLowerCase().replaceAll('μ', 'µ')
  if (unit === 'kcal') return 'kcal'
  if (unit === 'kj') return 'kJ'
  if (unit === 'g') return 'g'
  if (unit === 'mg') return 'mg'
  if (unit === 'ug' || unit === 'µg') return unit === 'ug' ? 'ug' : 'µg'
  return null
}
