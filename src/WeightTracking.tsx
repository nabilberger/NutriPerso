import {useEffect,useMemo,useState,type FormEvent} from 'react'
import {authClient,requestPrivateJson} from './auth/client'
import type {Profile} from './ProfileSettings'

type Measurement={id:string;measuredOn:string;weightKg:number;note:string}
const localDay=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
const dayMs = 86_400_000
const dayTime = (date: string) => Date.parse(date + 'T00:00:00Z')
const shortDate = new Intl.DateTimeFormat('fr', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const kilograms = new Intl.NumberFormat('fr', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function WeightChart({ items, target }: { items: Measurement[]; target: number | null }) {
  const [period, setPeriod] = useState<'week' | 'month' | 'custom'>('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const all = useMemo(() => [...items].sort((a, b) => a.measuredOn.localeCompare(b.measuredOn)), [items])
  const latest = all.at(-1)?.measuredOn
  const invalid = period === 'custom' && !!from && !!to && from > to
  const minimum = period === 'custom' ? (from ? dayTime(from) : -Infinity) : latest ? dayTime(latest) - (period === 'week' ? 6 : 29) * dayMs : -Infinity
  const maximum = period === 'custom' ? (to ? dayTime(to) : Infinity) : latest ? dayTime(latest) : Infinity
  const rows = invalid ? [] : all.filter(item => dayTime(item.measuredOn) >= minimum && dayTime(item.measuredOn) <= maximum)
  const first = rows[0], last = rows.at(-1)
  const current = rows.find(row => row.id === selected) ?? last
  const start = first ? dayTime(first.measuredOn) : 0
  const span = last ? dayTime(last.measuredOn) - start : 0
  const values = rows.map(row => row.weightKg)
  if (target !== null) values.push(target)
  const low = Math.floor(Math.min(...values)) - 1
  const high = Math.ceil(Math.max(...values)) + 1
  const x = (row: Measurement) => span ? 44 + 286 * (dayTime(row.measuredOn) - start) / span : 187
  const y = (value: number) => 145 - 116 * (value - low) / (high - low)
  const points = rows.map(row => x(row) + ',' + y(row.weightKg)).join(' ')
  return <div className="weight-chart">
    <fieldset className="weight-period"><legend>Période</legend>
      {([['week', 'Semaine'], ['month', 'Mois'], ['custom', 'Personnalisée']] as const).map(([value, label]) =>
        <button key={value} type="button" aria-pressed={period === value} onClick={() => { setPeriod(value); setSelected(null) }}>{label}</button>)}
    </fieldset>
    {period === 'custom' && <div className="weight-dates">
      <label>Du <input type="date" value={from} onChange={event => setFrom(event.target.value)}/></label>
      <label>Au <input type="date" value={to} onChange={event => setTo(event.target.value)}/></label>
    </div>}
    {invalid ? <p role="alert">La date de début doit précéder la date de fin.</p>
      : !first || !last || !current ? <p className="data-empty">Aucune mesure sur cette période.</p>
      : <>
        <svg viewBox="0 0 360 177" role="group" aria-label="Évolution du poids en kilogrammes">
          {[0, 1, 2, 3].map(i => {
            const value = high - (high - low) * i / 3
            return <g key={i} className="weight-grid"><line x1="44" x2="330" y1={y(value)} y2={y(value)}/><text x="37" y={y(value)+3} textAnchor="end">{kilograms.format(value)}</text></g>
          })}
          {span > 0 && <polygon className="weight-area" points={x(first)+',145 '+points+' '+x(last)+',145'}/>}
          {target !== null && <line className="weight-target" x1="44" x2="330" y1={y(target)} y2={y(target)}><title>Cible {target} kg</title></line>}
          <polyline className="weight-line" points={points}/>
          {rows.map(row => <g key={row.id} role="button" tabIndex={0} aria-pressed={row.id === current.id}
            aria-label={row.measuredOn + ' · ' + kilograms.format(row.weightKg) + ' kg'}
            onFocus={() => setSelected(row.id)} onPointerEnter={() => setSelected(row.id)} onClick={() => setSelected(row.id)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(row.id) } }}>
            <circle cx={x(row)} cy={y(row.weightKg)} r="13" fill="transparent"/>
            <circle className="weight-point" cx={x(row)} cy={y(row.weightKg)} r={row.id === current.id ? 5 : 3.5}/>
          </g>)}
          <text className="weight-axis-date" x="44" y="166">{shortDate.format(start)}</text>
          {span > 0 && <text className="weight-axis-date" x="330" y="166" textAnchor="end">{shortDate.format(dayTime(last.measuredOn))}</text>}
        </svg>
        <p className="weight-detail" role="status"><time dateTime={current.measuredOn}>{current.measuredOn}</time> · <strong>{kilograms.format(current.weightKg)} kg</strong>{current.note && ' · '+current.note}</p>
      </>}
  </div>
}
export default function WeightTracking(){
  const [items,setItems]=useState<Measurement[]>([])
  const [goal,setGoal]=useState<number|null>(null)
  const [date,setDate]=useState(localDay)
  const [weight,setWeight]=useState('')
  const [note,setNote]=useState('')
  const [loading,setLoading]=useState(true)
  const [historyUnavailable,setHistoryUnavailable]=useState(false)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  useEffect(()=>{
    let live=true
    void Promise.allSettled([
      requestPrivateJson<{measurements:Measurement[]}>('/api/private/measurements'),
      requestPrivateJson<{profile:Profile}>('/api/private/profile')
    ]).then(([measurements,profile])=>{if(live){
      const errors:string[]=[]
      if(measurements.status==='fulfilled')setItems(measurements.value.measurements)
      else {setHistoryUnavailable(true);errors.push(measurements.reason instanceof Error?measurements.reason.message:'Historique du poids inaccessible.')}
      if(profile.status==='fulfilled')setGoal(profile.value.profile.targetWeightKg)
      else errors.push('Objectif du profil inaccessible.')
      setError(errors.join(' '))
    }})
      .finally(()=>{if(live)setLoading(false)})
    return()=>{live=false}
  },[])
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const n=Number(weight)
    if(!Number.isFinite(n)||n<25||n>350){setError('Indiquez un poids valide.');return}
    setSaving(true);setError('');setMessage('')
    try{
      const result=await requestPrivateJson<{measurement:Measurement}>('/api/private/measurements',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({measuredOn:date,weightKg:n,note})
      })
      setItems(p=>[result.measurement,...p].sort((a,b)=>b.measuredOn.localeCompare(a.measuredOn)))
      setWeight('');setNote('');setMessage('Mesure enregistrée.')
    }catch(e){setError(e instanceof Error?e.message:'Enregistrement impossible.')}
    finally{setSaving(false)}
  }
  async function remove(id:string){
    if(!window.confirm('Supprimer cette mesure ?'))return
    setError('');setMessage('')
    try{
      const res=await authClient.requestPrivate('/api/private/measurements/'+encodeURIComponent(id),{method:'DELETE'})
      if(!res.ok)throw new Error('Suppression impossible.')
      setItems(p=>p.filter(x=>x.id!==id));setMessage('Mesure supprimée.')
    }catch(e){setError(e instanceof Error?e.message:'Suppression impossible.')}
  }
  const current=items[0]
  return <div className="data-page">
    <div className="data-heading"><small>MON ÉVOLUTION</small><h1>Le poids, <em>dans la durée.</em></h1><p>Vos mesures et votre progression, avec des repères clairs.</p></div>
    {error&&<p className="data-error" role="alert">{error}</p>}{message&&<p className="profile-feedback" role="status">{message}</p>}
    <div className="weight-summary">
      <div><small>DERNIÈRE MESURE</small><strong>{current?current.weightKg.toFixed(1):'—'} <span>kg</span></strong><p>{current?current.measuredOn:'Aucune mesure enregistrée'}</p></div>
      <div><small>MON OBJECTIF</small><strong>{goal!==null?goal.toFixed(1):'—'} <span>kg</span></strong><p>Modifiable dans Mon profil</p></div>
      <div className="weight-accent"><small>VOTRE PROGRESSION</small><p>La constance compte davantage que les fluctuations quotidiennes.</p></div>
    </div>
    <div className="weight-layout">
      <section className="data-card"><h2>Courbe de poids</h2>{loading?<p className="data-muted">Chargement…</p>:historyUnavailable?<div className="data-empty" role="status">La courbe est indisponible tant que l’historique ne peut pas être chargé.</div>:<WeightChart items={items} target={goal}/>}</section>
      <section className="data-card"><h2>Ajouter une mesure</h2><form onSubmit={e=>void submit(e)} className="measurement-form">
        <label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)} required /></label>
        <label>Poids (kg)<input type="number" min="25" max="350" step="0.1" value={weight} onChange={e=>setWeight(e.target.value)} required placeholder="Ex. 75,0"/></label>
        <label>Note facultative<input type="text" maxLength={300} value={note} onChange={e=>setNote(e.target.value)} placeholder="Après entraînement, matin…"/></label>
        <button type="submit" disabled={saving||loading}>{saving?'Enregistrement…':'Enregistrer la mesure'}</button>
      </form></section>
    </div>
    <section className="data-card weight-history"><h2>Historique de mes mesures</h2>
      {historyUnavailable?<div className="data-empty" role="status">L’historique est temporairement indisponible. Réessayez plus tard.</div>
      :items.length===0?<div className="data-empty">Votre historique apparaîtra ici après la première saisie.</div>
      :<div className="measurement-list">{items.map(m=><div key={m.id}><time>{m.measuredOn}</time><strong>{m.weightKg.toFixed(1)} kg</strong><span>{m.note}</span><button type="button" onClick={()=>void remove(m.id)} aria-label={'Supprimer la mesure du '+m.measuredOn}>Supprimer</button></div>)}</div>}
    </section>
  </div>
}
