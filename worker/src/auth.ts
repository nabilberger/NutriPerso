export type SupabaseAuthEnv = {
  readonly SUPABASE_URL?: string
  readonly SUPABASE_PUBLISHABLE_KEY?: string
}
export type AuthenticatedUserScope = { readonly userId: string; readonly email: string | null }
export type AuthValidationResult =
  | { readonly ok: true; readonly scope: AuthenticatedUserScope }
  | { readonly ok: false; readonly status: 401 | 403 | 503; readonly code: 'AUTH_REQUIRED' | 'AUTH_INVALID' | 'AUTH_FORBIDDEN' | 'AUTH_UNAVAILABLE' | 'AUTH_CONFIGURATION' }

type JsonRecord = Record<string, unknown>

/** Supabase Auth /user validates signature, issuer and expiry; identity comes only from its verified response. */
export async function validateSupabaseAccessToken(
  authorization: string | undefined,
  env: SupabaseAuthEnv,
  fetcher: typeof fetch = fetch,
): Promise<AuthValidationResult> {
  const token = parseBearer(authorization)
  if (!token) return { ok: false, status: 401, code: 'AUTH_REQUIRED' }
  const base = env.SUPABASE_URL?.trim()
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!base || !publishableKey) return { ok: false, status: 503, code: 'AUTH_CONFIGURATION' }
  let endpoint: URL
  try {
    endpoint = new URL(base)
    if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost' && endpoint.hostname !== '127.0.0.1') {
      return { ok: false, status: 503, code: 'AUTH_CONFIGURATION' }
    }
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/auth/v1/user`
  } catch { return { ok: false, status: 503, code: 'AUTH_CONFIGURATION' } }

  let response: Response
  try {
    response = await fetcher(endpoint, {
      method: 'GET', headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
  } catch { return { ok: false, status: 503, code: 'AUTH_UNAVAILABLE' } }
  if (response.status === 401) return { ok: false, status: 401, code: 'AUTH_INVALID' }
  if (response.status === 403) return { ok: false, status: 403, code: 'AUTH_FORBIDDEN' }
  if (!response.ok) return { ok: false, status: 503, code: 'AUTH_UNAVAILABLE' }
  let user: unknown
  try { user = await response.json() } catch { return { ok: false, status: 503, code: 'AUTH_UNAVAILABLE' } }
  if (!isRecord(user) || typeof user.id !== 'string' || !isUuid(user.id)) {
    return { ok: false, status: 401, code: 'AUTH_INVALID' }
  }
  if (user.is_anonymous === true) return { ok: false, status: 403, code: 'AUTH_FORBIDDEN' }
  return { ok: true, scope: { userId: user.id, email: typeof user.email === 'string' ? user.email : null } }
}

function parseBearer(value: string | undefined): string | null {
  if (!value || value.length > 8200) return null
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(value)
  return match?.[1] ?? null
}

function isRecord(value: unknown): value is JsonRecord { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }
