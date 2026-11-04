import type { SupabaseCatalogEnv } from './supabase-catalog.ts'

export type Profile = {
  displayName: string
  avatarDataUrl: string | null
  heightCm: number | null
  targetWeightKg: number | null
  goal: 'maintain' | 'lose' | 'gain'
  dietaryPattern: 'mediterranean' | 'vegetarian' | 'vegan' | 'other'
  mealsPerDay: number
  fastingEnabled: boolean
  fastingStart: string | null
  fastingEnd: string | null
  avoidAddedSalt: boolean
  avoidAddedSugar: boolean
  notes: string
  timeZone: string
}
const defaults: Profile = {
  displayName: '', avatarDataUrl: null, heightCm: null, targetWeightKg: null,
  goal: 'maintain', dietaryPattern: 'mediterranean', mealsPerDay: 2,
  fastingEnabled: false, fastingStart: null, fastingEnd: null,
  avoidAddedSalt: false, avoidAddedSugar: false, notes: '', timeZone: 'Africa/Casablanca',
}
const fields = ['display_name','avatar_data_url','height_cm','target_weight_kg','goal','dietary_pattern','meals_per_day','fasting_enabled','fasting_start','fasting_end','avoid_added_salt','avoid_added_sugar','notes','time_zone'] as const
export class ProfileError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
function endpoint(env: SupabaseCatalogEnv): string {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new ProfileError(503, 'Le profil est momentanément indisponible.')
  return env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/user_profiles'
}
function headers(env: SupabaseCatalogEnv, extra: Record<string,string> = {}): HeadersInit {
  return { apikey: env.SUPABASE_SECRET_KEY!, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY!, Accept: 'application/json', ...extra }
}
function isRecord(v: unknown): v is Record<string,unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v) }
function text(v: unknown, max: number): string { if (typeof v !== 'string' || v.length > max) throw new ProfileError(400, 'Un champ texte du profil est invalide.'); return v }
function optionalNumber(v: unknown, min: number, max: number): number|null {
  if (v === null) return null
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new ProfileError(400, 'Une mesure du profil est invalide.')
  return Math.round(v * 10) / 10
}
function oneOf<T extends string>(v: unknown, options: readonly T[]): T {
  if (!options.includes(v as T)) throw new ProfileError(400, 'Une préférence est invalide.')
  return v as T
}
function optionalTime(v: unknown): string|null {
  if (v === null) return null
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new ProfileError(400, 'Heure invalide.')
  return v
}
function validate(v: unknown): Profile {
  if (!isRecord(v)) throw new ProfileError(400, 'Profil invalide.')
  if (typeof v.fastingEnabled !== 'boolean' || typeof v.avoidAddedSalt !== 'boolean' || typeof v.avoidAddedSugar !== 'boolean')
    throw new ProfileError(400,'Les préférences doivent être des booléens.')
  if (!Number.isInteger(v.mealsPerDay) || (v.mealsPerDay as number) < 1 || (v.mealsPerDay as number) > 6) throw new ProfileError(400,'Nombre de repas invalide.')
  const avatar = v.avatarDataUrl === null ? null : text(v.avatarDataUrl,90000)
  if (avatar !== null && !/^data:image\/(jpeg|webp|png);base64,[a-zA-Z0-9+/=]+$/.test(avatar)) throw new ProfileError(400,'Format de photo invalide.')
  const zone = text(v.timeZone,80)
  try { new Intl.DateTimeFormat('fr', {timeZone:zone}) } catch { throw new ProfileError(400,'Fuseau horaire invalide.') }
  return {
    displayName:text(v.displayName,80).trim(), avatarDataUrl:avatar,
    heightCm:optionalNumber(v.heightCm,80,250),
    targetWeightKg:optionalNumber(v.targetWeightKg,25,350),
    goal:oneOf(v.goal,['maintain','lose','gain'] as const),
    dietaryPattern:oneOf(v.dietaryPattern,['mediterranean','vegetarian','vegan','other'] as const),
    mealsPerDay:v.mealsPerDay as number,
    fastingEnabled:v.fastingEnabled, fastingStart:optionalTime(v.fastingStart), fastingEnd:optionalTime(v.fastingEnd),
    avoidAddedSalt:v.avoidAddedSalt, avoidAddedSugar:v.avoidAddedSugar,
    notes:text(v.notes,1200), timeZone:zone,
  }
}
function readRow(row: unknown): Profile {
  if (!isRecord(row)) throw new ProfileError(502, 'Réponse invalide du stockage de profil.')
  return {
    displayName:String(row.display_name ?? ''),
    avatarDataUrl:typeof row.avatar_data_url==='string' ? row.avatar_data_url:null,
    heightCm:row.height_cm===null?null:Number(row.height_cm),
    targetWeightKg:row.target_weight_kg===null?null:Number(row.target_weight_kg),
    goal:row.goal as Profile['goal'], dietaryPattern:row.dietary_pattern as Profile['dietaryPattern'],
    mealsPerDay:Number(row.meals_per_day), fastingEnabled:row.fasting_enabled===true,
    fastingStart:typeof row.fasting_start==='string'?row.fasting_start.slice(0,5):null,
    fastingEnd:typeof row.fasting_end==='string'?row.fasting_end.slice(0,5):null,
    avoidAddedSalt:row.avoid_added_salt===true, avoidAddedSugar:row.avoid_added_sugar===true,
    notes:String(row.notes??''),timeZone:String(row.time_zone??'Africa/Casablanca'),
  }
}
export async function getProfile(env: SupabaseCatalogEnv, userId: string, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<Profile> {
  const url=new URL(endpoint(env));url.searchParams.set('user_id','eq.'+userId);url.searchParams.set('select',fields.join(','))
  const response=await fetcher(url.toString(), {headers:headers(env),cache:'no-store'})
  if (!response.ok) throw new ProfileError(502,'Impossible de charger le profil.')
  const rows:unknown=await response.json()
  if (!Array.isArray(rows)) throw new ProfileError(502,'Réponse invalide du profil.')
  return rows.length ? readRow(rows[0]) : {...defaults}
}
export async function saveProfile(env: SupabaseCatalogEnv, userId: string, input: unknown, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<Profile> {
  const p=validate(input)
  const url=new URL(endpoint(env));url.searchParams.set('on_conflict','user_id')
  const row={
    user_id:userId, display_name:p.displayName,avatar_data_url:p.avatarDataUrl,
    height_cm:p.heightCm,target_weight_kg:p.targetWeightKg,goal:p.goal,dietary_pattern:p.dietaryPattern,
    meals_per_day:p.mealsPerDay,fasting_enabled:p.fastingEnabled,fasting_start:p.fastingStart,fasting_end:p.fastingEnd,
    avoid_added_salt:p.avoidAddedSalt,avoid_added_sugar:p.avoidAddedSugar,notes:p.notes,time_zone:p.timeZone,updated_at:new Date().toISOString(),
  }
  const response=await fetcher(url.toString(),{method:'POST',headers:headers(env,{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=representation'}),body:JSON.stringify(row),cache:'no-store'})
  if (!response.ok) throw new ProfileError(502,'Impossible d’enregistrer le profil.')
  const rows:unknown=await response.json()
  if (!Array.isArray(rows)||!rows[0]) throw new ProfileError(502,'Confirmation de profil invalide.')
  return readRow(rows[0])
}
