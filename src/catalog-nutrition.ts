import { personalFoodSnapshot, type PersonalFood } from './personal-food.ts'
import type { FoodNutritionSnapshot } from './domain/nutrition/recipes.ts'
import type { BasisSource, NutrientCode, NutrientDatum, NutrientSourceUnit } from './domain/nutrition/types.ts'

export type CatalogEntry = {
  user_id?: string | null; revision?: number; archived?: boolean; personal_document?: PersonalFood | null
  id: string; source_type: 'usda' | 'local' | 'custom'; fdc_id: number | null; description: string
  category: string | null; data_type: string | null; brand_owner: string | null
  source_name: string | null; source_reference: string | null; source_notes: string | null; imported_at: string | null
}
export type CatalogNutrient = { nutrient_code: string; fdc_nutrient_id: number | null; value: string; unit: string | null;
  reference_quantity: string | null; reference_unit: 'g' | 'ml' | null; basis_source: string | null }
export function catalogNutrientCode(row:Pick<CatalogNutrient,'fdc_nutrient_id'|'nutrient_code'>):NutrientCode|undefined {
  const codes: Record<number, NutrientCode> = { 1008: 'energy', 2047: 'energy', 2048: 'energy', 1003: 'protein', 1004: 'fat', 1005: 'carbohydrate', 1079: 'fiber' }
  return row.fdc_nutrient_id === null ? ({ energy: 'energy', energie: 'energy', protein: 'protein', proteines: 'protein', carbohydrate: 'carbohydrate', carbohydrates: 'carbohydrate', 'carbohydrate-by-difference': 'carbohydrate', glucides: 'carbohydrate', fat: 'fat', 'total-lipid-fat': 'fat', lipides: 'fat', fiber: 'fiber', fibres: 'fiber' } as Record<string, NutrientCode>)[row.nutrient_code.replace(/^name:/, '').split(':')[0]!] : codes[row.fdc_nutrient_id]
}
/** Preserve the source's exact decimals and reference basis; absent nutrients stay absent. */
export function catalogNutritionSnapshot(food: CatalogEntry, rows: readonly CatalogNutrient[]): FoodNutritionSnapshot {
  if (food.personal_document) return personalFoodSnapshot(food.personal_document)
  const nutrients: NutrientDatum[] = []
  for (const row of rows) {
    const code = catalogNutrientCode(row)
    if (!code) continue
    const normalizedUnit = row.unit?.trim().toLowerCase().replaceAll('μ', 'µ')
    const unit = normalizedUnit === 'kj' ? 'kJ' : normalizedUnit
    const source = { sourceType: food.source_type, sourceName: food.source_name ?? 'Catalogue NutriPerso', sourceReference: food.source_reference ?? food.id,
      nutrientSourceId: row.fdc_nutrient_id }
    if (!['kcal', 'kJ', 'g', 'mg', 'ug', 'µg'].includes(unit ?? '')) {
      nutrients.push({ status: 'missing', code, reason: 'invalid-source-value', source }); continue
    }
    nutrients.push({ status: 'reported', code, sourceValue: row.value, sourceUnit: unit as NutrientSourceUnit,
      basis: row.reference_quantity && row.reference_unit ? { amount: row.reference_quantity, unit: row.reference_unit,
        source: ['manual', 'source_documentation', 'fdc_data_type', 'fdc_branded_standardization'].includes(row.basis_source ?? '') ? row.basis_source as BasisSource : 'source_documentation' } : null, source })
  }
  return { foodId: 'catalog:' + food.id, sourceType: food.source_type, fdcId: food.fdc_id, description: food.description,
    category: food.category, dataType: food.data_type, brandOwner: food.brand_owner, sourceName: food.source_name,
    sourceReference: food.source_reference, sourceNotes: food.source_notes, nutrients, portionEquivalences: [], edibleYieldConversions: [] }
}
