import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import ProfileSettings, { type Profile } from './ProfileSettings'
import { FoodExplorer, RecipeLibrary } from './NutritionBrowser'
import WeightTracking from './WeightTracking'
import { requestPrivateJson } from './auth/client'
import { AuthGate, useAuth } from './auth/AuthProvider'
import { nextAccountMenuIndex } from './account-menu-navigation'
import Journal from './Journal'
import Coach from './Coach'
import MealHistory from './MealHistory'
import type { MealReuseDTO } from './meal-reuse'
import { formatDashboardEnergy } from './dashboard-summary.ts'
import { calculateJournalDay, selectActiveMealSnapshots, type ConfirmedMealSnapshot, type JournalDayDraft, type JournalState } from './domain/nutrition/journal.ts'

const sections = [
  { id: 'home', label: 'Vue d’ensemble', icon: '⌂' },
  { id: 'journal', label: 'Journal', icon: '▤' },
  { id: 'catalog', label: 'Aliments', icon: '◈' },
  { id: 'history', label: 'Historique', icon: '◷' },
  { id: 'recipes', label: 'Recettes', icon: '♧' },
  { id: 'tracking', label: 'Suivi', icon: '⌁' },
  { id: 'coach', label: 'Coach IA', icon: '✳' },
  { id: 'profile', label: 'Mon profil', icon: '◇' },
] as const
type Section = (typeof sections)[number]['id']
const todayLabel = () => new Intl.DateTimeFormat('fr-MA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())
const todayEyebrow = () => todayLabel().toLocaleUpperCase('fr-MA')

export default function App() {
  return <AuthGate>{(session) => <AuthenticatedApp email={session.user.email} userId={session.user.id} />}</AuthGate>
}

function AuthenticatedApp({ email, userId }: { readonly email: string | null; readonly userId: string }) {
  const { signOut } = useAuth()
  const [active, setActive] = useState<Section>('home')
  const [reuseRequest, setReuseRequest] = useState<{ readonly token: number; readonly source: MealReuseDTO } | null>(null)
  const reuseToken = useRef(0)
  const acknowledgeReuse = useCallback(() => setReuseRequest(null), [])
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement | null>(null)
  const sidebarAccountTriggerRef = useRef<HTMLButtonElement | null>(null)
  const headerAccountTriggerRef = useRef<HTMLButtonElement | null>(null)
  const lastAccountTriggerRef = useRef<HTMLButtonElement | null>(null)
  const accountMenuItemsRef = useRef<Array<HTMLButtonElement | null>>([])
  useEffect(() => {
    let mounted = true
    void requestPrivateJson<{ profile: Profile }>('/api/private/profile').then((response) => {
      if (mounted) setProfile(response.profile)
    }).catch(() => { /* Profile may not yet exist; authentication remains usable. */ })
    return () => { mounted = false }
  }, [])
  useEffect(() => {
    if (!accountMenuOpen) return
    const focusFrame = requestAnimationFrame(() => accountMenuItemsRef.current[0]?.focus())
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setAccountMenuOpen(false)
      lastAccountTriggerRef.current?.focus()
    }
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      const insideMenuOrTrigger = [accountMenuRef.current, sidebarAccountTriggerRef.current, headerAccountTriggerRef.current]
        .some((element) => element?.contains(event.target as Node))
      if (!insideMenuOrTrigger) setAccountMenuOpen(false)
    }
    const closeOnFocusOutside = (event: FocusEvent) => {
      if (event.target instanceof Node && !accountMenuRef.current?.contains(event.target)) setAccountMenuOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('focusin', closeOnFocusOutside)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('focusin', closeOnFocusOutside)
    }
  }, [accountMenuOpen])
  const toggleAccountMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    lastAccountTriggerRef.current = event.currentTarget
    setAccountMenuOpen((open) => !open)
  }, [])
  const navigateFromAccountMenu = useCallback((section: Section) => {
    setActive(section)
    setAccountMenuOpen(false)
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.profile-heading h1')?.focus())
  }, [])
  function handleAccountMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = accountMenuItemsRef.current.filter((item): item is HTMLButtonElement => item !== null)
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex = nextAccountMenuIndex(event.key, currentIndex, items.length)
    if (nextIndex !== null && items.length > 0) {
      event.preventDefault()
      items[nextIndex]?.focus()
    }
  }
  const [profile, setProfile] = useState<Profile | null>(null)
  const onProfileSaved = useCallback((next: Profile) => setProfile(next), [])
  const displayName = profile?.displayName?.trim() || email?.split('@')[0] || 'Utilisateur'
  const avatar = profile?.avatarDataUrl ? <img className="avatar-photo" src={profile.avatarDataUrl} alt=""/> : displayName.slice(0,1).toUpperCase()
  const current = sections.find((item) => item.id === active)
  return <div className="shell">
    <aside className="sidebar"><a className="brand" href="#home" onClick={() => setActive('home')}><span className="brand-mark">✦</span><span>Nutri<em>Perso</em></span></a><p className="nav-label">ESPACE PERSONNEL</p><nav>{sections.filter((item) => item.id !== 'profile').map((item) => <button key={item.id} className={active === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setActive(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}{active === item.id && <i />}</button>)}</nav><div className="sidebar-bottom"><div className="aside-note"><span>✧</span><p><b>À votre rythme.</b><br/>Un petit pas compte aussi.</p></div><button ref={sidebarAccountTriggerRef} className="profile profile-entry" type="button" onClick={toggleAccountMenu} aria-haspopup="menu" aria-expanded={accountMenuOpen} aria-controls="nutrip-account-menu" aria-label="Ouvrir le menu utilisateur"><span className="avatar">{avatar}</span><span><b>{displayName}</b><small>{email ?? 'Mon compte'}</small></span><span className="profile-chevron" aria-hidden="true">⌄</span></button></div></aside>
    <main><header className="topbar"><div className="mobile-brand"><span className="brand-mark">✦</span><span>Nutri<em>Perso</em></span></div><div className="crumb">Mon espace <span>/</span> <b>{current?.label}</b></div><div className="top-actions"><span className="today">{todayLabel()}</span><button className="coach-button" type="button" aria-label="Ouvrir Coach IA" onClick={() => setActive('coach')}><span aria-hidden="true">✳</span><b>Coach IA</b></button><button ref={headerAccountTriggerRef} type="button" className="avatar small profile-shortcut" onClick={toggleAccountMenu} title="Menu utilisateur" aria-label="Ouvrir le menu utilisateur" aria-haspopup="menu" aria-expanded={accountMenuOpen} aria-controls="nutrip-account-menu">{avatar}</button></div>{accountMenuOpen && <div ref={accountMenuRef} id="nutrip-account-menu" className="account-menu" role="menu" aria-label="Menu utilisateur" onKeyDown={handleAccountMenuKeyDown}><div className="account-menu-info" role="none"><b>{displayName}</b><small>{email}</small></div><button ref={(element) => { accountMenuItemsRef.current[0] = element }} role="menuitem" type="button" onClick={() => navigateFromAccountMenu('profile')}>Mon profil et préférences</button><button ref={(element) => { accountMenuItemsRef.current[1] = element }} role="menuitem" type="button" onClick={() => {setAccountMenuOpen(false);void signOut()}}>Se déconnecter</button></div>}</header>
    {active === 'home' ? <Dashboard navigate={setActive} userId={userId}/> : active === 'journal' ? <Journal userId={userId} reuseRequest={reuseRequest} onReuseConsumed={acknowledgeReuse}/> : active === 'history' ? <MealHistory onReuse={(source) => { reuseToken.current += 1; setReuseRequest({ token: reuseToken.current, source }); setActive('journal') }}/> : active === 'profile' ? <ProfileSettings email={email} onSaved={onProfileSaved} /> : active === 'catalog' ? <FoodExplorer /> : active === 'recipes' ? <RecipeLibrary onUse={snapshot => { reuseToken.current += 1; setReuseRequest({ token: reuseToken.current, source: { sourceKind: 'recipe', sourceId: snapshot.snapshotId, label: snapshot.recipe.name, mealKind: 'lunch', items: [{ kind: 'recipe', recipeId: snapshot.recipe.id, quantity: { kind: 'servings', amount: '1' }, sortOrder: 0 }] } }); setActive('journal') }}/> : active === 'tracking' ? <WeightTracking /> : <Coach key={userId} userId={userId}/>}
    <footer>NutriPerso <span>·</span> Votre espace, vos repères.</footer></main>
    <nav className="mobile-nav" aria-label="Navigation principale">{[sections[1], sections[2], sections[4], sections[0], sections[5], sections[3]].map((item) => <button key={item.id} className={`mobile-link${item.id === 'home' ? ' home-link' : ''}${active === item.id ? ' active' : ''}`} onClick={() => setActive(item.id)} aria-current={active === item.id ? 'page' : undefined}><span aria-hidden="true">{item.icon}</span><small>{item.id === 'home' ? 'Accueil' : item.label}</small></button>)}</nav>
  </div>
}

