import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregateNutrients } from '../../src/domain/nutrition/aggregate-nutrients.ts'
import { calculateNutrient } from '../../src/domain/nutrition/calculate-nutrient.ts'
import { makeFraction } from '../../src/domain/nutrition/decimal.ts'
import {
  createEdibleYieldConversion,
  createPortionEquivalence,
  resolveFoodQuantity,
  updatePortionEquivalence,
  type FoodPortionEquivalence,
} from '../../src/domain/nutrition/portions.ts'
import { createConfirmedRecipeSnapshot } from '../../src/domain/nutrition/recipe-snapshot.ts'
import {
  addRecipeIngredient,
  calculateRecipe,
  createRecipe,
  removeRecipeIngredient,
  setRecipeFinalWeight,
  setRecipeServings,
  updateRecipeName,
  updateRecipeIngredientQuantity,
  type FoodNutritionSnapshot,
} from '../../src/domain/nutrition/recipes.ts'
import type { NutrientDatum } from '../../src/domain/nutrition/types.ts'

function datum(code: NutrientDatum['code'], value: string, id: number, unit: 'g' | 'kcal' = 'g'): NutrientDatum {
  return {
    status: 'reported', code, sourceValue: value, sourceUnit: unit,
    basis: { amount: '100', unit: 'g', source: 'fdc_data_type' },
    source: { sourceType: 'usda', sourceName: 'USDA FoodData Central', sourceReference: 'test FDC', nutrientSourceId: id },
  }
}

function food(foodId: string, description: string, nutrients: readonly NutrientDatum[], overrides: Partial<FoodNutritionSnapshot> = {}): FoodNutritionSnapshot {
  return {
    foodId, sourceType: 'usda', fdcId: Number(foodId), description,
    category: null, dataType: 'Survey (FNDDS)', brandOwner: null,
    sourceName: 'USDA', sourceReference: `FDC ${foodId}`, sourceNotes: null,
    nutrients, portionEquivalences: [], edibleYieldConversions: [], ...overrides,
  }
}

function addIngredient(recipe: ReturnType<typeof createRecipe>, id: string, foodId: string, amount: string, unit: 'g' | 'kg' = 'g') {
  return addRecipeIngredient(recipe, {
    id, foodId, quantity: { kind: 'physical', amount, unit, weightNature: 'edible' },
  })
}

test('validated portion equivalences are food-specific, versioned, and exact', () => {
  const egg = createPortionEquivalence({
    id: 'egg-piece', foodId: '1', unit: 'piece', label: 'œuf moyen', status: 'validated',
    equivalentAmount: '50.5', equivalentUnit: 'g', weightNature: 'edible',
    provenance: { kind: 'manual', reference: 'pesée personnelle', notes: null },
  })
  const resolved = resolveFoodQuantity('1', { kind: 'serving', amount: '1.5', unit: 'piece', equivalenceId: egg.id }, [egg])
  assert.equal(resolved.status, 'resolved')
  if (resolved.status === 'resolved') assert.deepEqual(resolved.exactAmount, makeFraction(1515n, 20n))
  assert.deepEqual(resolveFoodQuantity('other', { kind: 'serving', amount: '1', unit: 'piece', equivalenceId: egg.id }, [egg]), {
    status: 'unknown', reason: 'food-mismatch', equivalenceId: egg.id,
  })

  const next = updatePortionEquivalence(egg, { equivalentAmount: '52' })
  assert.equal(next.version, 2)
  assert.equal(egg.equivalentAmount, '50.5')
  assert.equal(next.equivalentAmount, '52')

  const custom = createPortionEquivalence({
    id: 'custom-scoop', foodId: '1', unit: 'custom', label: 'cuillère personnelle', status: 'validated',
    equivalentAmount: '12.5', equivalentUnit: 'g', weightNature: 'edible',
    provenance: { kind: 'manual', reference: null, notes: 'mesurée pour cet aliment' },
  })
  const halfScoop = resolveFoodQuantity('1', { kind: 'serving', amount: '0.5', unit: 'custom', equivalenceId: custom.id }, [custom])
  assert.equal(halfScoop.status, 'resolved')
  if (halfScoop.status === 'resolved') assert.deepEqual(halfScoop.exactAmount, makeFraction(25n, 4n))
})

