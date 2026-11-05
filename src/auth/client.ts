import { SupabaseAuthClient } from './supabase-auth'
import { uiFixtureMode } from '../ui-fixture-mode'
import { fixtureRequest } from '../dev-ui-fixtures'

const env = import.meta.env

export const authClient = new SupabaseAuthClient({
  url: env.VITE_SUPABASE_URL ?? '',
  publishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
})

export async function requestPrivateJson<T>(path: string, init?: RequestInit): Promise<T> {
  if (uiFixtureMode) return fixtureRequest<T>(path, init)
  const response = await authClient.requestPrivate(path, init)
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const message = isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string'
      ? body.error.message : `La requête a échoué (HTTP ${response.status}).`
    throw new Error(message)
  }
  return await response.json() as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
