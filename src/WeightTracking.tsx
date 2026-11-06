import {useEffect,useMemo,useState,type FormEvent} from 'react'
import {authClient,requestPrivateJson} from './auth/client'
import type {Profile} from './ProfileSettings'

type Measurement={id:string;measuredOn:string;weightKg:number;note:string}
const localDay=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function WeightChart({items,target}: {items:Measurement[];target:number|null}){
  const sorted=useMemo(()=>[...items].sort((a,b)=>a.measuredOn.localeCompare(b.measuredOn)).slice(-40),[items])
  if(sorted.length<2)return <div className="data-empty">Ajoutez au moins deux mesures pour afficher votre évolution.</div>
  const values=sorted.map(x=>x.weightKg)
  const lo=Math.floor(Math.min(...values,...(target===null?[]:[target]))-2),hi=Math.ceil(Math.max(...values,...(target===null?[]:[target]))+2)
  const den=Math.max(1,hi-lo)
  const x=(i:number)=>30+i*640/(sorted.length-1)
  const y=(n:number)=>195-(n-lo)*160/den
  const points=sorted.map((m,i)=>String(x(i))+','+String(y(m.weightKg))).join(' ')
  return <div className="weight-chart"><svg viewBox="0 0 700 230" role="img" aria-label="Évolution du poids en kilogrammes">
    {[0,1,2,3,4].map(i=><line key={i} x1="30" x2="670" y1={35+i*40} y2={35+i*40} stroke="#e6eee5" strokeDasharray="4 7"/>)}
    {target!==null&&<><line x1="30" x2="670" y1={y(target)} y2={y(target)} stroke="#e49c45" strokeDasharray="8 5" strokeWidth="2"/><text x="670" y={Math.max(18,y(target)-6)} textAnchor="end" fill="#aa732c" fontSize="11">Cible {target} kg</text></>}
    <polyline points={points} fill="none" stroke="#397952" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round"/>
    {sorted.map((m,i)=><circle key={m.id} cx={x(i)} cy={y(m.weightKg)} r="4" fill="#397952" stroke="white" strokeWidth="2"/>)}
    <text x="30" y="220" fontSize="11" fill="#8da18f">{sorted[0].measuredOn}</text>
    <text x="670" y="220" textAnchor="end" fontSize="11" fill="#8da18f">{sorted[sorted.length-1].measuredOn}</text>
  </svg></div>
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