test('unknown equivalence has no usable amount and cannot resolve', () => {
  const unknown = createPortionEquivalence({
    id: 'slice-unknown', foodId: 'bread', unit: 'slice', label: 'tranche', status: 'unknown', reason: 'not-measured',
  })
  assert.deepEqual(resolveFoodQuantity('bread', { kind: 'serving', amount: '1.5', unit: 'slice', equivalenceId: unknown.id }, [unknown]), {
    status: 'unknown', reason: 'equivalence-unvalidated', equivalenceId: unknown.id,
  })
  assert.equal('equivalentAmount' in unknown, false)
})

test('physical mass requires edible, gross, or unknown nature and volume uses not-applicable', () => {
  const edible = resolveFoodQuantity('x', { kind: 'physical', amount: '0.2', unit: 'kg', weightNature: 'edible' })
  assert.equal(edible.status, 'resolved')
  if (edible.status === 'resolved') assert.deepEqual(edible.exactAmount, makeFraction(200n, 1n))
  const unknownMass = resolveFoodQuantity('x', { kind: 'physical', amount: '100', unit: 'g', weightNature: 'unknown' })
  assert.equal(unknownMass.status, 'resolved')
  if (unknownMass.status === 'resolved') assert.equal(unknownMass.weightNature, 'unknown')

  const tablespoon = createPortionEquivalence({
    id: 'soup-tbsp', foodId: 'soup', unit: 'tablespoon', label: 'cuillère à soupe', status: 'validated',
    equivalentAmount: '15', equivalentUnit: 'ml', weightNature: 'not-applicable',
    provenance: { kind: 'manual', reference: 'mesure documentée pour ce produit', notes: null },
  })
  const volume = resolveFoodQuantity('soup', { kind: 'serving', amount: '2', unit: 'tablespoon', equivalenceId: tablespoon.id }, [tablespoon])
  assert.equal(volume.status, 'resolved')
  if (volume.status === 'resolved') {
    assert.deepEqual(volume.exactAmount, makeFraction(30n, 1n))
    assert.equal(volume.weightNature, 'not-applicable')
  }
})

test('gross mass is unknown without a validated edible conversion and exact with one', () => {
  const rawFood = food('2', 'food with peel', [datum('protein', '10', 1003)], {
    edibleYieldConversions: [createEdibleYieldConversion({
      id: 'yield-2', foodId: '2', grossAmount: '100', edibleAmount: '80', unit: 'g',
      provenance: { kind: 'source-documentation', reference: 'documented yield', notes: null },
    })],
  })
  const recipe = addRecipeIngredient(createRecipe({ id: 'gross-recipe', name: 'Test' }), {
    id: 'raw-item', foodId: '2', quantity: { kind: 'physical', amount: '100', unit: 'g', weightNature: 'gross' },
  })
  const converted = calculateRecipe(recipe, new Map([['2', rawFood]]))
  const protein = converted.totals.protein
  assert.equal(protein?.status, 'complete')
  if (protein?.status === 'complete') assert.equal(protein.value, '8.000000')
  const resolved = converted.ingredients[0]?.resolvedQuantity
  assert.equal(resolved?.status, 'resolved')
  if (resolved?.status === 'resolved') {
    assert.deepEqual(resolved.edibleAmount, makeFraction(80n, 1n))
    assert.equal(resolved.yieldConversion?.id, 'yield-2')
  }
  const withoutConversion = calculateRecipe(recipe, new Map([['2', { ...rawFood, edibleYieldConversions: [] }]]))
  assert.equal(withoutConversion.totals.protein?.status, 'unknown')
  if (withoutConversion.ingredients[0]?.contributions.protein?.status === 'unknown') {
    assert.equal(withoutConversion.ingredients[0].contributions.protein.reason, 'gross-weight-without-edible-conversion')
  }
})

test('multiple ingredients aggregate exact values and support fractional servings', () => {
  const first = food('11', 'Food A', [datum('protein', '10', 1003)])
  const second = food('12', 'Food B', [datum('protein', '2', 1003)])
  let recipe = createRecipe({ id: 'multi', name: 'Multiple ingredients' })
  recipe = addIngredient(recipe, 'ingredient-a', '11', '100')
  recipe = addIngredient(recipe, 'ingredient-b', '12', '50')
  recipe = setRecipeServings(recipe, '2.5')

  const foods = new Map([['11', first], ['12', second]])
  const total = calculateRecipe(recipe, foods)
  assert.equal(total.totals.protein?.status, 'complete')
  if (total.totals.protein?.status === 'complete') assert.equal(total.totals.protein.value, '11.000000')

  const perServing = calculateRecipe(recipe, foods, { kind: 'per-serving' })
  assert.equal(perServing.totals.protein?.status, 'complete')
  if (perServing.totals.protein?.status === 'complete') {
    assert.equal(perServing.totals.protein.value, '4.400000')
    assert.deepEqual(perServing.totals.protein.exactValue, { numerator: '22', denominator: '5' })
  }
})

