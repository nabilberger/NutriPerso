import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addFractions,
  decimalToFraction,
  fractionFromInteger,
  fractionToDecimal,
  makeFraction,
  parseDecimal,
} from '../../src/domain/nutrition/decimal.ts'
import { aggregateNutrients } from '../../src/domain/nutrition/aggregate-nutrients.ts'
import { calculateNutrient, selectEnergyDatum, USDA_ENERGY_NUTRIENT_ID_PRIORITY } from '../../src/domain/nutrition/calculate-nutrient.ts'
import { quantityInBasisUnit } from '../../src/domain/nutrition/units.ts'
import type { NutrientComponent, NutrientDatum, NutrientSourceUnit, ReferenceBasis } from '../../src/domain/nutrition/types.ts'

const basis = { amount: '100', unit: 'g', source: 'fdc_data_type' } as const

function reported(
  code: NutrientDatum['code'],
  sourceValue: string,
  sourceUnit: NutrientSourceUnit,
  nutrientSourceId = 1003,
  referenceBasis: ReferenceBasis | null = basis,
): NutrientDatum {
  return {
    status: 'reported', code, sourceValue, sourceUnit, basis: referenceBasis,
    source: { sourceType: 'usda', sourceName: 'USDA FoodData Central', sourceReference: 'fixture', nutrientSourceId },
  }
}

function contribution(code: NutrientDatum['code'], sourceValue: string, sourceUnit: NutrientSourceUnit, consumedAmount = '100') {
  return calculateNutrient(reported(code, sourceValue, sourceUnit), { amount: consumedAmount, unit: 'g' })
}

test('decimal parser preserves exact coefficients and rejects malformed or oversized input', () => {
  assert.deepEqual(parseDecimal('12.3400'), { coefficient: 123400n, scale: 4 })
  assert.deepEqual(parseDecimal('-0.125'), { coefficient: -125n, scale: 3 })
  for (const invalid of ['', ' 1', '1 ', '+1', '01', '1.', '.1', 'NaN', 'Infinity']) {
    assert.throws(() => parseDecimal(invalid), { code: 'INVALID_DECIMAL' })
  }
  assert.throws(() => parseDecimal('1'.repeat(65)), { code: 'INVALID_DECIMAL' })
  assert.throws(() => parseDecimal(`1.${'1'.repeat(19)}`), { code: 'DECIMAL_LIMIT_EXCEEDED' })
  assert.throws(() => parseDecimal('1'.repeat(25)), { code: 'DECIMAL_LIMIT_EXCEEDED' })
})

test('scientific decimal notation remains exact and is bounded before conversion', () => {
  assert.deepEqual(parseDecimal('1.23456789012345678e-1'), { coefficient: 123456789012345678n, scale: 18 })
  assert.deepEqual(parseDecimal('1.25E+2'), { coefficient: 125n, scale: 0 })
  assert.deepEqual(parseDecimal('0e-4'), { coefficient: 0n, scale: 4 })
  assert.throws(() => parseDecimal('1e-19'), { code: 'DECIMAL_LIMIT_EXCEEDED' })
  assert.throws(() => parseDecimal('1e100'), { code: 'DECIMAL_LIMIT_EXCEEDED' })
})

test('fraction addition remains exact and reduced', () => {
  const sum = addFractions(decimalToFraction(parseDecimal('0.1')), decimalToFraction(parseDecimal('0.2')))
  assert.deepEqual(sum, { numerator: 3n, denominator: 10n })
  assert.deepEqual(addFractions(makeFraction(1n, 3n), makeFraction(1n, 6n)), makeFraction(1n, 2n))
  assert.deepEqual(addFractions(fractionFromInteger(1n), makeFraction(-1n, 1n)), fractionFromInteger(0n))
})

test('fraction quantization rounds half away from zero only at serialization', () => {
  assert.equal(fractionToDecimal(makeFraction(2_469_135n, 2_000_000n), 6), '1.234568')
  assert.equal(fractionToDecimal(makeFraction(12_345_674n, 10_000_000n), 6), '1.234567')
  assert.equal(fractionToDecimal(makeFraction(-1n, 2n), 0), '-1')
  assert.equal(fractionToDecimal(makeFraction(1n, 2n), 0), '1')
  assert.equal(fractionToDecimal(makeFraction(1n, 3n), 6), '0.333333')
})

test('uses each nutrient own reference quantity rather than assuming 100', () => {
  const nutrient = reported('protein', '12', 'g', 1003, { amount: '30', unit: 'g', source: 'manual' })
  const result = calculateNutrient(nutrient, { amount: '45', unit: 'g' })
  assert.equal(result.status, 'complete')
  if (result.status === 'complete') assert.deepEqual(result.exactValue, makeFraction(18n, 1n))
})

