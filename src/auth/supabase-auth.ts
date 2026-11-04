export type AuthUser = { readonly id: string; readonly email: string | null }
export type AuthSession = {
  readonly access_token: string
  readonly refresh_token: string
  readonly expires_at: number
  readonly user: AuthUser
}
export type PasswordSetupFlow = 'invite' | 'recovery'
export type AuthState = { readonly session: AuthSession | null; readonly passwordSetupFlow: PasswordSetupFlow | null }
export type AuthErrorCode = 'CONFIGURATION' | 'AUTHENTICATION_FAILED' | 'SESSION_EXPIRED' | 'NETWORK' | 'INVALID_RESPONSE'

export class SupabaseAuthError extends Error {
  readonly code: AuthErrorCode

  constructor(code: AuthErrorCode, message: string) {
    super(message)
    this.name = 'SupabaseAuthError'
    this.code = code
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type Runtime = { readonly storage?: StorageLike; readonly fetcher?: typeof fetch; readonly now?: () => number; readonly autoRefresh?: boolean; readonly replaceUrl?: (url: string) => void }
type SupabaseConfig = { readonly url: string; readonly publishableKey: string }
type JsonRecord = Record<string, unknown>

const SESSION_KEY = 'nutrip.auth.session.v1'
const PASSWORD_SETUP_FLOW_KEY = 'nutrip.auth.password-setup-flow.v1'
const REFRESH_MARGIN_SECONDS = 60

/** Minimal browser Auth client using Supabase Auth's documented HTTP endpoints. */
export class SupabaseAuthClient {
  private session: AuthSession | null = null
  private passwordSetupFlow: PasswordSetupFlow | null = null
  private initialized = false
  private initializeInFlight: Promise<AuthSession | null> | null = null
  private refreshInFlight: Promise<AuthSession> | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private readonly listeners = new Set<(state: AuthState) => void>()
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private readonly config: SupabaseConfig
  private readonly runtime: Runtime

  constructor(config: SupabaseConfig, runtime: Runtime = {}) {
    this.config = config
    this.runtime = runtime
    this.fetcher = (runtime.fetcher ?? globalThis.fetch).bind(globalThis)
    this.now = runtime.now ?? Date.now
  }

  subscribe(listener: (state: AuthState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state())
    return () => this.listeners.delete(listener)
  }

  state(): AuthState { return { session: this.session, passwordSetupFlow: this.passwordSetupFlow } }

  initialize(callbackUrl?: string): Promise<AuthSession | null> {
    if (this.initialized && !callbackUrl) return this.getSession()
    if (this.initializeInFlight) return this.initializeInFlight
    const pending = this.restoreSession(callbackUrl)
    this.initializeInFlight = pending
    void pending.then(() => {
      if (this.initializeInFlight === pending) this.initializeInFlight = null
    }, () => {
      if (this.initializeInFlight === pending) this.initializeInFlight = null
    })
    return pending
  }

  private async restoreSession(callbackUrl?: string): Promise<AuthSession | null> {
    this.assertConfigured()
    const callback = callbackUrl ?? (typeof window !== 'undefined' ? window.location.href : undefined)
    if (callback) {
      const callbackSession = await this.consumeAuthCallback(callback)
      if (callbackSession) {
        this.initialized = true
        this.passwordSetupFlow = callbackSession.flow
        this.setSession(callbackSession.session)
        this.replaceCallbackUrl(callback)
        this.emit()
        return callbackSession.session
      }
    }
    this.initialized = true
    this.passwordSetupFlow = this.readPasswordSetupFlow()
    const stored = this.readStoredSession()
    if (!stored) {
      this.clearSession()
      return null
    }
    this.session = stored
    if (stored.expires_at <= Math.floor(this.now() / 1000) + REFRESH_MARGIN_SECONDS) {
      try { await this.refreshSession() }
      catch (error) {
        if (error instanceof SupabaseAuthError && error.code === 'SESSION_EXPIRED') this.clearSession()
        else throw error
      }
    } else {
      this.scheduleRefresh()
      this.emit()
    }
    return this.session
  }

  async signInWithPassword(email: string, password: string): Promise<AuthSession> {
    this.assertConfigured()
    const cleanEmail = email.trim()
    if (!cleanEmail || !password) throw new SupabaseAuthError('AUTHENTICATION_FAILED', 'Adresse e-mail ou mot de passe invalide.')
    const payload = await this.authJson('/token?grant_type=password', {
      method: 'POST', body: JSON.stringify({ email: cleanEmail, password }),
    }, 'AUTHENTICATION_FAILED')
    const session = this.parseSession(payload)
    this.passwordSetupFlow = null
    this.initialized = true
    this.setSession(session)
    return session
  }

  async signOut(): Promise<void> {
    const current = this.session
    try {
      if (current) await this.fetcher(this.authUrl('/logout?scope=local'), {
        method: 'POST', headers: this.headers(current.access_token),
      })
    } catch { /* Always clear local credentials, even when remote revocation is temporarily unavailable. */ }
    finally { this.clearSession() }
  }

  async setPassword(password: string): Promise<void> {
    if (!this.session || !this.passwordSetupFlow) throw new SupabaseAuthError('SESSION_EXPIRED', 'Le lien d’activation ou de récupération n’est plus actif.')
    if (password.length < 8) throw new SupabaseAuthError('AUTHENTICATION_FAILED', 'Le mot de passe doit contenir au moins 8 caractères.')
    await this.authJson('/user', {
      method: 'PUT', headers: { Authorization: `Bearer ${this.session.access_token}` },
      body: JSON.stringify({ password }),
    }, 'SESSION_EXPIRED')
    this.passwordSetupFlow = null
    try { this.storage()?.removeItem(PASSWORD_SETUP_FLOW_KEY) } catch { /* The password is already updated; the in-memory state is authoritative. */ }
    this.emit()
  }

  async getSession(): Promise<AuthSession | null> {
    const current = this.session ?? this.readStoredSession()
    if (!current) return null
    this.session = current
    if (current.expires_at <= Math.floor(this.now() / 1000) + REFRESH_MARGIN_SECONDS) {
      try { return await this.refreshSession() }
      catch (error) {
        if (error instanceof SupabaseAuthError && error.code === 'SESSION_EXPIRED') this.clearSession()
        throw error
      }
    }
    return current
  }

  async requestPrivate(path: string, init: RequestInit = {}): Promise<Response> {
    if (!path.startsWith('/api/private/')) throw new SupabaseAuthError('CONFIGURATION', 'Les requêtes authentifiées doivent viser une route privée.')
    const current = await this.getSession()
    if (!current) throw new SupabaseAuthError('SESSION_EXPIRED', 'Connectez-vous pour continuer.')
    const first = await this.privateFetch(path, current.access_token, init)
    if (first.status !== 401) return first
    try {
      const renewed = await this.refreshSession()
      const retry = await this.privateFetch(path, renewed.access_token, init)
      if (retry.status === 401) this.clearSession()
      return retry
    } catch (error) {
      if (error instanceof SupabaseAuthError && error.code === 'SESSION_EXPIRED') this.clearSession()
      throw error
    }
  }

  private async privateFetch(path: string, accessToken: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${accessToken}`)
    headers.set('Accept', 'application/json')
    headers.set('Cache-Control', 'no-store')
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    return this.fetcher(path, { ...init, headers, cache: 'no-store' })
  }

  private async refreshSession(): Promise<AuthSession> {
    if (this.refreshInFlight) return this.refreshInFlight
    const current = this.session ?? this.readStoredSession()
    if (!current) throw new SupabaseAuthError('SESSION_EXPIRED', 'La session a expiré. Connectez-vous à nouveau.')
    this.refreshInFlight = (async () => {
      const payload = await this.authJson('/token?grant_type=refresh_token', {
        method: 'POST', body: JSON.stringify({ refresh_token: current.refresh_token }),
      }, 'SESSION_EXPIRED')
      const next = this.parseSession(payload)
      this.setSession(next)
      return next
    })()
    try { return await this.refreshInFlight }
    finally { this.refreshInFlight = null }
  }

  private async consumeAuthCallback(callbackUrl: string): Promise<{ readonly session: AuthSession; readonly flow: PasswordSetupFlow } | null> {
    let url: URL
    try { url = new URL(callbackUrl) } catch { return null }
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
    const flow = parsePasswordSetupFlow(url.searchParams.get('type') ?? hash.get('type'))
    const callbackError = url.searchParams.get('error_code') ?? hash.get('error_code') ?? url.searchParams.get('error') ?? hash.get('error')
    if (callbackError) {
      const expired = callbackError === 'otp_expired'
      throw new SupabaseAuthError('AUTHENTICATION_FAILED', expired
        ? 'Ce lien a expiré. Demandez une nouvelle invitation ou un nouveau lien de réinitialisation.'
        : 'Ce lien de compte est invalide. Demandez un nouveau lien de réinitialisation ou une nouvelle invitation.')
    }
    if (!flow) return null
    const tokenHash = url.searchParams.get('token_hash') ?? hash.get('token_hash')
    if (tokenHash) {
      const payload = await this.authJson('/verify', {
        method: 'POST', body: JSON.stringify({ token_hash: tokenHash, type: flow }),
      }, 'AUTHENTICATION_FAILED')
      return { session: this.parseSession(payload), flow }
    }
    const accessToken = hash.get('access_token') ?? url.searchParams.get('access_token')
    const refreshToken = hash.get('refresh_token') ?? url.searchParams.get('refresh_token')
    const expiresAtValue = hash.get('expires_at') ?? url.searchParams.get('expires_at')
    const expiresIn = parsePositiveInteger(hash.get('expires_in') ?? url.searchParams.get('expires_in'))
    const explicitExpiresAt = parsePositiveInteger(expiresAtValue)
    const expiresAt = explicitExpiresAt ?? (expiresIn === null ? null : Math.floor(this.now() / 1000) + expiresIn)
    if (!accessToken || !refreshToken || expiresAt === null || expiresAt <= Math.floor(this.now() / 1000)) return null
    const userPayload = await this.authJson('/user', {
      method: 'GET', headers: { Authorization: `Bearer ${accessToken}` },
    }, 'AUTHENTICATION_FAILED')
    const user = parseUser(userPayload)
    return { session: { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt, user }, flow }
  }

  private replaceCallbackUrl(callbackUrl: string): void {
    const url = new URL(callbackUrl)
    url.searchParams.delete('token_hash')
    url.searchParams.delete('token')
    url.searchParams.delete('code')
    url.searchParams.delete('access_token')
    url.searchParams.delete('refresh_token')
    url.searchParams.delete('expires_in')
    url.searchParams.delete('expires_at')
    url.searchParams.delete('token_type')
    url.searchParams.delete('error')
    url.searchParams.delete('error_code')
    url.searchParams.delete('error_description')
    if (url.searchParams.get('type') === 'invite') url.searchParams.delete('type')
    if (url.searchParams.get('type') === 'recovery') url.searchParams.delete('type')
    const cleanUrl = `${url.pathname}${url.search}`
    if (this.runtime.replaceUrl) {
      this.runtime.replaceUrl(cleanUrl)
      return
    }
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    url.hash = ''
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}`)
  }

  private async authJson(path: string, init: RequestInit, failureCode: AuthErrorCode): Promise<unknown> {
    this.assertConfigured()
    let response: Response
    try {
      response = await this.fetcher(this.authUrl(path), {
        ...init,
        headers: { apikey: this.config.publishableKey, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      })
    } catch (reason) {
      throw new SupabaseAuthError('NETWORK', authFetchErrorMessage(reason))
    }
    if (!response.ok) {
      if ((response.status === 400 || response.status === 401) && failureCode === 'SESSION_EXPIRED') {
        throw new SupabaseAuthError('SESSION_EXPIRED', 'La session a expiré. Connectez-vous à nouveau.')
      }
      if (failureCode === 'AUTHENTICATION_FAILED') {
        const payload = await response.json().catch(() => null) as unknown
        if (isRecord(payload) && (payload.code === 'otp_expired' || payload.error_code === 'otp_expired')) {
          throw new SupabaseAuthError('AUTHENTICATION_FAILED', 'Ce lien a expiré. Demandez une nouvelle invitation ou un nouveau lien de réinitialisation.')
        }
        throw new SupabaseAuthError('AUTHENTICATION_FAILED', 'Identifiants invalides ou lien de compte expiré.')
      }
      throw new SupabaseAuthError('NETWORK', 'Le service d’authentification a refusé la requête.')
    }
    try { return await response.json() as unknown }
    catch { throw new SupabaseAuthError('INVALID_RESPONSE', 'Réponse invalide du service d’authentification.') }
  }

  private parseSession(value: unknown): AuthSession {
    if (!isRecord(value) || typeof value.access_token !== 'string' || !value.access_token
      || typeof value.refresh_token !== 'string' || !value.refresh_token) {
      throw new SupabaseAuthError('INVALID_RESPONSE', 'La session reçue est invalide.')
    }
    const user = parseUser(value.user)
    const expiresAt = typeof value.expires_at === 'number' ? value.expires_at
      : typeof value.expires_in === 'number' && Number.isFinite(value.expires_in)
        ? Math.floor(this.now() / 1000) + value.expires_in : null
    if (expiresAt === null || !Number.isSafeInteger(expiresAt)) throw new SupabaseAuthError('INVALID_RESPONSE', 'L’expiration de la session est invalide.')
    return { access_token: value.access_token, refresh_token: value.refresh_token, expires_at: expiresAt, user }
  }

  private readStoredSession(): AuthSession | null {
    try {
      const raw = this.storage()?.getItem(SESSION_KEY)
      if (!raw) return null
      const parsed: unknown = JSON.parse(raw)
      if (!isRecord(parsed)) return null
      return this.parseStoredSession(parsed)
    } catch { return null }
  }

  private readPasswordSetupFlow(): PasswordSetupFlow | null {
    try {
      const value = this.storage()?.getItem(PASSWORD_SETUP_FLOW_KEY)
      return value === 'invite' || value === 'recovery' ? value : null
    } catch { return null }
  }

  private parseStoredSession(value: JsonRecord): AuthSession {
    if (typeof value.access_token !== 'string' || typeof value.refresh_token !== 'string'
      || typeof value.expires_at !== 'number' || !Number.isSafeInteger(value.expires_at)) throw new Error('invalid')
    return { access_token: value.access_token, refresh_token: value.refresh_token, expires_at: value.expires_at, user: parseUser(value.user) }
  }

  private setSession(session: AuthSession): void {
    this.session = session
    try { this.storage()?.setItem(SESSION_KEY, JSON.stringify(session)) } catch { /* Keep the session in memory if browser storage is unavailable. */ }
    try {
      if (this.passwordSetupFlow) this.storage()?.setItem(PASSWORD_SETUP_FLOW_KEY, this.passwordSetupFlow)
      else this.storage()?.removeItem(PASSWORD_SETUP_FLOW_KEY)
    } catch { /* Keep the flow in memory if browser storage is unavailable. */ }
    this.scheduleRefresh()
    this.emit()
  }

  private clearSession(): void {
    this.session = null
    this.passwordSetupFlow = null
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer)
    this.refreshTimer = null
    try { this.storage()?.removeItem(SESSION_KEY) } catch { /* The in-memory session is still cleared. */ }
    try { this.storage()?.removeItem(PASSWORD_SETUP_FLOW_KEY) } catch { /* The in-memory flow is still cleared. */ }
    this.emit()
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer)
    if (this.runtime.autoRefresh === false) { this.refreshTimer = null; return }
    if (!this.session) return
    const delay = Math.max(1000, (this.session.expires_at - Math.floor(this.now() / 1000) - REFRESH_MARGIN_SECONDS) * 1000)
    this.refreshTimer = setTimeout(() => {
      void this.refreshSession().catch((error: unknown) => {
        if (error instanceof SupabaseAuthError && error.code === 'SESSION_EXPIRED') this.clearSession()
        else if (this.session) this.scheduleRefreshRetry()
      })
    }, delay)
  }

