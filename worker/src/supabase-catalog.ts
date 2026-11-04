/** Server-only access to the Supabase Data API. Do not import this module from frontend code. */
import { parseDecimal } from '../../src/domain/nutrition/decimal.ts'
import { parseJsonWithExactNumbers } from './exact-json.ts'

export type SupabaseCatalogEnv = {
  SUPABASE_URL?: string
  SUPABASE_SECRET_KEY?: string
}

export type CatalogFood = {
  id: string
  source_type: 'usda' | 'local' | 'custom'
  fdc_id: number | null
  description: string
  category: string | null
  data_type: string | null
  brand_owner: string | null
  source_name: string | null
  source_reference: string | null
  source_notes: string | null
  imported_at: string | null
}

export type UsdaNutrient = {
  id: number | null
  name: string
  unitName: string
  value: string | null
  basis: { quantity: number; unit: 'g' | 'ml'; source: string } | null
}

export type UsdaFoodDetail = {
  fdcId: number
  description: string | null
  dataType: string | null
  foodCategory: string | null
  brandOwner: string | null
  nutrients: UsdaNutrient[]
}

type FoodRow = Omit<CatalogFood, 'id'> & { updated_at: string }
export type NutrientRow = {
  food_id: string
  nutrient_code: string
  nutrient_name: string
  fdc_nutrient_id: number | null
  value: string
  unit: string | null
  reference_quantity: string | null
  reference_unit: 'g' | 'ml' | null
  basis_source: string | null
}

export class SupabaseCatalogError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupabaseCatalogError'
  }
}

const FOOD_SELECT = 'id,source_type,fdc_id,description,category,data_type,brand_owner,source_name,source_reference,source_notes,imported_at'
const ALLOWED_BASIS_SOURCES = new Set(['fdc_data_type', 'fdc_branded_standardization', 'source_documentation', 'manual'])

/** Searches the local catalogue by case-insensitive description substring. */
export async function searchCatalogFoods(
  env: SupabaseCatalogEnv,
  query: string,
  limit = 25,
  fetcher: typeof fetch = fetch,
): Promise<CatalogFood[]> {
  const term = query.trim()
  if (!term) throw new SupabaseCatalogError('Un terme de recherche est requis.')
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100)
  const url = restUrl(env, 'foods')
  url.searchParams.set('select', FOOD_SELECT)
  url.searchParams.set('description', `ilike.*${escapeLike(term)}*`)
  url.searchParams.set('order', 'description.asc')
  url.searchParams.set('limit', String(boundedLimit))
  const rows = await requestJson<unknown[]>(url, env, fetcher)
  return rows.map(catalogFoodFromWire)
}

/** Inserts or refreshes a USDA food using the unique FDC ID as its conflict key. */
export async function upsertUsdaFood(
  env: SupabaseCatalogEnv,
  detail: UsdaFoodDetail,
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<CatalogFood> {
  if (!Number.isSafeInteger(detail.fdcId) || detail.fdcId <= 0) throw new SupabaseCatalogError('Identifiant FDC invalide.')
  const description = detail.description?.trim()
  if (!description) throw new SupabaseCatalogError('La description USDA est absente.')
  const importedAt = now.toISOString()
  const row: FoodRow = {
    source_type: 'usda',
    fdc_id: detail.fdcId,
    description,
    category: detail.foodCategory,
    data_type: detail.dataType,
    brand_owner: detail.brandOwner,
    source_name: 'USDA FoodData Central',
    source_reference: `https://fdc.nal.usda.gov/food-details/${detail.fdcId}/nutrients`,
    source_notes: null,
    imported_at: importedAt,
    updated_at: importedAt,
  }
  const url = restUrl(env, 'foods')
  url.searchParams.set('on_conflict', 'fdc_id')
  url.searchParams.set('select', FOOD_SELECT)
  const rows = await requestJson<unknown[]>(url, env, fetcher, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row),
  })
  if (!rows[0]) throw new SupabaseCatalogError('Supabase n’a retourné aucun aliment après import.')
  return catalogFoodFromWire(rows[0])
}

/** Upserts all valid USDA nutrient values; missing/invalid values are skipped. */
export async function upsertUsdaNutrients(
  env: SupabaseCatalogEnv,
  foodId: string,
  nutrients: UsdaNutrient[],
  fetcher: typeof fetch = fetch,
): Promise<NutrientRow[]> {
  if (!foodId.trim()) throw new SupabaseCatalogError('Identifiant interne de l’aliment requis.')
  const rowsByCode = new Map<string, NutrientRow>()
  for (const nutrient of nutrients) {
    if (nutrient.id !== null && (!Number.isSafeInteger(nutrient.id) || nutrient.id <= 0)) continue
    if (typeof nutrient.value !== 'string') continue
    try { parseDecimal(nutrient.value) } catch { continue }
    const name = nutrient.name.trim()
    if (!name) continue
    const nutrientCode = nutrient.id === null
      ? `name:${normalizeNutrientCode(name, nutrient.unitName)}`
      : `fdc:${nutrient.id}`
    if (rowsByCode.has(nutrientCode)) continue
    const basis = validBasis(nutrient.basis)
    rowsByCode.set(nutrientCode, {
      food_id: foodId,
      nutrient_code: nutrientCode,
      nutrient_name: name,
      fdc_nutrient_id: nutrient.id,
      value: nutrient.value,
      unit: nutrient.unitName || null,
      reference_quantity: basis ? String(basis.quantity) : null,
      reference_unit: basis?.unit ?? null,
      basis_source: basis?.source ?? null,
    })
  }
  const rows = [...rowsByCode.values()]
  if (!rows.length) return []

  const url = restUrl(env, 'food_nutrients')
  url.searchParams.set('on_conflict', 'food_id,nutrient_code')
  url.searchParams.set('select', 'food_id,nutrient_code,nutrient_name,fdc_nutrient_id,value,unit,reference_quantity,reference_unit,basis_source')
  const saved = await requestJson<unknown[]>(url, env, fetcher, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(rows),
  })
  return saved.map(nutrientRowFromWire)
}