test('converts compatible mass and volume quantity units exactly', () => {
  assert.deepEqual(quantityInBasisUnit('0.25', 'l', 'ml'), makeFraction(250n, 1n))
  assert.deepEqual(quantityInBasisUnit('0.2', 'kg', 'g'), makeFraction(200n, 1n))

  const protein = calculateNutrient(reported('protein', '12.5', 'g'), { amount: '0.2', unit: 'kg' })
  assert.equal(protein.status, 'complete')
  if (protein.status === 'complete') assert.deepEqual(protein.exactValue, makeFraction(25n, 1n))

  const energy = calculateNutrient(reported('energy', '42', 'kcal', 1008, { amount: '100', unit: 'ml', source: 'manual' }), { amount: '0.25', unit: 'l' })
  assert.equal(energy.status, 'complete')
  if (energy.status === 'complete') assert.deepEqual(energy.exactValue, makeFraction(105n, 1n))
})

test('converts kJ to kcal and nutrient mg to grams without changing source values', () => {
  const energy = calculateNutrient(reported('energy', '418.4', 'kJ'), { amount: '100', unit: 'g' })
  assert.equal(energy.status, 'complete')
  if (energy.status === 'complete') assert.deepEqual(energy.exactValue, makeFraction(100n, 1n))

  const protein = calculateNutrient(reported('protein', '1250', 'mg'), { amount: '100', unit: 'g' })
  assert.equal(protein.status, 'complete')
  if (protein.status === 'complete') assert.deepEqual(protein.exactValue, makeFraction(5n, 4n))
})

test('a real nutrition zero remains a complete zero', () => {
  const result = contribution('carbohydrate', '0', 'g')
  assert.equal(result.status, 'complete')
  if (result.status === 'complete') assert.deepEqual(result.exactValue, fractionFromInteger(0n))
  const totals = aggregateNutrients([{ itemId: 'zero-food', nutrients: { carbohydrate: result } }], ['carbohydrate'])
  assert.deepEqual(totals.carbohydrate, { status: 'complete', code: 'carbohydrate', value: '0.000000', unit: 'g' })
})

test('confirmed Chicken, ground energy uses the imported legacy ID 1008 value', () => {
  const actualImportedEnergy = reported('energy', '201', 'kcal', 1008)
  const selected = selectEnergyDatum([actualImportedEnergy])
  assert.equal(selected?.status, 'reported')
  if (!selected || selected.status !== 'reported') return
  const result = calculateNutrient(selected, { amount: '100', unit: 'g' })
  assert.equal(result.status, 'complete')
  if (result.status === 'complete') assert.deepEqual(result.exactValue, makeFraction(201n, 1n))
})

test('missing nutrients and unknown bases remain unknown, never zero', () => {
  const missing: NutrientDatum = { status: 'missing', code: 'fiber', reason: 'not-reported' }
  assert.deepEqual(calculateNutrient(missing, { amount: '100', unit: 'g' }), {
    status: 'unknown', code: 'fiber', unit: 'g', reason: 'nutrient-not-reported',
  })
  const invalidSource: NutrientDatum = { status: 'missing', code: 'fiber', reason: 'invalid-source-value' }
  assert.deepEqual(calculateNutrient(invalidSource, { amount: '100', unit: 'g' }), {
    status: 'unknown', code: 'fiber', unit: 'g', reason: 'invalid-source-value',
  })

  const unknownBasis = calculateNutrient(reported('protein', '4', 'g', 1003, null), { amount: '100', unit: 'g' })
  assert.equal(unknownBasis.status, 'unknown')
  if (unknownBasis.status === 'unknown') assert.equal(unknownBasis.reason, 'reference-basis-unknown')
})

test('mass and volume are incompatible without a specific density', () => {
  const result = calculateNutrient(reported('energy', '42', 'kcal', 1008, { amount: '100', unit: 'ml', source: 'manual' }), { amount: '100', unit: 'g' })
  assert.equal(result.status, 'unknown')
  if (result.status === 'unknown') assert.equal(result.reason, 'incompatible-basis-unit')
})

