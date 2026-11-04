import {
  assertFractionAtMost,
  decimalToFraction,
  fractionFromInteger,
  makeFraction,
  multiplyFractions,
  parseDecimal,
  isPositive,
  type ExactFraction,
} from './decimal.ts'
import { NutritionError, type BasisUnit, type CanonicalNutrientUnit, type NutrientCode, type NutrientSourceUnit, type QuantityUnit } from './types.ts'

export const MAX_CONSUMED_QUANTITY = makeFraction(1_000_000n, 1n)
export const MAX_REFERENCE_AMOUNT = makeFraction(1_000_000_000n, 1n)
export const MAX_NUTRIENT_SOURCE_VALUE = makeFraction(1_000_000_000_000n, 1n)

type UnitFactor = { readonly dimension: 'mass' | 'volume'; readonly factorToBase: ExactFraction }
const QUANTITY_FACTORS: Record<QuantityUnit, UnitFactor> = {
  ug: { dimension: 'mass', factorToBase: makeFraction(1n, 1_000_000n) },
  'µg': { dimension: 'mass', factorToBase: makeFraction(1n, 1_000_000n) },
  'μg': { dimension: 'mass', factorToBase: makeFraction(1n, 1_000_000n) },
  mg: { dimension: 'mass', factorToBase: makeFraction(1n, 1_000n) },
  g: { dimension: 'mass', factorToBase: fractionFromInteger(1n) },
  kg: { dimension: 'mass', factorToBase: fractionFromInteger(1_000n) },
  ml: { dimension: 'volume', factorToBase: fractionFromInteger(1n) },
  l: { dimension: 'volume', factorToBase: fractionFromInteger(1_000n) },
}

/** Converts only within mass or within volume. Returns null for g↔ml. */
export function quantityInBasisUnit(amount: string, unit: QuantityUnit, basisUnit: BasisUnit): ExactFraction | null {
  const quantity = validateConsumedQuantity(amount, unit)
  const factor = QUANTITY_FACTORS[unit]
  if (factor.dimension !== (basisUnit === 'g' ? 'mass' : 'volume')) return null
  return multiplyFractions(quantity, factor.factorToBase)
}

/** Validates a pre-resolved exact quantity whose unit is already g or ml. */
export function validateExactConsumedQuantity(amount: ExactFraction): ExactFraction {
  if (amount.denominator <= 0n || !isPositive(amount)) {
    throw new NutritionError('INVALID_QUANTITY', 'La quantité consommée exacte doit être positive et normalisée.')
  }
  const normalized = makeFraction(amount.numerator, amount.denominator)
  assertFractionAtMost(normalized, MAX_CONSUMED_QUANTITY)
  return normalized
}

export function exactQuantityInBasisUnit(amount: ExactFraction, unit: BasisUnit, basisUnit: BasisUnit): ExactFraction | null {
  const quantity = validateExactConsumedQuantity(amount)
  if (unit !== basisUnit) return null
  return quantity
}

export function validateConsumedQuantity(amount: string, unit: QuantityUnit): ExactFraction {
  const quantity = decimalToFraction(parseDecimal(amount))
  const factor = QUANTITY_FACTORS[unit]
  if (!factor || !isPositive(quantity)) throw new NutritionError('INVALID_QUANTITY', 'La quantité consommée doit être positive et son unité reconnue.')
  const normalized = multiplyFractions(quantity, factor.factorToBase)
  assertFractionAtMost(normalized, MAX_CONSUMED_QUANTITY)
  return quantity
}

export function canonicalNutrientUnit(code: NutrientCode): CanonicalNutrientUnit {
  return code === 'energy' ? 'kcal' : 'g'
}

/** Converts to kcal or grams without changing the source value stored alongside the result. */
export function nutrientValueInCanonicalUnit(code: NutrientCode, amount: ExactFraction, unit: NutrientSourceUnit): ExactFraction | null {
  const normalized = unit.toLowerCase()
  if (code === 'energy') {
    if (normalized === 'kcal') return amount
    if (normalized === 'kj') return multiplyFractions(amount, makeFraction(125n, 523n))
    return null
  }
  if (normalized === 'g') return amount
  if (normalized === 'mg') return multiplyFractions(amount, makeFraction(1n, 1_000n))
  if (normalized === 'ug' || normalized === 'µg' || normalized === 'μg') return multiplyFractions(amount, makeFraction(1n, 1_000_000n))
  return null
}

export function basisAmountInUnit(amount: string): ExactFraction {
  const value = decimalToFraction(parseDecimal(amount))
  assertFractionAtMost(value, MAX_REFERENCE_AMOUNT)
  return value
}
