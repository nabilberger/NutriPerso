import { useState } from 'react'

const sections = [
  { id: 'home', label: 'Vue d’ensemble', icon: '⌂' },
  { id: 'journal', label: 'Journal', icon: '▤' },
  { id: 'history', label: 'Historique', icon: '◷' },
  { id: 'recipes', label: 'Recettes', icon: '♧' },
  { id: 'tracking', label: 'Suivi', icon: '⌁' },
  { id: 'coach', label: 'Coach IA', icon: '✳' },
] as const
type Section = (typeof sections)[number]['id']

export default function App() {
  const [active, setActive] = useState<Section>('home')
  const current = sections.find((item) => item.id === active)
  return <div className="shell">
    <aside className="sidebar"><a className="brand" href="#home" onClick={() => setActive('home')}><span className="brand-mark">✦</span><span>Nutri<em>Perso</em></span></a><p className="nav-label">ESPACE PERSONNEL</p><nav>{sections.map((item) => <button key={item.id} className={active === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setActive(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}{active === item.id && <i />}</button>)}</nav><div className="sidebar-bottom"><div className="aside-note"><span>✧</span><p><b>À votre rythme.</b><br/>Un petit pas compte aussi.</p></div><div className="profile"><span className="avatar">N</span><span><b>Mon espace</b><small>Suivi personnel</small></span><i>···</i></div></div></aside>
    <main><header className="topbar"><div className="mobile-brand"><span className="brand-mark">✦</span><span>Nutri<em>Perso</em></span></div><div className="crumb">Mon espace <span>/</span> <b>{current?.label}</b></div><div className="top-actions"><span className="today">Mardi 3 novembre 2026</span><button className="coach-button" type="button" aria-label="Ouvrir Coach IA" onClick={() => setActive('coach')}><span aria-hidden="true">✳</span><b>Coach IA</b></button><button className="bell" aria-label="Notifications">♧<i/></button><span className="avatar small">N</span></div></header>
    {active === 'home' ? <Dashboard navigate={setActive}/> : <section className="placeholder"><span className="placeholder-icon">✳</span><small>NUTRIPERSO</small><h1>{current?.label}</h1><p>Cet espace est prêt à accueillir votre suivi.<br/>Les fonctionnalités arriveront au fil du développement.</p><span className="status"><i/>Espace en préparation</span></section>}
    <footer>NutriPerso <span>·</span> Votre espace, vos repères.</footer></main>
    <nav className="mobile-nav" aria-label="Navigation principale">{[sections[1], sections[2], sections[0], sections[3], sections[4]].map((item) => <button key={item.id} className={`mobile-link${item.id === 'home' ? ' home-link' : ''}${active === item.id ? ' active' : ''}`} onClick={() => setActive(item.id)} aria-current={active === item.id ? 'page' : undefined}><span>{item.icon}</span><small>{item.id === 'home' ? 'Accueil' : item.label}</small></button>)}</nav>
  </div>
}

function Dashboard({ navigate }: { navigate: (section: Section) => void }) {
  return <div className="content"><div className="welcome"><div><div className="eyebrow"><i/>MARDI 3 NOVEMBRE 2026</div><h1>Bonjour, <em>et bienvenue.</em></h1><p>Prenez un instant pour vous. Votre journée commence ici.</p></div><button className="date-button">▦ <span>Aujourd’hui</span>⌄</button></div>
  <section className="hero"><div className="hero-copy"><small>✳ &nbsp;VOTRE ESPACE BIEN-ÊTRE</small><h2>Chaque journée est<br/>une nouvelle <em>occasion.</em></h2><p>Apprenez à mieux connaître vos habitudes,<br className="desktop"/> un pas après l’autre.</p><button onClick={() => navigate('journal')}>Découvrir mon journal <span>↗</span></button></div><div className="hero-art"><div className="sun"/><i className="leaf l1"/><i className="leaf l2"/><i className="leaf l3"/><div className="art-caption">PRENDRE SOIN DE SOI<br/><span>COMMENCE ICI</span></div></div><div className="hero-count">01 <i/> 06</div></section>
  <div className="section-head"><div><small>VOTRE ESPACE</small><h2>Un aperçu tout en douceur</h2></div><span className="draft"><i/>Interface de départ</span></div>
  <section className="cards"><article className="card nutrition"><div className="card-title"><span className="tile green">◉</span><small>JOURNAL DU JOUR</small><b>↗</b></div><div className="empty"><div className="ring"><span>—<small>kcal</small></span></div><p>Votre journée se dessinera<br/>au fil de vos repas.</p></div><button className="action" onClick={() => navigate('journal')}>Ouvrir le journal <span>→</span></button></article>
  <article className="card progress"><div className="card-title"><span className="tile lilac">⌁</span><small>VOTRE SUIVI</small><b>↗</b></div><div className="chart"><div className="chart-head"><span>Votre évolution</span><span>À venir</span></div><div className="plot"><i/><i/><i/><svg viewBox="0 0 400 100" preserveAspectRatio="none" aria-label="Graphique en attente de données"><path d="M0 72 C 58 67 73 48 123 56 S 188 72 229 45 S 297 49 332 29 S 374 27 400 15" fill="none" stroke="#d4d2e7" strokeWidth="2" strokeDasharray="5 7"/></svg><span>Vos repères apparaîtront ici</span></div><div className="axis"><span>SEMAINE 1</span><span>SEMAINE 2</span><span>SEMAINE 3</span><span>SEMAINE 4</span></div></div><button className="action lilac-text" onClick={() => navigate('tracking')}>Voir mon suivi <span>→</span></button></article>
  <article className="quote"><b>“</b><p>Le mieux-être n’est pas une destination,<br/>c’est une attention que l’on se porte<br/><em>chaque jour.</em></p><small>UN JOUR À LA FOIS</small><i>✳</i></article></section>
  <section className="quick"><div><small>POUR CONTINUER</small><h2>Vos espaces</h2></div><div className="quick-list"><Quick icon="◷" title="Historique" subtitle="Retrouvez vos journées" tone="peach" click={() => navigate('history')}/><Quick icon="♧" title="Recettes" subtitle="Vos idées à cuisiner" tone="sage" click={() => navigate('recipes')}/><Quick icon="✳" title="Coach IA" subtitle="Un regard bienveillant" tone="lilac" click={() => navigate('coach')}/></div></section></div>
}
function Quick({ icon, title, subtitle, tone, click }: { icon: string; title: string; subtitle: string; tone: string; click: () => void }) { return <button className="quick-item" onClick={click}><span className={'quick-icon '+tone}>{icon}</span><span><b>{title}</b><small>{subtitle}</small></span><i>↗</i></button> }