test('invalid quantity, basis, negative value and excessive magnitude are rejected', () => {
  assert.throws(() => calculateNutrient(reported('protein', '1', 'g'), { amount: '0', unit: 'g' }), { code: 'INVALID_QUANTITY' })
  assert.throws(() => calculateNutrient(reported('protein', '1', 'g', 1003, { amount: '0', unit: 'g', source: 'manual' }), { amount: '10', unit: 'g' }), { code: 'INVALID_REFERENCE_BASIS' })
  assert.throws(() => calculateNutrient(reported('protein', '-1', 'g'), { amount: '10', unit: 'g' }), { code: 'NEGATIVE_NUTRIENT_VALUE' })
  assert.throws(() => calculateNutrient(reported('protein', '1000000000001', 'g'), { amount: '10', unit: 'g' }), { code: 'NUMERIC_LIMIT_EXCEEDED' })
  assert.throws(() => calculateNutrient(reported('protein', '1', 'g'), { amount: '1000001', unit: 'g' }), { code: 'NUMERIC_LIMIT_EXCEEDED' })
  const unsupported = calculateNutrient(reported('protein', '1', 'kcal'), { amount: '100', unit: 'g' })
  assert.equal(unsupported.status, 'unknown')
  if (unsupported.status === 'unknown') assert.equal(unsupported.reason, 'unsupported-nutrient-unit')
})

test('fractional contributions stay exact until the aggregate result boundary', () => {
  const third = calculateNutrient(reported('protein', '1', 'g', 1003, { amount: '3', unit: 'g', source: 'manual' }), { amount: '1', unit: 'g' })
  const components: NutrientComponent[] = ['a', 'b', 'c'].map((itemId) => ({ itemId, nutrients: { protein: third } }))
  assert.deepEqual(aggregateNutrients(components, ['protein']).protein, {
    status: 'complete', code: 'protein', value: '1.000000', unit: 'g',
  })
})

test('partial and wholly unknown aggregates are explicitly distinguished', () => {
  const known = contribution('protein', '10', 'g')
  const unknown = { status: 'unknown', code: 'protein', unit: 'g', reason: 'reference-basis-unknown' } as const
  assert.deepEqual(aggregateNutrients([
    { itemId: 'known', nutrients: { protein: known } },
    { itemId: 'unknown', nutrients: { protein: unknown } },
  ], ['protein']).protein, {
    status: 'partial', code: 'protein', knownSubtotal: '10.000000', unit: 'g',
    missing: [{ itemId: 'unknown', reason: 'reference-basis-unknown' }],
  })

  assert.deepEqual(aggregateNutrients([{ itemId: 'missing', nutrients: {} }], ['fiber']).fiber, {
    status: 'unknown', code: 'fiber', unit: 'g',
    missing: [{ itemId: 'missing', reason: 'nutrient-not-reported' }],
  })
  assert.equal(aggregateNutrients([], ['fiber']).fiber?.status, 'unknown')
})

test('a known zero subtotal with another missing component stays partial', () => {
  const zero = contribution('fiber', '0', 'g')
  assert.deepEqual(aggregateNutrients([
    { itemId: 'zero', nutrients: { fiber: zero } },
    { itemId: 'missing', nutrients: {} },
  ], ['fiber']).fiber, {
    status: 'partial', code: 'fiber', knownSubtotal: '0.000000', unit: 'g',
    missing: [{ itemId: 'missing', reason: 'nutrient-not-reported' }],
  })
})

test('energy selection prefers 2048, then 2047, then legacy 1008; it never sums', () => {
  const energyDatum = (nutrientSourceId: number, sourceValue: string) => reported('energy', sourceValue, 'kcal', nutrientSourceId)
  assert.deepEqual(USDA_ENERGY_NUTRIENT_ID_PRIORITY, [2048, 2047, 1008])
  assert.equal(selectEnergyDatum([energyDatum(1008, '201'), energyDatum(2048, '190'), energyDatum(2047, '195')])?.source?.nutrientSourceId, 2048)
  assert.equal(selectEnergyDatum([energyDatum(1008, '201'), energyDatum(2047, '195')])?.source?.nutrientSourceId, 2047)
  assert.equal(selectEnergyDatum([energyDatum(1008, '201')])?.source?.nutrientSourceId, 1008)
  assert.equal(selectEnergyDatum([energyDatum(1008, '201'), energyDatum(2048, '0')])?.source?.nutrientSourceId, 2048)
  assert.equal(selectEnergyDatum([]), null)
  const invalidPreferred: NutrientDatum = {
    status: 'missing', code: 'energy', reason: 'invalid-source-value',
    source: { sourceType: 'usda', sourceName: 'USDA', sourceReference: null, nutrientSourceId: 2048 },
  }
  assert.equal(selectEnergyDatum([invalidPreferred, energyDatum(2047, '195')]), invalidPreferred)
})

test('aggregation rejects duplicate component identifiers', () => {
  assert.throws(() => aggregateNutrients([{ itemId: 'same', nutrients: {} }, { itemId: 'same', nutrients: {} }]), { code: 'DUPLICATE_COMPONENT' })
})
