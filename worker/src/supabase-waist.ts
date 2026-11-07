import type { SupabaseCatalogEnv } from './supabase-catalog.ts'
import { ProfileError } from './supabase-profile.ts'

function scoped(env: SupabaseCatalogEnv, userId: string) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new ProfileError(503, 'Tour de taille indisponible.')
  const url = new URL(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/waist_measurements')
  url.searchParams.set('user_id', 'eq.' + userId)
  const headers = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY }
  return { url, headers }
}

type WaistRow = { id: string; measured_on: string; waist_cm: number | string }
const map = (row: WaistRow) => ({ id: row.id, measuredOn: row.measured_on, waistCm: Number(row.waist_cm) })

export async function listWaist(env: SupabaseCatalogEnv, userId: string, fetcher: typeof fetch) {
  const { url, headers } = scoped(env, userId)
  url.searchParams.set('select', 'id,measured_on,waist_cm')
  url.searchParams.set('order', 'measured_on.desc,created_at.desc,id.desc')
  url.searchParams.set('limit', '150')
  const response = await fetcher(url, { headers, cache: 'no-store' })
  if (!response.ok) throw new ProfileError(502, 'Impossible de charger le tour de taille.')
  return (await response.json() as WaistRow[]).map(map)
}

export async function addWaist(env: SupabaseCatalogEnv, userId: string, input: unknown, fetcher: typeof fetch) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProfileError(400, 'Mesure invalide.')
  const { measuredOn, waistCm } = input as Record<string, unknown>
  if (typeof measuredOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(measuredOn)) throw new ProfileError(400, 'Date invalide.')
  const date = new Date(measuredOn + 'T00:00:00Z')
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== measuredOn) throw new ProfileError(400, 'Date invalide.')
  if (typeof waistCm !== 'number' || !Number.isFinite(waistCm) || waistCm < 30 || waistCm > 300) throw new ProfileError(400, 'Indiquez un tour de taille entre 30 et 300 cm.')
  const { url, headers } = scoped(env, userId)
  url.search = ''
  const response = await fetcher(url, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: userId, measured_on: measuredOn, waist_cm: Math.round(waistCm * 10) / 10 }),
  })
  if (!response.ok) throw new ProfileError(502, 'Impossible d’enregistrer le tour de taille.')
  const [row] = await response.json() as WaistRow[]
  if (!row) throw new ProfileError(502, 'Confirmation de mesure indisponible.')
  return map(row)
}

export async function deleteWaist(env: SupabaseCatalogEnv, userId: string, id: string, fetcher: typeof fetch) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new ProfileError(400, 'Identifiant de mesure invalide.')
  const { url, headers } = scoped(env, userId)
  url.searchParams.set('id', 'eq.' + id)
  const response = await fetcher(url, { method: 'DELETE', headers })
  if (!response.ok) throw new ProfileError(502, 'Impossible de supprimer le tour de taille.')
}
