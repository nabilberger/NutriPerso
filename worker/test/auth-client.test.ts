import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SupabaseAuthClient, SupabaseAuthError } from '../../src/auth/supabase-auth.ts'
import { readPrivateJsonResponse } from '../../src/auth/private-json-response.ts'

test('successful Worker DELETE with HTTP 204 does not try to parse an absent JSON body', async () => {
  assert.equal(await readPrivateJsonResponse<void>(new Response(null, { status: 204 })), undefined)
  assert.equal(await readPrivateJsonResponse<void>(new Response(null, { status: 205 })), undefined)
})

test('Worker JSON decoding preserves successful data and meaningful API errors', async () => {
  assert.deepEqual(await readPrivateJsonResponse(Response.json({ templates: [] })), { templates: [] })
  await assert.rejects(readPrivateJsonResponse(Response.json({ error: { message: 'Modèle non supprimé.' } }, { status: 409 })), /Modèle non supprimé\./)
  await assert.rejects(readPrivateJsonResponse(new Response('Unavailable', { status: 503 })), /HTTP 503/)
  await assert.rejects(readPrivateJsonResponse(new Response('', { status: 200 })), SyntaxError)
})

const userId = '2fa33744-d81b-4403-9482-e6a7af550001'
const config = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' }
const now = () => 1_800_000_000_000

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

function session(accessToken = 'access-1', refreshToken = 'refresh-1', expiresIn = 3600) {
  return { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, user: { id: userId, email: 'invited@example.test' } }
}

test('sign in persists an invited account session without a public signup method', async () => {
  const storage = new MemoryStorage()
  const calls: Array<{ url: string; init: RequestInit }> = []
  const auth = new SupabaseAuthClient(config, { storage, now, autoRefresh: false, fetcher: async (input, init = {}) => {
    const url = String(input); calls.push({ url, init })
    return Response.json(session())
  } })
  await auth.signInWithPassword('invited@example.test', 'passphrase')
  assert.equal(calls[0]?.url, `${config.url}/auth/v1/token?grant_type=password`)
  assert.equal(auth.state().passwordSetupFlow, null)
  assert.equal(new Headers(calls[0]?.init.headers).get('apikey'), config.publishableKey)
  assert.deepEqual(JSON.parse(storage.values.get('nutrip.auth.session.v1') ?? 'null'), {
    access_token: 'access-1', refresh_token: 'refresh-1', expires_at: 1_800_003_600, user: { id: userId, email: 'invited@example.test' },
  })
  assert.equal('signUp' in auth, false)
})

test('calls the configured fetch transport with the global receiver', async () => {
  let receiver: unknown
  const fetcher = function (this: unknown): Promise<Response> {
    receiver = this
    if (this !== globalThis) throw new TypeError('Illegal invocation')
    return Promise.resolve(Response.json({ code: 'invalid_credentials' }, { status: 400 }))
  }
  const auth = new SupabaseAuthClient(config, { storage: new MemoryStorage(), autoRefresh: false, fetcher })
  await assert.rejects(auth.signInWithPassword('invited@example.test', 'fake-password'), (error: unknown) => {
    assert.ok(error instanceof SupabaseAuthError)
    assert.equal(error.code, 'AUTHENTICATION_FAILED')
    return true
  })
  assert.equal(receiver, globalThis)
})

test('network diagnostics classify detached fetch without exposing credentials or tokens', async () => {
  const auth = new SupabaseAuthClient(config, { storage: new MemoryStorage(), autoRefresh: false, fetcher: async () => {
    throw new TypeError('Illegal invocation: fake-access-token fake-password')
  } })
  await assert.rejects(auth.signInWithPassword('invited@example.test', 'fake-password'), (error: unknown) => {
    assert.ok(error instanceof SupabaseAuthError)
    assert.equal(error.code, 'NETWORK')
    assert.match(error.message, /contexte global du transport était invalide/)
    assert.equal(error.message.includes('fake-access-token'), false)
    assert.equal(error.message.includes('fake-password'), false)
    assert.equal(error.message.includes('invited@example.test'), false)
    return true
  })
})

