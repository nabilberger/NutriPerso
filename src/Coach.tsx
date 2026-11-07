import { useEffect, useState, type FormEvent } from 'react'
import { coachSkills, type CoachAnswer, type CoachSkill } from './coach-contract'
import { requestPrivateJson } from './auth/client'
import { createUuidV4 } from './secure-uuid'

type Exchange = { question: string; answer: CoachAnswer }
type Conversation = { id: string; created: number; exchanges: Exchange[] }
const retention = 7 * 86400000
const fresh = (threads: Conversation[]) => threads.filter(thread => thread.created + retention > Date.now())

function readThreads(key: string): Conversation[] {
  try { return fresh(JSON.parse(localStorage.getItem(key) ?? '[]')) }
  catch { return [] }
}

export default function Coach({ userId }: { userId: string }) {
  const key = 'nutrip-coach-v1:' + userId
  const [threads, setThreads] = useState(() => readThreads(key))
  const [active, setActive] = useState<string | null>(null)
  const [skill, setSkill] = useState<CoachSkill>('day')
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const current = fresh(threads).find(thread => thread.id === active)
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(threads)) }
    catch { /* Keep conversations in memory when storage is unavailable. */ }
    const expiration = Math.min(...threads.map(thread => thread.created + retention))
    if (!Number.isFinite(expiration)) return
    const timer = setTimeout(() => setThreads(fresh), Math.max(0, expiration - Date.now()))
    return () => clearTimeout(timer)
  }, [key, threads])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = question.trim()
    if (busy || !text) return
    const thread = current ?? { id: createUuidV4(), created: Date.now(), exchanges: [] }
    setBusy(true)
    setError('')
    try {
      const prior = thread.exchanges.slice(-2).flatMap(({ question, answer }) => [question, answer.suggestions.slice(0, 1200)])
      const { answer } = await requestPrivateJson<{ answer: CoachAnswer }>('/api/private/coach', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skill, question: text, prior }),
      })
      setThreads(previous => fresh([{ ...thread, exchanges: [...thread.exchanges.slice(-19), { question: text, answer }] }, ...previous.filter(item => item.id !== thread.id)].slice(0, 20)))
      setActive(thread.id)
      setQuestion('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Le Coach IA est indisponible.')
    } finally { setBusy(false) }
  }

  return <section className="data-page coach-page">
    <div className="data-heading"><small>NUTRIPERSO</small><h1>Coach IA</h1><p>Posez une question sur vos repas, vos habitudes ou vos idées de cuisine.</p></div>
    <section className="data-card">
      <h2>Conversations</h2>
      <p>Conservées sept jours dans ce navigateur. Votre question et le contexte pertinent sont transmis à Gemini.</p>
      <button type="button" disabled={busy} onClick={() => { setActive(null); setQuestion(''); setError('') }}>Nouvelle conversation</button>
      {fresh(threads).map(thread => <div key={thread.id}>
        <button type="button" disabled={busy} aria-pressed={active === thread.id} onClick={() => { setActive(thread.id); setError('') }}>{new Intl.DateTimeFormat('fr').format(thread.created)} · {thread.exchanges[0]?.question.slice(0, 60)}</button>
        <button type="button" disabled={busy} onClick={() => { setThreads(items => items.filter(item => item.id !== thread.id)); if (active === thread.id) setActive(null) }}>Supprimer</button>
      </div>)}
    </section>
    {current?.exchanges.map(({ question, answer }, index) => <article className="data-card" key={index}>
      <h2>{question}</h2>
      {([['Données enregistrées', answer.recorded], ['Suggestions', answer.suggestions], ['Incertitudes', answer.uncertainty]] as const).map(([label, text]) =>
        <div key={label}><h3>{label}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{text}</p></div>)}
    </article>)}
    <form className="data-card measurement-form" onSubmit={event => void submit(event)}>
      <label>Compétence<select value={skill} onChange={event => setSkill(event.target.value as CoachSkill)} disabled={busy}>
        {Object.entries(coachSkills).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label>Votre question<textarea value={question} maxLength={800} required disabled={busy} onChange={event => setQuestion(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy || !question.trim()}>{busy ? 'Réponse en cours…' : 'Envoyer au Coach'}</button>
    </form>
  </section>
}
