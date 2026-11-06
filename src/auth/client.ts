import { SupabaseAuthClient } from './supabase-auth'
import { uiFixtureMode } from '../ui-fixture-mode'
import { fixtureRequest } from '../dev-ui-fixtures'
import { readPrivateJsonResponse } from './private-json-response'

const env = import.meta.env

export const authClient = new SupabaseAuthClient({
  url: env.VITE_SUPABASE_URL ?? '',
  publishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
})

export async function requestPrivateJson<T>(path: string, init?: RequestInit): Promise<T> {
  if (uiFixtureMode) return fixtureRequest<T>(path, init)
  const response = await authClient.requestPrivate(path, init)
  return readPrivateJsonResponse<T>(response)
}
