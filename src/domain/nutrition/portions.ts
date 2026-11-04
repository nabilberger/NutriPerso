import {
  assertFractionAtMost,
  decimalToFraction,
  divideFractions,
  isPositive,
  makeFraction,
  multiplyFractions,
  parseDecimal,
  type ExactFraction,
} from './decimal.ts'
import { MAX_CONSUMED_QUANTITY, quantityInBasisUnit } from './units.ts'
import { NutritionError, type BasisUnit } from './types.ts'

export type PortionUnit = 'piece' | 'slice' | 'teaspoon' | 'tablespoon' | 'custom'
export type PortionProvenance = {
  readonly kind: 'source-documentation' | 'manual' | 'product-label'
  readonly reference: string | null
  readonly notes: string | null
}

type PortionEquivalenceBase = {
  readonly id: string
  readonly foodId: string
  readonly unit: PortionUnit
  readonly label: string
  readonly version: number
}

type WithoutVersion<T> = T extends unknown ? Omit<T, 'version'> : never
export type NewFoodPortionEquivalence = WithoutVersion<FoodPortionEquivalence>
export type PortionEquivalenceChanges = {
  readonly unit?: PortionUnit
  readonly label?: string
  readonly status?: 'validated' | 'unknown'
  readonly equivalentAmount?: string
  readonly equivalentUnit?: 'g' | 'ml'
  readonly weightNature?: 'edible' | 'gross' | 'not-applicable'
  readonly provenance?: PortionProvenance
  readonly reason?: 'not-measured' | 'source-unclear' | 'conversion-unavailable'
}

export type FoodPortionEquivalence = PortionEquivalenceBase & (
  | {
      readonly status: 'validated'
      readonly equivalentAmount: string
      readonly equivalentUnit: 'g'
      readonly weightNature: 'edible' | 'gross'
      readonly provenance: PortionProvenance
    }
  | {
      readonly status: 'validated'
      readonly equivalentAmount: string
      readonly equivalentUnit: 'ml'
      readonly weightNature: 'not-applicable'
      readonly provenance: PortionProvenance
    }
  | {
      readonly status: 'unknown'
      readonly reason?: 'not-measured' | 'source-unclear' | 'conversion-unavailable'
    }
)

export type PhysicalFoodQuantity =
  | { readonly kind: 'physical'; readonly amount: string; readonly unit: 'g' | 'kg'; readonly weightNature: 'edible' | 'gross' | 'unknown' }
  | { readonly kind: 'physical'; readonly amount: string; readonly unit: 'ml' | 'l'; readonly weightNature: 'not-applicable' }

export type ServingFoodQuantity = {
  readonly kind: 'serving'
  readonly amount: string
  readonly unit: PortionUnit
  readonly equivalenceId: string
}

export type FoodQuantityInput = PhysicalFoodQuantity | ServingFoodQuantity

export type EdibleYieldConversion = {
  readonly id: string
  readonly foodId: string
  readonly status: 'validated'
  readonly grossAmount: string
  readonly edibleAmount: string
  readonly unit: 'g'
  readonly provenance: PortionProvenance
  readonly version: number
}

export type ResolvedFoodQuantity =
  | {
      readonly status: 'resolved'
      readonly exactAmount: ExactFraction
      readonly unit: BasisUnit
      readonly weightNature: 'edible' | 'gross' | 'unknown' | 'not-applicable'
      readonly edibleAmount?: ExactFraction
      readonly yieldConversion?: EdibleYieldConversion
      readonly equivalenceSnapshot?: FoodPortionEquivalence
    }
  | {
      readonly status: 'unknown'
      readonly reason: 'equivalence-not-found' | 'equivalence-unvalidated' | 'food-mismatch' | 'unit-mismatch'
      readonly equivalenceId: string
    }

const MAX_PORTION_COUNT = makeFraction(1_000_000n, 1n)

export function createPortionEquivalence(input: NewFoodPortionEquivalence): FoodPortionEquivalence {
  const created = { ...input, version: 1 } as FoodPortionEquivalence
  validateEquivalence(created)
  return created
}

/** Produces a new version; callers keep the old value in confirmed snapshots. */
export function updatePortionEquivalence(
  current: FoodPortionEquivalence,
  changes: PortionEquivalenceChanges,
): FoodPortionEquivalence {
  const nextVersion = current.version + 1
  const merged = { ...current, ...changes, id: current.id, foodId: current.foodId, version: nextVersion } as FoodPortionEquivalence
  const updated: FoodPortionEquivalence = merged.status === 'unknown'
    ? {
        id: current.id, foodId: current.foodId, unit: merged.unit, label: merged.label,
        version: nextVersion, status: 'unknown', ...(merged.reason ? { reason: merged.reason } : {}),
      }
    : merged
  validateEquivalence(updated)
  return updated
}

export function createEdibleYieldConversion(input: Omit<EdibleYieldConversion, 'version' | 'status'>): EdibleYieldConversion {
  if (!input.id.trim() || !input.foodId.trim() || !input.provenance.kind) {
    throw new NutritionError('INVALID_PORTION_EQUIVALENCE', 'Identifiant, aliment et provenance de conversion obligatoires.')
  }
  const gross = positiveDecimal(input.grossAmount, 'La masse brute de référence doit être positive.')
  const edible = positiveDecimal(input.edibleAmount, 'La masse comestible de référence doit être positive.')
  assertFractionAtMost(gross, MAX_CONSUMED_QUANTITY)
  assertFractionAtMost(edible, MAX_CONSUMED_QUANTITY)
  return { ...input, status: 'validated', version: 1 }
}

