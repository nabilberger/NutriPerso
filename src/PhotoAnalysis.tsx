import { decimalToFraction, parseDecimal } from './domain/nutrition/decimal'
import { useEffect, useRef, useState } from 'react'
import { requestPrivateJson } from './auth/client'
import { createUuidV4 } from './secure-uuid'
import { parsePhotoProposal, type PhotoSuggestion } from './photo-analysis'
import type { FoodNutritionSnapshot } from './domain/nutrition/recipes'
import type { FoodQuantityInput } from './domain/nutrition/portions'
import { FoodPicker } from './Journal'

type Row = PhotoSuggestion & { food?: FoodNutritionSnapshot; quantity?: FoodQuantityInput }
type Saved = { rows: Row[]; warning: string; id: string | null; pending: boolean; expires: number }
export default function PhotoAnalysis({ photo, storageKey, onDraft }: { photo: string; storageKey: string; onDraft: (items: {food:FoodNutritionSnapshot;quantity:FoodQuantityInput}[])=>void }) {
  const [saved,setSaved]=useState<Saved>(()=>{try{const v=JSON.parse(localStorage.getItem(storageKey)??'null');if(v && (v.pending || v.expires>Date.now()))return v}catch{}return {rows:[],warning:'',id:null,pending:false,expires:Date.now()+30*86400000}})
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[picker,setPicker]=useState<number|null>(null),[usage,setUsage]=useState('')
  const alive=useRef(true)
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false}},[])
  useEffect(()=>{try{localStorage.setItem(storageKey,JSON.stringify(saved))}catch{setError('Stockage local indisponible : gardez cette page ouverte.')}},[saved,storageKey])
  async function analyze(){
    if(!navigator.onLine){setSaved(s=>({...s,pending:true}));setError('Demande conservée hors connexion. Relancez explicitement après reconnexion.');return}
    setBusy(true);setError('');const id=createUuidV4();setSaved(s=>({...s,id,pending:true}))
    try{
      const r=await requestPrivateJson<{proposal:unknown}>('/api/private/photo-analysis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,photo})})
      const p=parsePhotoProposal(r.proposal)
      if(alive.current)setSaved(s=>({...s,rows:p.items,warning:p.warning,pending:false}))
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Analyse indisponible.')}
    finally{if(alive.current){setBusy(false);void requestPrivateJson<{reservedDh:number;requests:number}>('/api/private/photo-analysis/usage').then(u=>setUsage(`${u.requests} tentative(s), ${u.reservedDh} DH réservés ce mois sur 50 DH.`)).catch(()=>{})}}
  }
  async function remove(){if(!saved.id)return;setBusy(true);try{await requestPrivateJson('/api/private/photos/'+saved.id,{method:'DELETE'});setSaved(s=>({...s,id:null}));setError('Photo distante supprimée. Les repas restent inchangés.')}catch{setError('Suppression impossible, réessayez.')}finally{setBusy(false)}}
  function update(index:number,patch:Partial<Row>){setSaved(s=>({...s,rows:s.rows.map((r,i)=>i===index?{...r,...patch}:r)}))}
  return <section className="journal-food-picker photo-analysis" aria-label="Analyse photographique">
    <h2>Proposition depuis la photo</h2><p>Estimations visuelles à vérifier. Aucun repas ne sera confirmé automatiquement. La photo est envoyée à Gemini et conservée en privé pendant 30 jours au maximum.</p>
    <button disabled={busy} onClick={()=>void analyze()}>{busy?'Analyse en cours…':saved.pending?'Relancer l’analyse en attente':'Analyser la photo'}</button>
    {saved.pending&&<button disabled={busy} onClick={()=>setSaved(s=>({...s,pending:false}))}>Annuler la demande</button>}
    {saved.id&&<button disabled={busy} onClick={()=>void remove()}>Supprimer la photo distante</button>}
    {error&&<p role="alert">{error}</p>}{usage&&<p role="status">{usage}</p>}<p>{saved.warning}</p>
    {saved.rows.map((r,i)=><article key={i} className="journal-food-picker">
      <label>Aliment estimé<input value={r.name} onChange={e=>update(i,{name:e.target.value,food:undefined,quantity:undefined})}/></label>
      <p>Source suggérée : {r.source} — {r.uncertainty || 'Quantité estimée à vérifier'}</p>
      <label>Quantité estimée<input inputMode="decimal" value={r.amount??''} placeholder="Inconnue" onChange={e=>update(i,{amount:e.target.value,food:undefined,quantity:undefined})}/></label>
      <label>Unité estimée<select value={r.unit} onChange={e=>update(i,{unit:e.target.value as 'g'|'ml',food:undefined,quantity:undefined})}><option>g</option><option>ml</option></select></label>
      <button onClick={()=>setPicker(i)}>Choisir / remplacer la fiche {i+1}</button><button onClick={()=>setSaved(s=>({...s,rows:s.rows.filter((_,j)=>j!==i)}))}>Retirer la proposition {i+1}</button>
      {r.food&&<p>Fiche retenue : {r.food.description} · {r.quantity?.amount} {r.quantity?.unit}</p>}
      {picker===i&&<FoodPicker initialQuery={r.name} initialAmount={r.amount||'100'} initialUnit={r.unit} addLabel="Retenir cette fiche" onCancel={()=>setPicker(null)} onSelect={(food,quantity)=>{try {if(decimalToFraction(parseDecimal(quantity.amount)).numerator<=0n)throw new Error();update(i,{food,quantity});setPicker(null);setError('')}catch{setError('Indiquez une quantité positive valide.')}}}/>}
    </article>)}
    <button disabled={busy} onClick={()=>setSaved(s=>({...s,rows:[...s.rows,{name:'',amount:null,unit:'g',source:'À sélectionner',uncertainty:'Ajout manuel'}]}))}>Ajouter une proposition</button>
    <button disabled={busy||!saved.rows.length||saved.rows.some(r=>!r.food||!r.quantity)} onClick={()=>{onDraft(saved.rows.map(r=>({food:r.food!,quantity:r.quantity!})));setSaved(s=>({...s,rows:[],pending:false}))}}>Créer un brouillon avec ces aliments</button>
    <p>Choisissez une fiche et vérifiez la quantité réelle pour chaque ligne. Le moteur NutriPerso calcule ensuite les apports ; confirmez le repas dans le journal.</p>
  </section>
}
