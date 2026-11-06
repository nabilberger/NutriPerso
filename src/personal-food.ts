import { decimalToFraction, parseDecimal } from './domain/nutrition/decimal.ts'
import { createPortionEquivalence, type FoodPortionEquivalence, type PortionUnit } from './domain/nutrition/portions.ts'
import type { FoodNutritionSnapshot } from './domain/nutrition/recipes.ts'
import { NUTRIENT_CODES, type NutrientCode, type NutrientSourceUnit } from './domain/nutrition/types.ts'
export type PersonalPortion = { id: string; label: string; unit: PortionUnit; amount: string | null; basis: 'g' | 'ml' }
export type PersonalFood = {
  id: string; name: string; category: string; reference: string; notes: string; revision: number; archived: boolean
  basis: 'g' | 'ml'; nutrients: Record<NutrientCode, { value: string | null; unit: NutrientSourceUnit }>; portions: PersonalPortion[]
}
export function emptyPersonalFood(id: string): PersonalFood {
  return { id, name: '', category: '', reference: '', notes: '', revision: 1, archived: false, basis: 'g', portions: [],
    nutrients: { energy: { value: null, unit: 'kcal' }, protein: { value: null, unit: 'g' }, carbohydrate: { value: null, unit: 'g' }, fat: { value: null, unit: 'g' }, fiber: { value: null, unit: 'g' } } }
}
export function validatePersonalFood(value: unknown): asserts value is PersonalFood {
  if (!value || typeof value !== 'object') throw new Error('Fiche alimentaire invalide.')
  const food = value as PersonalFood
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(food.id)
    || typeof food.name !== 'string' || !food.name.trim() || food.name.length > 200
    || !['category', 'reference', 'notes'].every(k => typeof food[k as keyof PersonalFood] === 'string')
    || !Number.isSafeInteger(food.revision) || food.revision < 1 || typeof food.archived !== 'boolean'
    || !['g', 'ml'].includes(food.basis) || !food.nutrients || !Array.isArray(food.portions) || food.portions.length > 50) throw new Error('Nom, référence, base ou révision invalide.')
  for (const code of NUTRIENT_CODES) {
    const datum = food.nutrients[code]
    if (!datum || !(code === 'energy' ? ['kcal', 'kJ'] : ['g', 'mg']).includes(datum.unit)) throw new Error('Unité nutritionnelle invalide.')
    if (datum.value !== null) {
      if (typeof datum.value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(datum.value)
        || decimalToFraction(parseDecimal(datum.value)).numerator < 0n) throw new Error('Valeur nutritionnelle invalide : utilisez un nombre positif ou zéro, ou laissez vide pour inconnu.')
    }
  }
  const ids = new Set<string>()
  for (const portion of food.portions) {
    if (!portion || typeof portion.id !== 'string' || !portion.id || ids.has(portion.id) || typeof portion.label !== 'string' || !portion.label.trim()
      || !['piece', 'slice', 'teaspoon', 'tablespoon', 'custom'].includes(portion.unit)
      || !['g', 'ml'].includes(portion.basis)) throw new Error('Équivalence invalide ou identifiant répété.')
    ids.add(portion.id)
    portionEquivalence(food, portion) // The existing domain validator enforces positivity, bounds, provenance and units.
  }
}
function portionEquivalence(food: PersonalFood, portion: PersonalPortion): FoodPortionEquivalence {
  const base = { id: portion.id, foodId: 'catalog:' + food.id, label: portion.label, unit: portion.unit }
  const created = portion.amount === null ? createPortionEquivalence({ ...base, status: 'unknown', reason: 'not-measured' })
    : portion.basis === 'g' ? createPortionEquivalence({ ...base, status: 'validated', equivalentAmount: portion.amount, equivalentUnit: 'g', weightNature: 'edible', provenance: { kind: 'manual', reference: food.reference || null, notes: food.notes || null } })
      : createPortionEquivalence({ ...base, status: 'validated', equivalentAmount: portion.amount, equivalentUnit: 'ml', weightNature: 'not-applicable', provenance: { kind: 'manual', reference: food.reference || null, notes: food.notes || null } })
  return { ...created, version: food.revision }
}
export function personalFoodSnapshot(food: PersonalFood): FoodNutritionSnapshot {
  validatePersonalFood(food)
  const source = { sourceType: 'custom' as const, sourceName: 'Saisie personnelle', sourceReference: food.reference || null, nutrientSourceId: null }
  return { foodId: 'catalog:' + food.id, sourceType: 'custom', fdcId: null, description: food.name, category: food.category || null, dataType: null, brandOwner: null,
    sourceName: source.sourceName, sourceReference: source.sourceReference, sourceNotes: food.notes || null,
    nutrients: NUTRIENT_CODES.map(code => food.nutrients[code].value === null
      ? { status: 'missing' as const, code, reason: 'not-reported' as const, source }
      : { status: 'reported' as const, code, sourceValue: food.nutrients[code].value!, sourceUnit: food.nutrients[code].unit, basis: { amount: '100', unit: food.basis, source: 'manual' as const }, source }),
    portionEquivalences: food.portions.map(p => portionEquivalence(food, p)), edibleYieldConversions: [] }
}
export function withFoodIdentity(food: FoodNutritionSnapshot, foodId: string): FoodNutritionSnapshot {
  return { ...food, foodId, portionEquivalences: food.portionEquivalences.map(p => ({ ...p, foodId })), edibleYieldConversions: food.edibleYieldConversions.map(p => ({ ...p, foodId })) }
}