/** Idempotent two-step import. A failed nutrient upsert can safely be retried by FDC ID. */
export async function importUsdaFood(
  env: SupabaseCatalogEnv,
  detail: UsdaFoodDetail,
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<{ food: CatalogFood; nutrients: NutrientRow[] }> {
  const food = await upsertUsdaFood(env, detail, fetcher, now)
  const nutrients = await upsertUsdaNutrients(env, food.id, detail.nutrients, fetcher)
  return { food, nutrients }
}

function validBasis(basis: UsdaNutrient['basis']): UsdaNutrient['basis'] {
  if (!basis || basis.quantity <= 0 || !Number.isFinite(basis.quantity)) return null
  if (basis.unit !== 'g' && basis.unit !== 'ml') return null
  if (!ALLOWED_BASIS_SOURCES.has(basis.source)) return null
  return basis
}

function restUrl(env: SupabaseCatalogEnv, table: string): URL {
  const base = env.SUPABASE_URL?.trim()
  const key = env.SUPABASE_SECRET_KEY?.trim()
  if (!base || !key) throw new SupabaseCatalogError('SUPABASE_URL et SUPABASE_SECRET_KEY doivent être configurées côté Worker.')
  let url: URL
  try {
    url = new URL(base)
  } catch {
    throw new SupabaseCatalogError('SUPABASE_URL est invalide.')
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new SupabaseCatalogError('SUPABASE_URL doit utiliser HTTPS.')
  }
  url.pathname = `${url.pathname.replace(/\/$/, '')}/rest/v1/${table}`
  return url
}

async function requestJson<T>(url: URL, env: SupabaseCatalogEnv, fetcher: typeof fetch, init: RequestInit = {}): Promise<T> {
  const key = env.SUPABASE_SECRET_KEY?.trim()
  if (!key) throw new SupabaseCatalogError('SUPABASE_SECRET_KEY doit être configurée côté Worker.')
  let response: Response
  try {
    response = await fetcher(url, {
      ...init,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new SupabaseCatalogError('Supabase est temporairement inaccessible.')
  }
  if (!response.ok) throw new SupabaseCatalogError(`Supabase a refusé la requête (HTTP ${response.status}).`)
  try {
    return parseJsonWithExactNumbers(await response.text()) as T
  } catch {
    throw new SupabaseCatalogError('Supabase a retourné une réponse invalide.')
  }
}

function catalogFoodFromWire(value: unknown): CatalogFood {
  if (!isRecord(value)) throw new SupabaseCatalogError('Supabase a retourné un aliment invalide.')
  const fdcId = optionalSafeInteger(value.fdc_id)
  return {
    id: requiredString(value.id),
    source_type: value.source_type as CatalogFood['source_type'],
    fdc_id: fdcId,
    description: requiredString(value.description),
    category: optionalString(value.category),
    data_type: optionalString(value.data_type),
    brand_owner: optionalString(value.brand_owner),
    source_name: optionalString(value.source_name),
    source_reference: optionalString(value.source_reference),
    source_notes: optionalString(value.source_notes),
    imported_at: optionalString(value.imported_at),
  }
}

function nutrientRowFromWire(value: unknown): NutrientRow {
  if (!isRecord(value)) throw new SupabaseCatalogError('Supabase a retourné un nutriment invalide.')
  const exactValue = numericText(value.value)
  if (exactValue === null) throw new SupabaseCatalogError('Supabase a retourné une valeur nutritionnelle invalide.')
  const referenceQuantity = value.reference_quantity === null ? null : numericText(value.reference_quantity)
  if (value.reference_quantity !== null && referenceQuantity === null) throw new SupabaseCatalogError('Supabase a retourné une base nutritionnelle invalide.')
  return {
    food_id: requiredString(value.food_id),
    nutrient_code: requiredString(value.nutrient_code),
    nutrient_name: requiredString(value.nutrient_name),
    fdc_nutrient_id: optionalSafeInteger(value.fdc_nutrient_id),
    value: exactValue,
    unit: optionalString(value.unit),
    reference_quantity: referenceQuantity,
    reference_unit: value.reference_unit === 'g' || value.reference_unit === 'ml' ? value.reference_unit : null,
    basis_source: optionalString(value.basis_source),
  }
}

function optionalSafeInteger(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null
  if (typeof value === 'string' && /^-?(?:0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

function numericText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try { parseDecimal(value); return value } catch { return null }
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new SupabaseCatalogError('Supabase a retourné un champ texte invalide.')
  return value
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_*]/g, (character) => `\\${character}`)
}

function normalizeNutrientCode(name: string, unit: string): string {
  const normalizedName = name.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const normalizedUnit = unit.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return `${normalizedName.replace(/^-|-$/g, '')}${normalizedUnit ? `:${normalizedUnit}` : ''}`
}
