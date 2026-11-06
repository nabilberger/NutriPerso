import {catalogNutrientCode} from '../../src/catalog-nutrition.ts'
import {parseJsonWithExactNumbers} from './exact-json.ts'
import {decimalToFraction,parseDecimal} from '../../src/domain/nutrition/decimal.ts'
import { emptyPersonalFood, validatePersonalFood, type PersonalFood } from '../../src/personal-food.ts'
import type { SupabaseCatalogEnv } from './supabase-catalog.ts'
export class PersonalFoodError extends Error {
  readonly status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}
async function api(env: SupabaseCatalogEnv, path: string, fetcher: typeof fetch, init: RequestInit = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new PersonalFoodError('Catalogue personnel non configuré.', 503)
  let response: Response
  try { response = await fetcher(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + path, { ...init, headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'content-type': 'application/json', ...init.headers } }) }
  catch { throw new PersonalFoodError('Catalogue momentanément inaccessible.', 502) }
  if (!response.ok) {
    const text = await response.text()
    throw new PersonalFoodError(/PERSONAL_FOOD_CONFLICT|PERSONAL_FOOD_OWNER|40001/.test(text) || response.status === 409 ? 'Cette fiche a changé. Rechargez la version actuelle avant de réessayer.' : 'Enregistrement du catalogue impossible.', /PERSONAL_FOOD_CONFLICT|PERSONAL_FOOD_OWNER|40001/.test(text) || response.status === 409 ? 409 : 502)
  }
  return response.json() as Promise<Array<{ id: string; user_id: string; revision: number; archived: boolean; personal_document: PersonalFood | null; description: string; category: string | null; source_reference: string | null; source_notes: string | null }>>
}
const select = 'id,user_id,revision,archived,personal_document,description,category,source_reference,source_notes'
export async function listPersonalFoods(env: SupabaseCatalogEnv, userId: string, fetcher: typeof fetch) {
  const rows = await api(env, 'foods?select=' + select + '&source_type=eq.custom&user_id=eq.' + encodeURIComponent(userId) + '&order=updated_at.desc&limit=200', fetcher)
  if (rows.some(r => r.user_id !== userId)) throw new PersonalFoodError('Réponse du catalogue invalide.', 502)
  return rows.map(r => ({ id: r.id, name: r.description, revision: r.revision, archived: r.archived }))
}
export async function getPersonalFood(env: SupabaseCatalogEnv, userId: string, id: string, fetcher: typeof fetch): Promise<PersonalFood | null> {
  const rows = await api(env, 'foods?select=' + select + '&source_type=eq.custom&user_id=eq.' + encodeURIComponent(userId) + '&id=eq.' + encodeURIComponent(id), fetcher)
  if (!rows.length) return null
  const row = rows[0]!
  if (row.user_id !== userId || row.id !== id) return null
  if (row.personal_document) { validatePersonalFood(row.personal_document); return row.personal_document }
  // A legacy shared custom entry has no document. Only exact 100 g/ml bases are imported into the editor.
  const food = { ...emptyPersonalFood(row.id), name: row.description, category: row.category ?? '', reference: row.source_reference ?? '', notes: row.source_notes ?? '', revision: row.revision, archived: row.archived }
  const response = await fetcher(env.SUPABASE_URL!.replace(/\/$/, '') + '/rest/v1/food_nutrients?food_id=eq.' + id + '&select=*', { headers: { apikey: env.SUPABASE_SECRET_KEY!, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY! } })
  if (!response.ok) throw new PersonalFoodError('Valeurs de la fiche ancienne indisponibles.', 502)
  const nutrients = parseJsonWithExactNumbers(await response.text()) as Array<{ nutrient_code: string; fdc_nutrient_id: number | null; value: string | number; unit: string; reference_quantity: string | number | null; reference_unit: 'g' | 'ml' | null }>
  let basis: 'g' | 'ml' | null = null
  const seen=new Set<string>()
  const priority=(id:number|null)=>({2048:0,2047:1,1008:2}[id??0]??3)
  for (const n of nutrients.sort((a,b)=>priority(a.fdc_nutrient_id)-priority(b.fdc_nutrient_id))) {
    const code = catalogNutrientCode(n)
    if (!code || !(code in food.nutrients)) continue
    if(seen.has(code)){if(code==='energy')continue;throw new PersonalFoodError('Plusieurs références nutritionnelles existent pour ce nutriment. Une conversion explicite est nécessaire avant édition.',409)}
    seen.add(code)
    const reference = n.reference_quantity === null ? null : decimalToFraction(parseDecimal(String(n.reference_quantity)))
    if (!reference || reference.numerator !== 100n * reference.denominator || !n.reference_unit || (basis && basis !== n.reference_unit)) throw new PersonalFoodError('Cette fiche ancienne nécessite une conversion explicite vers une base commune de 100 g ou 100 ml avant édition.', 409)
    basis = n.reference_unit; food.basis = basis
    food.nutrients[code as keyof PersonalFood['nutrients']] = { value: String(n.value), unit: (n.unit.trim().toLowerCase()==='kj'?'kJ':n.unit.trim().toLowerCase()) as PersonalFood['nutrients']['energy']['unit'] }
  }
  validatePersonalFood(food); return food
}
export async function savePersonalFood(env: SupabaseCatalogEnv, userId: string, value: unknown, expectedRevision: number, fetcher: typeof fetch) {
  validatePersonalFood(value)
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || value.revision !== expectedRevision + 1 || value.archived) throw new PersonalFoodError('Révision de fiche invalide.')
  const rows = await api(env, 'rpc/save_personal_food', fetcher, { method: 'POST', body: JSON.stringify({ p_user_id: userId, p_food_id: value.id, p_expected_revision: expectedRevision, p_document: value }) })
  if (!rows[0] || rows[0].user_id !== userId || !rows[0].personal_document) throw new PersonalFoodError('Réponse d’enregistrement invalide.', 502)
  validatePersonalFood(rows[0].personal_document); return rows[0].personal_document
}
export async function archivePersonalFood(env: SupabaseCatalogEnv, userId: string, id: string, expectedRevision: number, fetcher: typeof fetch) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new PersonalFoodError('Révision de fiche invalide.')
  const rows = await api(env, 'rpc/archive_personal_food', fetcher, { method: 'POST', body: JSON.stringify({ p_user_id: userId, p_food_id: id, p_expected_revision: expectedRevision }) })
  if (!rows[0] || rows[0].user_id !== userId) throw new PersonalFoodError('Fiche introuvable.', 404)
}
