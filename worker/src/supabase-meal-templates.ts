import type { SupabaseCatalogEnv } from './supabase-catalog.ts'

export type MealTemplate = {
  readonly id: string
  readonly name: string
  readonly revision: number
  readonly meal: Record<string, unknown>
  readonly createdAt: string
  readonly updatedAt: string
}
export type MealTemplateScope = { readonly userId: string }
export class MealTemplateError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
type Row = { id: string; user_id: string; name: string; revision: number; template: Record<string, unknown>; created_at: string; updated_at: string }

export async function listMealTemplates(env: SupabaseCatalogEnv, scope: MealTemplateScope, fetcher: typeof fetch = fetch): Promise<MealTemplate[]> {
  const url = tableUrl(env)
  url.searchParams.set('select', 'id,user_id,name,revision,template,created_at,updated_at')
  url.searchParams.set('user_id', `eq.${scope.userId}`)
  url.searchParams.set('order', 'updated_at.desc')
  const rows = await request<Row[]>(env, url, fetcher)
  return rows.map((row) => fromRow(row, scope.userId))
}
export async function saveMealTemplate(env: SupabaseCatalogEnv, scope: MealTemplateScope, input: unknown, expectedRevision: number | null, fetcher: typeof fetch = fetch): Promise<MealTemplate> {
  if (!isRecord(input) || !isRecord(input.meal) || typeof input.id !== 'string' || !isUuid(input.id)
    || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80
    || !Number.isSafeInteger(input.revision) || (input.revision as number) < 1) throw new MealTemplateError(400, 'Le modèle est invalide.')
  if (expectedRevision !== null && input.revision !== expectedRevision + 1) throw new MealTemplateError(409, 'La révision suivante est requise.')
  const template = { ...input.meal, id: input.id, name: input.name.trim(), revision: input.revision }
  const url = tableUrl(env); url.pathname = '/rest/v1/rpc/save_meal_template_atomic'
  const response = await fetcher(url, { method: 'POST', headers: headers(env, 'return=representation'), body: JSON.stringify({
    p_user_id: scope.userId, p_template_id: input.id, p_name: input.name.trim(),
    p_revision: input.revision, p_template: template, p_expected_revision: expectedRevision,
  }) })
  if (response.status === 409 || response.status === 400) throw new MealTemplateError(409, 'Le modèle a été modifié ailleurs ou ses données sont invalides.')
  if (!response.ok) throw new MealTemplateError(502, 'Le modèle et sa révision n’ont pas pu être enregistrés.')
  const rows = await response.json() as Row[]
  if (!Array.isArray(rows) || rows.length !== 1) throw new MealTemplateError(409, 'Révision du modèle incompatible.')
  return fromRow(rows[0]!, scope.userId)
}
export async function deleteMealTemplate(env: SupabaseCatalogEnv, scope: MealTemplateScope, id: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (!isUuid(id)) throw new MealTemplateError(400, 'Identifiant de modèle invalide.')
  const url = tableUrl(env); url.searchParams.set('id', `eq.${id}`); url.searchParams.set('user_id', `eq.${scope.userId}`)
  const response = await fetcher(url, { method: 'DELETE', headers: headers(env, 'return=minimal') })
  if (!response.ok) throw new MealTemplateError(response.status, 'Le modèle n’a pas pu être supprimé.')
}
function fromRow(row: Row, owner: string): MealTemplate {
  if (!row || row.user_id !== owner || !isUuid(row.id) || !isRecord(row.template) || row.template.id !== row.id
    || row.template.name !== row.name || row.template.revision !== row.revision) throw new MealTemplateError(502, 'Réponse de modèle invalide.')
  return { id: row.id, name: row.name, revision: row.revision, meal: row.template, createdAt: row.created_at, updatedAt: row.updated_at }
}
function tableUrl(env: SupabaseCatalogEnv): URL { if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new MealTemplateError(503, 'Stockage des modèles non configuré.'); return new URL('/rest/v1/meal_templates', env.SUPABASE_URL) }
function headers(env: SupabaseCatalogEnv, prefer: string): HeadersInit { return { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, 'content-type': 'application/json', prefer } }
async function request<T>(env: SupabaseCatalogEnv, url: URL, fetcher: typeof fetch): Promise<T> { const r = await fetcher(url, { headers: headers(env, 'return=representation') }); if (!r.ok) throw new MealTemplateError(502, 'Les modèles n’ont pas pu être chargés.'); return await r.json() as T }
function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v) }
function isUuid(v: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v) }