test('exact quantity path and aggregate multiplier preserve fractions without intermediate quantization', () => {
  const value = datum('protein', '1', 1003)
  const contribution = calculateNutrient(value, { exactAmount: makeFraction(1n, 3n), unit: 'g' })
  assert.equal(contribution.status, 'complete')
  if (contribution.status !== 'complete') return
  const total = aggregateNutrients([{ itemId: 'third', nutrients: { protein: contribution } }], ['protein'], {
    multiplier: makeFraction(3n, 1n), includeExact: true,
  }).protein
  assert.equal(total?.status, 'complete')
  if (total?.status === 'complete') {
    assert.equal(total.value, '0.010000')
    assert.deepEqual(total.exactValue, { numerator: '1', denominator: '100' })
  }
  // Legacy calls preserve their original output shape and six-decimal serialization.
  assert.deepEqual(aggregateNutrients([{ itemId: 'third', nutrients: { protein: contribution } }], ['protein']).protein, {
    status: 'complete', code: 'protein', value: '0.003333', unit: 'g',
  })
})

test('weight-based allocation records the homogeneity assumption and uses measured edible weight', () => {
  let recipe = addIngredient(createRecipe({ id: 'weighted', name: 'Weighted recipe' }), 'item', '21', '100')
  recipe = setRecipeFinalWeight(recipe, { amount: '500', unit: 'g', weightNature: 'edible' })
  const result = calculateRecipe(recipe, new Map([['21', food('21', 'Food', [datum('protein', '11', 1003)])]]), {
    kind: 'by-weight', consumedWeight: { amount: '125', unit: 'g', weightNature: 'edible' },
  })
  assert.deepEqual(result.allocation, {
    kind: 'by-weight',
    finalWeight: { amount: '500', unit: 'g', weightNature: 'edible' },
    consumedWeight: { amount: '125', unit: 'g', weightNature: 'edible' },
    assumption: 'homogeneous-preparation',
  })
  assert.equal(result.totals.protein?.status, 'complete')
  if (result.totals.protein?.status === 'complete') assert.equal(result.totals.protein.value, '2.750000')
  assert.throws(() => calculateRecipe({ ...recipe, finalWeight: null }, new Map([['21', food('21', 'Food', [datum('protein', '11', 1003)])]]), {
    kind: 'by-weight', consumedWeight: { amount: '10', unit: 'g', weightNature: 'edible' },
  }), { code: 'INVALID_RECIPE_ALLOCATION' })
})

test('unknown ingredients propagate as partial totals rather than zero', () => {
  const known = food('31', 'Known', [datum('protein', '10', 1003)])
  const unknownEquivalence: FoodPortionEquivalence = {
    id: 'unknown-piece', foodId: '32', unit: 'piece', label: 'piece', status: 'unknown', version: 1, reason: 'not-measured',
  }
  const unknown = food('32', 'Unknown portion', [datum('protein', '20', 1003)], { portionEquivalences: [unknownEquivalence] })
  let recipe = addIngredient(createRecipe({ id: 'partial', name: 'Partial' }), 'known-item', '31', '100')
  recipe = addRecipeIngredient(recipe, {
    id: 'unknown-item', foodId: '32',
    quantity: { kind: 'serving', amount: '1', unit: 'piece', equivalenceId: unknownEquivalence.id },
  })
  const result = calculateRecipe(recipe, new Map([['31', known], ['32', unknown]]))
  assert.equal(result.totals.protein?.status, 'partial')
  if (result.totals.protein?.status === 'partial') {
    assert.equal(result.totals.protein.knownSubtotal, '10.000000')
    assert.deepEqual(result.totals.protein.missing, [{ itemId: 'unknown-item', reason: 'portion-equivalence-unvalidated' }])
  }
})

