import { validatePhotoData } from '../../src/photo-analysis.ts'
import { geminiPhoto, type PhotoAI } from './gemini-photo.ts'
export type PhotoEnv = { GEMINI_API_KEY?: string; GEMINI_MODEL?: string; AI_REQUEST_MAX_DH?: string; MEAL_PHOTOS?: R2Bucket; SUPABASE_URL?: string; SUPABASE_SECRET_KEY?: string }
export async function photoRpc(env: PhotoEnv, name: string, body: unknown, fetcher: typeof fetch = fetch) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error('Configuration IA indisponible.')
  const r = await fetcher(env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/rpc/'+name, { method:'POST', signal:AbortSignal.timeout(10000), headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json'},body:JSON.stringify(body) })
  if (!r.ok) throw new Error('Budget IA indisponible ou limite atteinte. La saisie manuelle reste disponible.')
  return r.json()
}
export async function analyzePhoto(env: PhotoEnv, user: string, input: unknown, fetcher: typeof fetch, provider?: PhotoAI) {
  if (!env.MEAL_PHOTOS || !env.GEMINI_API_KEY || !env.GEMINI_MODEL || !/^[a-zA-Z0-9.-]+$/.test(env.GEMINI_MODEL)) throw new Error('Analyse photo non configurée.')
  const bound = Number(env.AI_REQUEST_MAX_DH)
  if (!Number.isFinite(bound) || bound <= 0 || bound > 5) throw new Error('Borne de coût IA non configurée.')
  const x = input as { id?:unknown; photo?: unknown }
  if (!x || typeof x.id !== 'string' || !/^[0-9a-f-]{36}$/.test(x.id)) throw new Error('Identifiant analyse invalide.')
  const data = validatePhotoData(x.photo)
  // Atomic global monthly budget and daily cap; errors/uncertain outcomes remain reserved.
  await photoRpc(env,'reserve_photo_analysis',{p_user:user,p_id:x.id,p_cost:bound,p_model:env.GEMINI_MODEL},fetcher)
  const id = x.id
  const key = `${user}/${id}.jpg`
  const expires = Date.now()+30*86400000
  const bytes = Uint8Array.from(atob(data), c=>c.charCodeAt(0))
  await env.MEAL_PHOTOS.put(key,bytes,{httpMetadata:{contentType:'image/jpeg'},customMetadata:{expires:String(expires)}})
  try {
    const result = await (provider ?? geminiPhoto(env.GEMINI_API_KEY,env.GEMINI_MODEL,fetcher)).analyze(data)
    await photoRpc(env,'finish_photo_analysis',{p_user:user,p_id:id,p_tokens:result.tokens},fetcher)
    return { id, expiresAt:new Date(expires).toISOString(), ...result }
  } catch {
    throw new Error('Analyse indisponible ou proposition invalide. Photo conservée en privé ; vous pouvez la supprimer. Une tentative peut avoir consommé du quota.')
  }
}
export async function expirePhotos(env: PhotoEnv) {
  if (!env.MEAL_PHOTOS) return
  let cursor: string | undefined
  do {
    const page = await env.MEAL_PHOTOS.list({cursor,include:['customMetadata']})
    for (const object of page.objects) if (Number(object.customMetadata?.expires ?? 0) <= Date.now()) await env.MEAL_PHOTOS.delete(object.key)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
}
