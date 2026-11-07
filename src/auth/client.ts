import { SupabaseAuthClient } from './supabase-auth'
import { uiFixtureMode } from '../ui-fixture-mode'
import { readPrivateJsonResponse } from './private-json-response'

const env = import.meta.env

export const authClient = new SupabaseAuthClient({
  url: env.VITE_SUPABASE_URL ?? '',
  publishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
})

export async function requestPrivateJson<T>(path: string, init?: RequestInit): Promise<T> {
  if (import.meta.env.DEV && uiFixtureMode) {
    const { fixtureRequest } = await import('../dev-ui-fixtures')
    return fixtureRequest<T>(path, init)
  }
  const response = await authClient.requestPrivate(path, init)
  return readPrivateJsonResponse<T>(response)
}