export function resolveFoodQuantity(
  foodId: string,
  input: FoodQuantityInput,
  equivalences: readonly FoodPortionEquivalence[] = [],
  yieldConversions: readonly EdibleYieldConversion[] = [],
): ResolvedFoodQuantity {
  if (input.kind === 'physical') {
    const unit: BasisUnit = input.unit === 'g' || input.unit === 'kg' ? 'g' : 'ml'
    const exactAmount = quantityInBasisUnit(input.amount, input.unit, unit)
    if (!exactAmount) throw new NutritionError('INVALID_QUANTITY', 'Unité physique incompatible.')
    const nature = input.weightNature
    return resolveWeightNature(foodId, exactAmount, unit, nature, yieldConversions)
  }

  const count = positiveDecimal(input.amount, 'Le nombre de portions doit être positif.')
  assertFractionAtMost(count, MAX_PORTION_COUNT)
  const equivalence = equivalences.find((candidate) => candidate.id === input.equivalenceId)
  if (!equivalence) return { status: 'unknown', reason: 'equivalence-not-found', equivalenceId: input.equivalenceId }
  if (equivalence.foodId !== foodId) return { status: 'unknown', reason: 'food-mismatch', equivalenceId: input.equivalenceId }
  if (equivalence.status !== 'validated') return { status: 'unknown', reason: 'equivalence-unvalidated', equivalenceId: input.equivalenceId }
  if (equivalence.unit !== input.unit) return { status: 'unknown', reason: 'unit-mismatch', equivalenceId: input.equivalenceId }

  const perServing = positiveDecimal(equivalence.equivalentAmount, 'L’équivalence doit être positive.')
  assertFractionAtMost(perServing, MAX_CONSUMED_QUANTITY)
  const total = multiplyFractions(count, perServing)
  const unit = equivalence.equivalentUnit
  if (unit === 'ml') {
    assertFractionAtMost(total, MAX_CONSUMED_QUANTITY)
    return { status: 'resolved', exactAmount: total, unit, weightNature: 'not-applicable', equivalenceSnapshot: equivalence }
  }
  assertFractionAtMost(total, MAX_CONSUMED_QUANTITY)
  return resolveWeightNature(foodId, total, unit, equivalence.weightNature, yieldConversions, equivalence)
}

function resolveWeightNature(
  foodId: string,
  exactAmount: ExactFraction,
  unit: BasisUnit,
  weightNature: 'edible' | 'gross' | 'unknown' | 'not-applicable',
  conversions: readonly EdibleYieldConversion[],
  equivalenceSnapshot?: FoodPortionEquivalence,
): ResolvedFoodQuantity {
  if (unit !== 'g' || weightNature !== 'gross') {
    return { status: 'resolved', exactAmount, unit, weightNature, equivalenceSnapshot }
  }
  const foodConversions = conversions
    .filter((candidate) => candidate.foodId === foodId && candidate.status === 'validated')
  const latestVersion = foodConversions.reduce((latest, candidate) => Math.max(latest, candidate.version), 0)
  const latestConversions = foodConversions.filter((candidate) => candidate.version === latestVersion)
  if (latestConversions.length > 1) {
    throw new NutritionError('INVALID_PORTION_EQUIVALENCE', 'Plusieurs conversions brut/comestible de même version sont ambiguës.')
  }
  const conversion = latestConversions[0]
  if (!conversion) return { status: 'resolved', exactAmount, unit, weightNature, equivalenceSnapshot }
  const grossReference = positiveDecimal(conversion.grossAmount, 'Référence brute invalide.')
  const edibleReference = positiveDecimal(conversion.edibleAmount, 'Référence comestible invalide.')
  const edibleAmount = multiplyFractions(exactAmount, divideFractions(edibleReference, grossReference))
  assertFractionAtMost(edibleAmount, MAX_CONSUMED_QUANTITY)
  return { status: 'resolved', exactAmount, unit, weightNature, edibleAmount, yieldConversion: conversion, equivalenceSnapshot }
}

function positiveDecimal(value: string, message: string): ExactFraction {
  const fraction = decimalToFraction(parseDecimal(value))
  if (!isPositive(fraction)) throw new NutritionError('INVALID_PORTION_EQUIVALENCE', message)
  return fraction
}

function validateEquivalence(equivalence: FoodPortionEquivalence): void {
  if (!equivalence.id.trim() || !equivalence.foodId.trim() || !equivalence.label.trim() || !Number.isInteger(equivalence.version) || equivalence.version < 1) {
    throw new NutritionError('INVALID_PORTION_EQUIVALENCE', 'Identifiant, aliment, libellé et version d’équivalence requis.')
  }
  if (equivalence.status === 'unknown') return
  const amount = positiveDecimal(equivalence.equivalentAmount, 'L’équivalence doit être strictement positive.')
  assertFractionAtMost(amount, MAX_CONSUMED_QUANTITY)
  const isMass = equivalence.equivalentUnit === 'g'
  if ((isMass && equivalence.weightNature !== 'edible' && equivalence.weightNature !== 'gross') || (!isMass && equivalence.weightNature !== 'not-applicable')) {
    throw new NutritionError('INVALID_PORTION_EQUIVALENCE', 'La nature du poids doit correspondre à l’unité équivalente.')
  }
  if (!equivalence.provenance || !equivalence.provenance.kind) {
    throw new NutritionError('INVALID_PORTION_EQUIVALENCE', 'La provenance d’une équivalence validée est obligatoire.')
  }
}