type DashboardJournal = { readonly day: JournalDayDraft | null; readonly snapshots: readonly ConfirmedMealSnapshot[] }

function Dashboard({ navigate, userId }: { navigate: (section: Section) => void; userId: string }) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const dateValues = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const localDate = `${dateValues.year}-${dateValues.month}-${dateValues.day}`
  const [journal, setJournal] = useState<DashboardJournal | null>(null)
  const [journalState, setJournalState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let mounted = true
    setJournalState('loading')
    void requestPrivateJson<{ journal: DashboardJournal | null }>(`/api/private/journal?date=${encodeURIComponent(localDate)}`)
      .then(({ journal: result }) => {
        if (!mounted) return
        setJournal(result)
        setJournalState('ready')
      })
      .catch(() => {
        if (mounted) setJournalState('error')
      })
    return () => { mounted = false }
  }, [userId, localDate])

  const snapshots = journal ? selectActiveMealSnapshots(journal.snapshots)
    .filter((snapshot) => snapshot.localDate === localDate && snapshot.timeZone === (journal.day?.timeZone ?? timeZone)) : []
  const state: JournalState | null = journal?.day
    ? { days: [journal.day], snapshots: journal.snapshots }
    : null
  const totals = state && journal?.day ? calculateJournalDay(state, journal.day.id) : {}
  const energy = totals.energy
  const energyLabel = formatDashboardEnergy(energy, snapshots.length > 0)
  const draftCount = journal?.day?.meals.length ?? 0
  const journalStatus = journalState === 'loading' ? 'Chargement du journal…'
    : journalState === 'error' ? 'Résumé du journal indisponible'
      : snapshots.length > 0 ? `${snapshots.length} repas confirmé(s) aujourd’hui`
        : draftCount > 0 ? `${draftCount} brouillon(s) à confirmer`
          : 'En attente de vos premiers repas'
  const journalMessage = journalState === 'loading' ? 'Chargement de votre journée.'
    : journalState === 'error' ? 'Le résumé du journal est momentanément indisponible.'
      : snapshots.length > 0 ? `${snapshots.length} repas confirmé(s) aujourd’hui.`
        : draftCount > 0 ? `${draftCount} brouillon(s) sont enregistrés.`
          : 'Aucun repas enregistré. Commencez votre journal.'

  return <div className="content"><div className="welcome"><div><div className="eyebrow"><i/>{todayEyebrow()}</div><h1>Votre journée, <em>en un regard.</em></h1><p>Repas, équilibre nutritionnel et évolution : vos repères au même endroit.</p></div><button className="date-button">▦ <span>Aujourd’hui</span>⌄</button></div>
  <section className="hero"><div className="hero-copy"><small>✳ &nbsp;VOTRE CARNET NUTRITIONNEL</small><h2>Mieux manger,<br/>à votre <em>rythme.</em></h2><p>Un journal clair, des repas à retrouver,<br className="desktop"/> et des données qui vous appartiennent.</p><button onClick={() => navigate('journal')}>Ouvrir mon journal <span>↗</span></button></div><div className="hero-art"><div className="sun"/><i className="leaf l1"/><i className="leaf l2"/><i className="leaf l3"/><div className="art-caption">PRENDRE SOIN DE SOI<br/><span>COMMENCE ICI</span></div></div><div className="hero-count">01 <i/> 06</div></section>
  <div className="section-head"><div><small>VOTRE ESPACE</small><h2>Vos repères du jour</h2></div><span className="draft"><i/>{journalStatus}</span></div>
  <section className="cards"><article className="card nutrition"><div className="card-title"><span className="tile green">◉</span><small>JOURNAL DU JOUR</small><b>↗</b></div><div className="empty"><div className="ring"><span>{energyLabel}<small>kcal</small></span></div><p>{journalMessage}</p></div><button className="action" onClick={() => navigate('journal')}>Ouvrir le journal <span>→</span></button></article>
  <article className="card progress"><div className="card-title"><span className="tile lilac">⌁</span><small>VOTRE SUIVI</small><b>↗</b></div><div className="chart"><div className="chart-head"><span>Évolution du poids</span><span>Sans données</span></div><div className="plot"><i/><i/><i/><svg viewBox="0 0 400 100" preserveAspectRatio="none" aria-label="Graphique en attente de données"><path d="M0 72 C 58 67 73 48 123 56 S 188 72 229 45 S 297 49 332 29 S 374 27 400 15" fill="none" stroke="#d4d2e7" strokeWidth="2" strokeDasharray="5 7"/></svg><span>Vos repères apparaîtront ici</span></div><div className="axis"><span>SEMAINE 1</span><span>SEMAINE 2</span><span>SEMAINE 3</span><span>SEMAINE 4</span></div></div><button className="action lilac-text" onClick={() => navigate('tracking')}>Voir mon suivi <span>→</span></button></article>
  <article className="quote"><b>“</b><p>Bien manger n’est pas un concours,<br/>c’est trouver un rythme durable<br/><em>qui vous ressemble.</em></p><small>UN ÉQUILIBRE QUI DURE</small><i>✳</i></article></section>
  <section className="quick"><div><small>POUR CONTINUER</small><h2>Vos espaces</h2></div><div className="quick-list"><Quick icon="◷" title="Historique" subtitle="Retrouvez vos journées" tone="peach" click={() => navigate('history')}/><Quick icon="♧" title="Recettes" subtitle="Vos idées à cuisiner" tone="sage" click={() => navigate('recipes')}/><Quick icon="✳" title="Coach IA" subtitle="Vos analyses, au bon moment" tone="lilac" click={() => navigate('coach')}/></div></section></div>
}
function Quick({ icon, title, subtitle, tone, click }: { icon: string; title: string; subtitle: string; tone: string; click: () => void }) { return <button className="quick-item" onClick={click}><span className={'quick-icon '+tone}>{icon}</span><span><b>{title}</b><small>{subtitle}</small></span><i>↗</i></button> }