test('recipe edits are immutable values and confirmation snapshots preserve historical data', () => {
  const oldEquivalence = createPortionEquivalence({
    id: 'history-piece', foodId: '41', unit: 'piece', label: 'ancienne pièce', status: 'validated',
    equivalentAmount: '50', equivalentUnit: 'g', weightNature: 'edible',
    provenance: { kind: 'manual', reference: 'ancienne pesée', notes: null },
  })
  const source = food('41', 'Historical food', [datum('protein', '10.125', 1003)], { portionEquivalences: [oldEquivalence] })
  let recipe = addRecipeIngredient(createRecipe({ id: 'history', name: 'Historical recipe' }), {
    id: 'ingredient', foodId: '41',
    quantity: { kind: 'serving', amount: '2', unit: 'piece', equivalenceId: oldEquivalence.id },
  })
  recipe = setRecipeServings(recipe, '2')
  const calculation = calculateRecipe(recipe, new Map([['41', source]]), { kind: 'per-serving' })
  const snapshot = createConfirmedRecipeSnapshot(recipe, calculation, 'nutrition-v2', '2026-11-04T10:00:00.000Z')
  assert.equal(snapshot.ingredients[0]?.sourceNutrients[0]?.status, 'reported')
  assert.equal(snapshot.ingredients[0]?.sourceNutrients[0]?.status === 'reported' ? snapshot.ingredients[0].sourceNutrients[0].sourceValue : null, '10.125')
  assert.equal(snapshot.ingredients[0]?.sourceNutrients[0]?.status === 'reported' ? snapshot.ingredients[0].sourceNutrients[0].basis?.amount : null, '100')
  assert.equal(snapshot.ingredients[0]?.equivalenceSnapshot?.status, 'validated')
  if (snapshot.ingredients[0]?.equivalenceSnapshot?.status === 'validated') {
    assert.equal(snapshot.ingredients[0].equivalenceSnapshot.equivalentAmount, '50')
  }
  assert.deepEqual(snapshot.totals.find((item) => item.code === 'protein')?.exactNumerator, '81')
  assert.deepEqual(snapshot.totals.find((item) => item.code === 'protein')?.exactDenominator, '16')
  assert.equal(Object.isFrozen(snapshot), true)

  const updated = updateRecipeIngredientQuantity(recipe, 'ingredient', { kind: 'physical', amount: '200', unit: 'g', weightNature: 'edible' })
  assert.equal(recipe.ingredients[0]?.quantity.kind, 'serving')
  assert.equal(updated.ingredients[0]?.quantity.amount, '200')
  assert.equal(snapshot.ingredients[0]?.enteredQuantity.kind, 'serving')
  assert.equal(snapshot.ingredients[0]?.resolvedQuantity.status, 'resolved')
  if (snapshot.ingredients[0]?.resolvedQuantity.status === 'resolved') {
    assert.equal(snapshot.ingredients[0].resolvedQuantity.unit, 'g')
    assert.equal(snapshot.ingredients[0].resolvedQuantity.exactNumerator, '100')
    assert.equal(snapshot.ingredients[0].resolvedQuantity.exactDenominator, '1')
  }
  assert.equal(snapshot.totals.find((item) => item.code === 'protein')?.displayedValue, '5.062500')
  const newEquivalence = updatePortionEquivalence(oldEquivalence, { equivalentAmount: '80' })
  assert.equal(newEquivalence.equivalentAmount, '80')
  if (snapshot.ingredients[0]?.equivalenceSnapshot?.status === 'validated') {
    assert.equal(snapshot.ingredients[0].equivalenceSnapshot.equivalentAmount, '50')
  }

  const removed = removeRecipeIngredient(updated, 'ingredient')
  assert.equal(removed.ingredients.length, 0)
  assert.equal(recipe.ingredients.length, 1)
  assert.equal(updateRecipeName(recipe, 'Renamed').name, 'Renamed')
  assert.throws(() => createConfirmedRecipeSnapshot(updated, calculation, 'nutrition-v2', '2026-11-04T10:00:00.000Z'), { code: 'INVALID_RECIPE' })
})

test('recipe validation rejects zero portions and records validated custom equivalences', () => {
  assert.throws(() => setRecipeServings(createRecipe({ id: 'bad', name: 'Bad' }), '0'), { code: 'INVALID_RECIPE' })
  assert.throws(() => createPortionEquivalence({
    id: 'bad-volume', foodId: 'x', unit: 'custom', label: 'volume', status: 'validated',
    equivalentAmount: '10', equivalentUnit: 'ml', weightNature: 'gross',
    provenance: { kind: 'manual', reference: null, notes: null },
  } as never), { code: 'INVALID_PORTION_EQUIVALENCE' })
})
