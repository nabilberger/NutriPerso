import {
  assertFractionAtMost,
  decimalToFraction,
  divideFractions,
  isNegative,
  isPositive,
  multiplyFractions,
  parseDecimal,
  type ExactFraction,
} from './decimal.ts'
import {
  basisAmountInUnit,
  canonicalNutrientUnit,
  nutrientValueInCanonicalUnit,
  quantityInBasisUnit,
  exactQuantityInBasisUnit,
  validateConsumedQuantity,
  validateExactConsumedQuantity,
  MAX_NUTRIENT_SOURCE_VALUE,
} from './units.ts'
import { NutritionError, type BasisUnit, type NutrientContribution, type NutrientDatum, type QuantityUnit } from './types.ts'

/** USDA IDs: 2048 is food-specific Atwater, 2047 general Atwater, 1008 legacy generic Energy. */
export const USDA_ENERGY_NUTRIENT_ID_PRIORITY = [2048, 2047, 1008] as const
const MAX_CONSUMED_NUTRIENT_VALUE = { numerator: 1_000_000_000_000_000_000n, denominator: 1n }

/**
 * Selects one energy datum, never a sum. NutriPerso prefers the food-specific 2048,
 * falls back to general-factor 2047, and uses legacy 1008 only if both are absent.
 * A present zero is selected normally. A present but unusable preferred value is
 * surfaced as unknown/error; it does not silently fall through to another method.
 */
export function selectEnergyDatum(candidates: readonly NutrientDatum[]): NutrientDatum | null {
  const energyData = candidates.filter((datum) => datum.code === 'energy')
  for (const nutrientId of USDA_ENERGY_NUTRIENT_ID_PRIORITY) {
    const match = energyData.find((datum) => datum.source?.sourceType === 'usda' && datum.source.nutrientSourceId === nutrientId)
    if (match) return match
  }
  const nonUsda = energyData.filter((datum) => datum.status === 'reported' && datum.source.sourceType !== 'usda')
  if (nonUsda.length > 1) throw new NutritionError('DUPLICATE_NUTRIENT', 'Plusieurs valeurs énergétiques locales sont présentes.')
  return nonUsda[0] ?? null
}

export type ConsumedNutrientQuantity =
  | { readonly amount: string; readonly unit: QuantityUnit }
  | { readonly exactAmount: ExactFraction; readonly unit: BasisUnit }

export function calculateNutrient(datum: NutrientDatum, consumed: ConsumedNutrientQuantity): NutrientContribution {
  const unit = canonicalNutrientUnit(datum.code)
  if ('exactAmount' in consumed) validateExactConsumedQuantity(consumed.exactAmount)
  else validateConsumedQuantity(consumed.amount, consumed.unit)
  if (datum.status === 'missing') {
    return {
      status: 'unknown',
      code: datum.code,
      unit,
      reason: datum.reason === 'invalid-source-value' ? 'invalid-source-value' : 'nutrient-not-reported',
      ...(datum.source ? { source: datum.source } : {}),
    }
  }
  if (!datum.basis) {
    return { status: 'unknown', code: datum.code, unit, reason: 'reference-basis-unknown', source: datum.source }
  }

  const sourceValue = decimalToFraction(parseDecimal(datum.sourceValue))
  if (isNegative(sourceValue)) throw new NutritionError('NEGATIVE_NUTRIENT_VALUE', 'Une valeur nutritionnelle ne peut pas être négative.')
  assertFractionAtMost(sourceValue, MAX_NUTRIENT_SOURCE_VALUE)

  const normalizedValue = nutrientValueInCanonicalUnit(datum.code, sourceValue, datum.sourceUnit)
  if (!normalizedValue) {
    return { status: 'unknown', code: datum.code, unit, reason: 'unsupported-nutrient-unit', source: datum.source }
  }

  const referenceAmount = basisAmountInUnit(datum.basis.amount)
  if (!isPositive(referenceAmount)) throw new NutritionError('INVALID_REFERENCE_BASIS', 'La base nutritionnelle doit être strictement positive.')

  const consumedAmount = 'exactAmount' in consumed
    ? exactQuantityInBasisUnit(consumed.exactAmount, consumed.unit, datum.basis.unit)
    : quantityInBasisUnit(consumed.amount, consumed.unit, datum.basis.unit)
  if (!consumedAmount) {
    return { status: 'unknown', code: datum.code, unit, reason: 'incompatible-basis-unit', source: datum.source }
  }

  const exactValue = divideFractions(multiplyFractions(normalizedValue, consumedAmount), referenceAmount)
  assertFractionAtMost(exactValue, MAX_CONSUMED_NUTRIENT_VALUE)
  return { status: 'complete', code: datum.code, exactValue, unit, source: datum.source }
}

/** Exposes the unquantized value for internal aggregate operations. */
export function contributionValue(contribution: NutrientContribution): ExactFraction | null {
  return contribution.status === 'complete' ? contribution.exactValue : null
}
