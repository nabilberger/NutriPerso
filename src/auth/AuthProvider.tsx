import { createContext, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { authClient } from './client'
import type { AuthSession, AuthState, PasswordSetupFlow } from './supabase-auth'
import { uiFixtureMode } from '../ui-fixture-mode'

type AuthContextValue = AuthState & {
  readonly loading: boolean
  readonly error: string | null
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  setPassword(password: string): Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ session: null, passwordSetupFlow: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (import.meta.env.DEV && uiFixtureMode) {
      let active = true
      void import('../dev-ui-fixtures').then(({ fixtureUserId }) => {
        if (!active) return
        setAuth({ session: { access_token: 'ui-fixture-only', refresh_token: 'ui-fixture-only', expires_at: 4102444800,
          user: { id: fixtureUserId, email: 'recette@nutrip.local' } }, passwordSetupFlow: null })
      }).catch((reason: unknown) => {
        if (active) setError(errorMessage(reason))
      }).finally(() => {
        if (active) setLoading(false)
      })
      return () => { active = false }
    }
    const unsubscribe = authClient.subscribe(setAuth)
    void authClient.initialize().catch((reason: unknown) => setError(errorMessage(reason))).finally(() => setLoading(false))
    const resume = () => {
      if (document.visibilityState === 'visible') void authClient.getSession().then((session) => {
        if (!session) setAuth({ session: null, passwordSetupFlow: null })
      }).catch((reason: unknown) => setError(errorMessage(reason)))
    }
    document.addEventListener('visibilitychange', resume)
    return () => { unsubscribe(); document.removeEventListener('visibilitychange', resume) }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    ...auth, loading, error,
    async signIn(email, password) {
      setError(null)
      try { if (!(import.meta.env.DEV && uiFixtureMode)) await authClient.signInWithPassword(email, password) }
      catch (reason) { setError(errorMessage(reason)); throw reason }
    },
    async signOut() { setError(null); if (!(import.meta.env.DEV && uiFixtureMode)) await authClient.signOut() },
    async setPassword(password) {
      setError(null)
      try { if (!(import.meta.env.DEV && uiFixtureMode)) await authClient.setPassword(password) }
      catch (reason) { setError(errorMessage(reason)); throw reason }
    },
  }), [auth, loading, error])

  return <AuthContext.Provider value={value}>{import.meta.env.DEV && uiFixtureMode && <div role="status" aria-label="Mode recette UI" style={{ position: 'fixed', pointerEvents: 'none', inset: '0 0 auto', zIndex: 1000, padding: '8px 14px', textAlign: 'center', background: '#6d4c91', color: 'white', fontSize: 12, fontWeight: 700 }}>MODE RECETTE UI · DONNÉES SYNTHÉTIQUES · AUCUNE CONNEXION SUPABASE</div>}{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth doit être utilisé dans AuthProvider.')
  return context
}

export function AuthGate({ children }: { readonly children: (session: AuthSession) => ReactNode }) {
  const auth = useAuth()
  if (auth.loading) return <AuthMessage>Restauration de la session…</AuthMessage>
  if (auth.passwordSetupFlow && auth.session) return <PasswordSetupForm flow={auth.passwordSetupFlow} />
  if (!auth.session) return <SignInForm />
  return <>{children(auth.session)}</>
}

function SignInForm() {
  const { signIn, error } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true)
    try { await signIn(email, password) } catch { /* The provider displays a safe generic error. */ }
    finally { setPending(false) }
  }
  return <AuthShell>
    <span className="auth-mark">✦</span><small>ESPACE INVITÉ</small><h1>Bienvenue chez <em>NutriPerso.</em></h1>
    <p>Connectez-vous avec les identifiants reçus par invitation.</p>
    <form onSubmit={submit}>
      <label>Adresse e-mail<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Mot de passe<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <button type="submit" disabled={pending}>{pending ? 'Connexion…' : 'Se connecter'}</button>
    </form>
    <small className="auth-note">L’accès est réservé aux personnes invitées.</small>
  </AuthShell>
}

function PasswordSetupForm({ flow }: { readonly flow: PasswordSetupFlow }) {
  const { setPassword, error } = useAuth()
  const [password, setPasswordInput] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password !== confirmation) { setMessage('Les deux mots de passe ne correspondent pas.'); return }
    setPending(true); setMessage('')
    try { await setPassword(password) }
    catch { /* The provider displays a safe generic error. */ }
    finally { setPending(false) }
  }
  return <AuthShell>
    <span className="auth-mark">✦</span><small>{flow === 'invite' ? 'INVITATION ACCEPTÉE' : 'RÉINITIALISATION DU MOT DE PASSE'}</small><h1>Choisissez {flow === 'invite' ? 'votre' : 'un nouveau'} <em>mot de passe.</em></h1>
    <p>{flow === 'invite' ? 'Votre compte invité est prêt. Définissez un mot de passe pour vos prochaines connexions.' : 'Définissez un nouveau mot de passe pour accéder à votre compte.'}</p>
    <form onSubmit={submit}>
      <label>Nouveau mot de passe<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPasswordInput(event.target.value)} /></label>
      <label>Confirmer le mot de passe<input type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      {(error || message) && <div className="auth-error" role="alert">{error ?? message}</div>}
      <button type="submit" disabled={pending}>{pending ? 'Enregistrement…' : 'Enregistrer le mot de passe'}</button>
    </form>
  </AuthShell>
}

function AuthShell({ children }: { readonly children: ReactNode }) {
  return <main className="auth-screen"><section className="auth-card">{children}</section><footer>NutriPerso <span>·</span> Votre espace, vos repères.</footer></main>
}

function AuthMessage({ children }: { readonly children: ReactNode }) {
  return <main className="auth-screen"><section className="auth-card auth-loading"><span className="auth-mark">✦</span><p>{children}</p></section></main>
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return 'Une erreur est survenue. Réessayez.'
}
