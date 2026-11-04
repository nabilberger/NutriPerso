import { useCallback, useState } from 'react'
import ProfileSettings, { type Profile } from './ProfileSettings'
import { FoodExplorer, RecipeLibrary } from './NutritionBrowser'
import { AuthGate, useAuth } from './auth/AuthProvider'

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
  return <AuthGate>{(session) => <AuthenticatedApp email={session.user.email} />}</AuthGate>
}

function AuthenticatedApp({ email }: { readonly email: string | null }) {
  const { signOut } = useAuth()
  const [active, setActive] = useState<Section>('home')
  const [profile, setProfile] = useState<Profile | null>(null)
  const onProfileSaved = useCallback((next: Profile) => setProfile(next), [])
  const displayName = profile?.displayName?.trim() || email?.split('@')[0] || 'Utilisateur'
  const avatar = profile?.avatarDataUrl ? <img className="avatar-photo" src={profile.avatarDataUrl} alt=""/> : displayName.slice(0,1).toUpperCase()
  const current = sections.find((item) => item.id === active)
  return <div className="shell">
    <aside className="sidebar"><a className="brand" href="#home" onClick={() => setActive('home')}><span className="brand-mark">✦</span><span>Nutri<em>Perso</em></span></a><p className="nav-label">ESPACE PERSONNEL</p><nav>{sections.map((item) => <button key={item.id} className={active === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setActive(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}{active === item.id && <i />}</button>)}</nav><div className="sidebar-bottom"><div className="aside-note"><span>✧</span><p><b>À votre rythme.</b><br/>Un petit pas compte aussi.</p></div><div className="profile"><span className="avatar">{avatar}</span><span><b>{displayName}</b><small>{email ?? 'Mon compte'}</small></span><button className="signout-icon" type="button" onClick={() => void signOut()} aria-label="Se déconnecter" title="Se déconnecter">↗</button></div></div></aside>
    <main><header className="topbar"><div className="mobile-brand"><span className="brand-mark">✦</span><span>Nutri<em>Perso</em></span></div><div className="crumb">Mon espace <span>/</span> <b>{current?.label}</b></div><div className="top-actions"><span className="today">{todayLabel()}</span><button className="coach-button" type="button" aria-label="Ouvrir Coach IA" onClick={() => setActive('coach')}><span aria-hidden="true">✳</span><b>Coach IA</b></button><button className="signout-button" type="button" onClick={() => void signOut()}>Déconnexion</button><button type="button" className="avatar small profile-shortcut" onClick={() => setActive('profile')} title="Mon profil" aria-label="Ouvrir mon profil">{avatar}</button></div></header>
    {active === 'home' ? <Dashboard navigate={setActive}/> : active === 'profile' ? <ProfileSettings email={email} onSaved={onProfileSaved} /> : active === 'catalog' ? <FoodExplorer /> : active === 'recipes' ? <RecipeLibrary /> : <section className="placeholder"><span className="placeholder-icon">✳</span><small>NUTRIPERSO</small><h1>{current?.label}</h1><p>Cet espace est en cours de connexion au moteur nutritionnel.<br/>Les données affichées seront issues de votre journal, sans valeurs inventées.</p><span className="status"><i/>Fonction en préparation</span></section>}
    <footer>NutriPerso <span>·</span> Votre espace, vos repères.</footer></main>
    <nav className="mobile-nav" aria-label="Navigation principale">{[sections[1], sections[4], sections[0], sections[5], sections[7]].map((item) => <button key={item.id} className={`mobile-link${item.id === 'home' ? ' home-link' : ''}${active === item.id ? ' active' : ''}`} onClick={() => setActive(item.id)} aria-current={active === item.id ? 'page' : undefined}><span>{item.icon}</span><small>{item.id === 'home' ? 'Accueil' : item.label}</small></button>)}</nav>
  </div>
}

function Dashboard({ navigate }: { navigate: (section: Section) => void }) {
  return <div className="content"><div className="welcome"><div><div className="eyebrow"><i/>{todayEyebrow()}</div><h1>Votre journée, <em>en un regard.</em></h1><p>Repas, équilibre nutritionnel et évolution : vos repères au même endroit.</p></div><button className="date-button">▦ <span>Aujourd’hui</span>⌄</button></div>
  <section className="hero"><div className="hero-copy"><small>✳ &nbsp;VOTRE CARNET NUTRITIONNEL</small><h2>Mieux manger,<br/>à votre <em>rythme.</em></h2><p>Un journal clair, des repas à retrouver,<br className="desktop"/> et des données qui vous appartiennent.</p><button onClick={() => navigate('journal')}>Ouvrir mon journal <span>↗</span></button></div><div className="hero-art"><div className="sun"/><i className="leaf l1"/><i className="leaf l2"/><i className="leaf l3"/><div className="art-caption">PRENDRE SOIN DE SOI<br/><span>COMMENCE ICI</span></div></div><div className="hero-count">01 <i/> 06</div></section>
  <div className="section-head"><div><small>VOTRE ESPACE</small><h2>Vos repères du jour</h2></div><span className="draft"><i/>En attente de vos premiers repas</span></div>
  <section className="cards"><article className="card nutrition"><div className="card-title"><span className="tile green">◉</span><small>JOURNAL DU JOUR</small><b>↗</b></div><div className="empty"><div className="ring"><span>—<small>kcal</small></span></div><p>Aucun repas enregistré.<br/>Commencez votre journal.</p></div><button className="action" onClick={() => navigate('journal')}>Ouvrir le journal <span>→</span></button></article>
  <article className="card progress"><div className="card-title"><span className="tile lilac">⌁</span><small>VOTRE SUIVI</small><b>↗</b></div><div className="chart"><div className="chart-head"><span>Évolution du poids</span><span>Sans données</span></div><div className="plot"><i/><i/><i/><svg viewBox="0 0 400 100" preserveAspectRatio="none" aria-label="Graphique en attente de données"><path d="M0 72 C 58 67 73 48 123 56 S 188 72 229 45 S 297 49 332 29 S 374 27 400 15" fill="none" stroke="#d4d2e7" strokeWidth="2" strokeDasharray="5 7"/></svg><span>Vos repères apparaîtront ici</span></div><div className="axis"><span>SEMAINE 1</span><span>SEMAINE 2</span><span>SEMAINE 3</span><span>SEMAINE 4</span></div></div><button className="action lilac-text" onClick={() => navigate('tracking')}>Voir mon suivi <span>→</span></button></article>
  <article className="quote"><b>“</b><p>Bien manger n’est pas un concours,<br/>c’est trouver un rythme durable<br/><em>qui vous ressemble.</em></p><small>UN ÉQUILIBRE QUI DURE</small><i>✳</i></article></section>
  <section className="quick"><div><small>POUR CONTINUER</small><h2>Vos espaces</h2></div><div className="quick-list"><Quick icon="◷" title="Historique" subtitle="Retrouvez vos journées" tone="peach" click={() => navigate('history')}/><Quick icon="♧" title="Recettes" subtitle="Vos idées à cuisiner" tone="sage" click={() => navigate('recipes')}/><Quick icon="✳" title="Coach IA" subtitle="Vos analyses, au bon moment" tone="lilac" click={() => navigate('coach')}/></div></section></div>
}
function Quick({ icon, title, subtitle, tone, click }: { icon: string; title: string; subtitle: string; tone: string; click: () => void }) { return <button className="quick-item" onClick={click}><span className={'quick-icon '+tone}>{icon}</span><span><b>{title}</b><small>{subtitle}</small></span><i>↗</i></button> }