  private scheduleRefreshRetry(): void {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      void this.refreshSession().catch((error: unknown) => {
        if (error instanceof SupabaseAuthError && error.code === 'SESSION_EXPIRED') this.clearSession()
        else if (this.session) this.scheduleRefreshRetry()
      })
    }, 30_000)
  }

  private storage(): StorageLike | undefined {
    if (this.runtime.storage) return this.runtime.storage
    try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
  }

  private headers(accessToken?: string): HeadersInit {
    return { apikey: this.config.publishableKey, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }
  }

  private authUrl(path: string): string { return `${this.config.url.replace(/\/$/, '')}/auth/v1${path}` }
  private assertConfigured(): void {
    const base = this.config.url.trim()
    if (!base || !this.config.publishableKey.trim()) {
      throw new SupabaseAuthError('CONFIGURATION', 'La configuration publique Supabase est absente. Vérifiez VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY dans les variables de build Cloudflare Pages.')
    }
    try {
      const url = new URL(base)
      if ((url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) || (url.pathname !== '/' && url.pathname !== '')) {
        throw new Error('invalid')
      }
    } catch {
      throw new SupabaseAuthError('CONFIGURATION', 'VITE_SUPABASE_URL doit être l’URL HTTPS racine du projet Supabase (ou localhost en développement).')
    }
  }
  private emit(): void { const state = this.state(); for (const listener of this.listeners) listener(state) }
}

function parseUser(value: unknown): AuthUser {
  const candidate = isRecord(value) && isRecord(value.user) ? value.user : value
  if (!isRecord(candidate) || typeof candidate.id !== 'string' || !isUuid(candidate.id)) {
    throw new SupabaseAuthError('INVALID_RESPONSE', 'L’utilisateur retourné par Supabase est invalide.')
  }
  return { id: candidate.id, email: typeof candidate.email === 'string' ? candidate.email : null }
}

function isRecord(value: unknown): value is JsonRecord { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }
function parsePasswordSetupFlow(value: string | null): PasswordSetupFlow | null { return value === 'invite' || value === 'recovery' ? value : null }
function parsePositiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}
function authFetchErrorMessage(reason: unknown): string {
  if (reason instanceof Error && /illegal invocation/i.test(reason.message)) {
    return 'Le navigateur a rejeté l’appel fetch à Supabase Auth : le contexte global du transport était invalide.'
  }
  const errorType = reason instanceof Error ? reason.name : 'Erreur inconnue'
  return `La requête réseau vers Supabase Auth a échoué (${errorType}). Vérifiez VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, l’URL du projet, le réseau et les règles CSP/CORS du domaine.`
}