test('restores a persisted session and atomically stores the rotated refresh token', async () => {
  const storage = new MemoryStorage()
  storage.setItem('nutrip.auth.session.v1', JSON.stringify({
    access_token: 'expired-access', refresh_token: 'refresh-old', expires_at: 1_799_999_999,
    user: { id: userId, email: 'invited@example.test' },
  }))
  let refreshBody: Record<string, unknown> | null = null
  const auth = new SupabaseAuthClient(config, { storage, now, autoRefresh: false, fetcher: async (input, init = {}) => {
    assert.equal(String(input), `${config.url}/auth/v1/token?grant_type=refresh_token`)
    refreshBody = JSON.parse(String(init.body)) as Record<string, unknown>
    return Response.json(session('access-2', 'refresh-2'))
  } })
  const restored = await auth.initialize()
  assert.equal(refreshBody?.refresh_token, 'refresh-old')
  assert.equal(restored?.access_token, 'access-2')
  assert.equal(restored?.refresh_token, 'refresh-2')
  assert.equal((await auth.getSession())?.access_token, 'access-2')
})

test('retries one 401 after refreshing and sends no user id from the browser', async () => {
  const storage = new MemoryStorage()
  let privateCalls = 0
  const auth = new SupabaseAuthClient(config, { storage, now, autoRefresh: false, fetcher: async (input, init = {}) => {
    const url = String(input)
    if (url.includes('/token?grant_type=password')) return Response.json(session())
    if (url.includes('/token?grant_type=refresh_token')) return Response.json(session('access-2', 'refresh-2'))
    if (url === '/api/private/recipes') {
      privateCalls += 1
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer access-${privateCalls}`)
      assert.equal(new Headers(init.headers).get('cache-control'), 'no-store')
      return privateCalls === 1 ? Response.json({ error: { code: 'AUTH_INVALID' } }, { status: 401 }) : Response.json({ recipes: [] })
    }
    throw new Error(`Unexpected URL: ${url}`)
  } })
  await auth.signInWithPassword('invited@example.test', 'passphrase')
  const response = await auth.requestPrivate('/api/private/recipes', { method: 'GET' })
  assert.equal(response.status, 200)
  assert.equal(privateCalls, 2)
  assert.equal((await response.json() as { recipes: unknown[] }).recipes.length, 0)
})

test('an invalid refresh token clears the expired local session', async () => {
  const storage = new MemoryStorage()
  storage.setItem('nutrip.auth.session.v1', JSON.stringify({ access_token: 'old', refresh_token: 'revoked', expires_at: 1_799_999_999, user: { id: userId } }))
  const auth = new SupabaseAuthClient(config, { storage, now, autoRefresh: false, fetcher: async () => Response.json({ code: 'refresh_token_not_found' }, { status: 400 }) })
  assert.equal(await auth.initialize(), null)
  assert.equal(storage.getItem('nutrip.auth.session.v1'), null)
})

test('accepts an invitation callback and allows the invited user to set a password', async () => {
  const storage = new MemoryStorage()
  const calls: string[] = []
  const replacements: string[] = []
  const auth = new SupabaseAuthClient(config, { storage, now, autoRefresh: false, replaceUrl: (url) => {
    assert.notEqual(storage.getItem('nutrip.auth.session.v1'), null)
    replacements.push(url)
  }, fetcher: async (input, init = {}) => {
    const url = String(input); calls.push(url)
    if (url.endsWith('/verify')) return Response.json(session('invite-access', 'invite-refresh'))
    if (url.endsWith('/user') && init.method === 'PUT') return Response.json({ id: userId })
    throw new Error(`Unexpected URL: ${url}`)
  } })
  const callbackUrl = `${config.url}/?token_hash=invite-hash&type=invite`
  const [restored, restoredAgain] = await Promise.all([auth.initialize(callbackUrl), auth.initialize(callbackUrl)])
  assert.equal(restored?.access_token, 'invite-access')
  assert.deepEqual(restoredAgain, restored)
  assert.equal(auth.state().passwordSetupFlow, 'invite')
  assert.deepEqual(replacements, ['/'])
  assert.equal(storage.getItem('nutrip.auth.password-setup-flow.v1'), 'invite')
  await auth.setPassword('a-secure-passphrase')
  assert.deepEqual(calls, [`${config.url}/auth/v1/verify`, `${config.url}/auth/v1/user`])
  assert.equal(auth.state().passwordSetupFlow, null)
  assert.equal(storage.getItem('nutrip.auth.password-setup-flow.v1'), null)
})

test('accepts the standard invite callback fragment and persists its session before password setup', async () => {
  const storage = new MemoryStorage()
  const calls: Array<{ url: string; init: RequestInit }> = []
  const auth = new SupabaseAuthClient(config, { storage, now, autoRefresh: false, fetcher: async (input, init = {}) => {
    const url = String(input); calls.push({ url, init })
    if (url.endsWith('/user') && init.method === 'PUT') return Response.json({ id: userId })
    if (url.endsWith('/user')) return Response.json({ id: userId, email: 'invited@example.test' })
    throw new Error(`Unexpected URL: ${url}`)
  } })
  const callbackUrl = 'https://nutri.brainboost3d.com/#access_token=invite-access&refresh_token=invite-refresh&expires_in=3600&token_type=bearer&type=invite'
  const restored = await auth.initialize(callbackUrl)
  assert.equal(restored?.access_token, 'invite-access')
  assert.equal(auth.state().passwordSetupFlow, 'invite')
  assert.equal(storage.getItem('nutrip.auth.session.v1') !== null, true)
  assert.equal(new Headers(calls[0]?.init.headers).get('authorization'), 'Bearer invite-access')
  await auth.setPassword('a-secure-passphrase')
  assert.equal(auth.state().passwordSetupFlow, null)
  assert.deepEqual(calls.map(({ url }) => url), [`${config.url}/auth/v1/user`, `${config.url}/auth/v1/user`])
})

test('reports missing public Supabase configuration separately from network failures', async () => {
  const missing = new SupabaseAuthClient({ url: '', publishableKey: '' }, { storage: new MemoryStorage(), autoRefresh: false })
  await assert.rejects(missing.initialize('https://nutri.brainboost3d.com/'), (error: unknown) => {
    assert.ok(error instanceof SupabaseAuthError)
    assert.equal(error.code, 'CONFIGURATION')
    return true
  })
  const offline = new SupabaseAuthClient(config, { storage: new MemoryStorage(), autoRefresh: false, fetcher: async () => { throw new TypeError('network') } })
  await assert.rejects(offline.initialize('https://nutri.brainboost3d.com/?token_hash=invite&type=invite'), (error: unknown) => {
    assert.ok(error instanceof SupabaseAuthError)
    assert.equal(error.code, 'NETWORK')
    assert.match(error.message, /VITE_SUPABASE_URL/)
    return true
  })
})

test('accepts a recovery token hash from the query and restores password setup after reload', async () => {
  const storage = new MemoryStorage()
  const replacements: string[] = []
  let verifyBody: Record<string, unknown> | null = null
  const firstClient = new SupabaseAuthClient(config, { storage, now, autoRefresh: false, replaceUrl: (url) => replacements.push(url), fetcher: async (input, init = {}) => {
    assert.equal(String(input), `${config.url}/auth/v1/verify`)
    verifyBody = JSON.parse(String(init.body)) as Record<string, unknown>
    return Response.json(session('recovery-access', 'recovery-refresh'))
  } })
  const restored = await firstClient.initialize('https://nutri.brainboost3d.com/reset?next=%2Fhome&token_hash=recovery-hash&type=recovery')
  assert.equal(restored?.access_token, 'recovery-access')
  assert.deepEqual(verifyBody, { token_hash: 'recovery-hash', type: 'recovery' })
  assert.equal(firstClient.state().passwordSetupFlow, 'recovery')
  assert.equal(storage.getItem('nutrip.auth.password-setup-flow.v1'), 'recovery')
  assert.deepEqual(replacements, ['/reset?next=%2Fhome'])

  const secondClient = new SupabaseAuthClient(config, { storage, now, autoRefresh: false, fetcher: async (_input, init = {}) => {
    assert.equal(init.method, 'PUT')
    return Response.json({ id: userId })
  } })
  await secondClient.initialize()
  assert.equal(secondClient.state().session?.access_token, 'recovery-access')
  assert.equal(secondClient.state().passwordSetupFlow, 'recovery')
  await secondClient.setPassword('a-new-secure-passphrase')
  assert.equal(secondClient.state().passwordSetupFlow, null)
  assert.equal(storage.getItem('nutrip.auth.password-setup-flow.v1'), null)
})

test('accepts a recovery session from URL fragments and keeps the recovery form active', async () => {
  const auth = new SupabaseAuthClient(config, { storage: new MemoryStorage(), now, autoRefresh: false, fetcher: async (input) => {
    assert.equal(String(input), `${config.url}/auth/v1/user`)
    return Response.json({ id: userId, email: 'invited@example.test' })
  } })
  const callbackUrl = 'https://nutri.brainboost3d.com/#access_token=recovery-access&refresh_token=recovery-refresh&expires_in=3600&type=recovery'
  const restored = await auth.initialize(callbackUrl)
  assert.equal(restored?.access_token, 'recovery-access')
  assert.equal(auth.state().passwordSetupFlow, 'recovery')
})

test('accepts recovery session tokens in the query string and removes them only after validation', async () => {
  const storage = new MemoryStorage()
  const replacements: string[] = []
  const auth = new SupabaseAuthClient(config, { storage, now, autoRefresh: false, replaceUrl: (url) => replacements.push(url), fetcher: async (input, init = {}) => {
    assert.equal(String(input), `${config.url}/auth/v1/user`)
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer recovery-query-access')
    return Response.json({ id: userId, email: 'invited@example.test' })
  } })
  const callbackUrl = 'https://nutri.brainboost3d.com/?access_token=recovery-query-access&refresh_token=recovery-query-refresh&expires_in=3600&type=recovery&return=%2F'
  const restored = await auth.initialize(callbackUrl)
  assert.equal(restored?.access_token, 'recovery-query-access')
  assert.equal(auth.state().passwordSetupFlow, 'recovery')
  assert.deepEqual(replacements, ['/?return=%2F'])
})

test('an otp_expired recovery response does not create a session or clean the callback URL', async () => {
  const storage = new MemoryStorage()
  const replacements: string[] = []
  const auth = new SupabaseAuthClient(config, { storage, now, autoRefresh: false, replaceUrl: (url) => replacements.push(url), fetcher: async () => Response.json({ code: 'otp_expired' }, { status: 403 }) })
  await assert.rejects(auth.initialize('https://nutri.brainboost3d.com/?token_hash=expired&type=recovery'), (error: unknown) => {
    assert.ok(error instanceof SupabaseAuthError)
    assert.equal(error.code, 'AUTHENTICATION_FAILED')
    assert.match(error.message, /Ce lien a expiré/)
    return true
  })
  assert.equal(storage.getItem('nutrip.auth.session.v1'), null)
  assert.equal(storage.getItem('nutrip.auth.password-setup-flow.v1'), null)
  assert.deepEqual(replacements, [])
})

test('an otp_expired URL callback is reported without cleaning the query or fragment', async () => {
  const storage = new MemoryStorage()
  const replacements: string[] = []
  const auth = new SupabaseAuthClient(config, { storage, now, autoRefresh: false, replaceUrl: (url) => replacements.push(url) })
  await assert.rejects(auth.initialize('https://nutri.brainboost3d.com/?type=recovery#error=access_denied&error_code=otp_expired'), /Ce lien a expiré/)
  assert.deepEqual(replacements, [])
  assert.equal(storage.getItem('nutrip.auth.session.v1'), null)
})

test('invalid credentials return a generic message without account enumeration', async () => {
  const auth = new SupabaseAuthClient(config, { storage: new MemoryStorage(), autoRefresh: false, fetcher: async () => Response.json({ message: 'specific provider detail' }, { status: 400 }) })
  await assert.rejects(auth.signInWithPassword('unknown@example.test', 'bad'), (error: unknown) => {
    assert.ok(error instanceof SupabaseAuthError)
    assert.equal(error.code, 'AUTHENTICATION_FAILED')
    assert.equal(error.message.includes('specific provider detail'), false)
    return true
  })
})

test('logout revokes only the current session and clears local credentials', async () => {
  const storage = new MemoryStorage()
  const urls: string[] = []
  const auth = new SupabaseAuthClient(config, { storage, now, autoRefresh: false, fetcher: async (input) => {
    urls.push(String(input))
    return Response.json(session())
  } })
  await auth.signInWithPassword('invited@example.test', 'passphrase')
  await auth.signOut()
  assert.equal(urls.at(-1), `${config.url}/auth/v1/logout?scope=local`)
  assert.equal(storage.getItem('nutrip.auth.session.v1'), null)
  assert.equal(auth.state().session, null)
})
