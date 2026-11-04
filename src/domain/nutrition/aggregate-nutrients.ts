import { addFractions, assertFractionAtMost, fractionToDecimal, isPositive, makeFraction, multiplyFractions, type ExactFraction } from './decimal.ts'
import { canonicalNutrientUnit } from './units.ts'
import {
  NutritionError,
  NUTRIENT_CODES,
  type MissingNutrientReason,
  type NutrientCode,
  type NutrientComponent,
  type NutrientTotal,
} from './types.ts'

export const MAX_AGGREGATE_COMPONENTS = 1_000
export const MAX_AGGREGATED_NUTRIENT_VALUE = makeFraction(1_000_000_000_000_000_000_000n, 1n)

export type AggregateOptions = {
  readonly multiplier?: ExactFraction
  readonly includeExact?: boolean
}

export function aggregateNutrients(
  components: readonly NutrientComponent[],
  codes: readonly NutrientCode[] = NUTRIENT_CODES,
  options: AggregateOptions = {},
): Partial<Record<NutrientCode, NutrientTotal>> {
  if (components.length > MAX_AGGREGATE_COMPONENTS) {
    throw new NutritionError('TOO_MANY_COMPONENTS', 'Le nombre d’éléments à agréger dépasse la limite autorisée.')
  }
  const multiplier = options.multiplier ?? makeFraction(1n, 1n)
  if (multiplier.denominator <= 0n || !isPositive(multiplier)) {
    throw new NutritionError('INVALID_AGGREGATE_MULTIPLIER', 'Le multiplicateur d’agrégation doit être strictement positif.')
  }
  const normalizedMultiplier = makeFraction(multiplier.numerator, multiplier.denominator)
  assertUniqueComponentIds(components)

  const result: Partial<Record<NutrientCode, NutrientTotal>> = {}
  for (const code of codes) result[code] = aggregateOneNutrient(code, components, normalizedMultiplier, options.includeExact ?? false)
  return result
}

function aggregateOneNutrient(code: NutrientCode, components: readonly NutrientComponent[], multiplier: ExactFraction, includeExact: boolean): NutrientTotal {
  let knownSubtotal: ExactFraction | null = null
  const missing: MissingNutrientReason[] = []
  const expectedUnit = canonicalNutrientUnit(code)

  for (const component of components) {
    const contribution = component.nutrients[code]
    if (!contribution) {
      missing.push({ itemId: component.itemId, reason: 'nutrient-not-reported' })
      continue
    }
    if (contribution.code !== code) throw new NutritionError('NUTRIENT_CODE_MISMATCH', 'Le code du résultat ne correspond pas à sa clé.')
    if (contribution.unit !== expectedUnit) throw new NutritionError('NUTRIENT_UNIT_MISMATCH', 'Les contributions d’un nutriment doivent avoir la même unité canonique.')
    if (contribution.status === 'unknown') {
      if (contribution.missing?.length) {
        for (const reason of contribution.missing) {
          missing.push({
            itemId: component.itemId,
            reason: reason.reason,
            ...(reason.path ? { path: reason.path } : {}),
            ...(reason.origin ? { origin: reason.origin } : contribution.origin ? { origin: contribution.origin } : {}),
          })
        }
      } else {
        missing.push({ itemId: component.itemId, reason: contribution.reason, ...(contribution.origin ? { origin: contribution.origin } : {}) })
      }
      continue
    }
    if (contribution.status === 'partial') {
      if (contribution.missing.length === 0 || contribution.exactKnownSubtotal.denominator <= 0n) {
        throw new NutritionError('INVALID_PARTIAL_CONTRIBUTION', 'Une contribution partielle exige un sous-total exact et au moins une raison manquante.')
      }
      const nestedPath = contribution.origin.kind === 'recipe-snapshot' ? contribution.origin.snapshotId : component.itemId
      for (const reason of contribution.missing) {
        missing.push({
          itemId: component.itemId,
          reason: reason.reason,
          path: [reason.itemId ?? nestedPath, ...(reason.path ?? [])],
          origin: reason.origin ?? contribution.origin,
        })
      }
    }
    const exactValue = contribution.status === 'partial' ? contribution.exactKnownSubtotal : contribution.exactValue
    const scaledValue = multiplyFractions(exactValue, multiplier)
    knownSubtotal = knownSubtotal === null ? scaledValue : addFractions(knownSubtotal, scaledValue)
    assertFractionAtMost(knownSubtotal, MAX_AGGREGATED_NUTRIENT_VALUE)
  }

  if (components.length === 0) missing.push({ itemId: null, reason: 'no-contributions' })
  if (missing.length === 0 && knownSubtotal !== null) {
    return {
      status: 'complete', code, value: fractionToDecimal(knownSubtotal, 6), unit: expectedUnit,
      ...(includeExact ? { exactValue: { numerator: knownSubtotal.numerator.toString(), denominator: knownSubtotal.denominator.toString() } } : {}),
    }
  }
  if (knownSubtotal !== null) {
    return {
      status: 'partial', code, knownSubtotal: fractionToDecimal(knownSubtotal, 6), unit: expectedUnit, missing,
      ...(includeExact ? { exactKnownSubtotal: { numerator: knownSubtotal.numerator.toString(), denominator: knownSubtotal.denominator.toString() } } : {}),
    }
  }
  return { status: 'unknown', code, unit: expectedUnit, missing }
}

function assertUniqueComponentIds(components: readonly NutrientComponent[]): void {
  const itemIds = new Set<string>()
  for (const component of components) {
    if (!component.itemId || itemIds.has(component.itemId)) {
      throw new NutritionError('DUPLICATE_COMPONENT', 'Chaque élément agrégé doit avoir un identifiant unique non vide.')
    }
    itemIds.add(component.itemId)
  }
}
