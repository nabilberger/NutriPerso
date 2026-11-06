import {useEffect,useState} from 'react'
import {requestPrivateJson} from './auth/client'
import {createUuidV4} from './secure-uuid'
import {emptyPersonalFood,personalFoodSnapshot,validatePersonalFood,type PersonalFood,type PersonalPortion} from './personal-food'
import {NutritionValues} from './LocalFoodPicker'
import {NUTRIENT_CODES,type NutrientSourceUnit} from './domain/nutrition/types'
import './recipes.css'
type Row={id:string;name:string;revision:number;archived:boolean}
const labels={energy:'Énergie',protein:'Protéines',carbohydrate:'Glucides',fat:'Lipides',fiber:'Fibres'}
export default function PersonalFoods(){
 const [rows,setRows]=useState<Row[]>([]),[draft,setDraft]=useState<PersonalFood|null>(null),[revision,setRevision]=useState(0)
 const [busy,setBusy]=useState(true),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[archives,setArchives]=useState(false)
 useEffect(()=>{let active=true;void requestPrivateJson<{foods:Row[]}>('/api/private/personal-foods').then(r=>{if(active)setRows(r.foods)}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Catalogue indisponible.')}).finally(()=>{if(active)setBusy(false)});return()=>{active=false}},[])
 const mayLeave=()=>!dirty||window.confirm('Abandonner les modifications non enregistrées de cette fiche ?')
 function change(next:PersonalFood){setDraft(next);setDirty(true);setError('');setMessage('')}
 function create(){if(!mayLeave())return;setDraft(emptyPersonalFood(createUuidV4()));setRevision(0);setDirty(true);setError('');setMessage('')}
 async function open(id:string){
  if(!mayLeave())return;setBusy(true);setError('');setMessage('')
  try{const r=await requestPrivateJson<{document:PersonalFood}>('/api/private/personal-foods/'+id);setDraft(r.document);setRevision(r.document.revision);setDirty(false);setRows(current=>current.map(row=>row.id===id?{id,name:r.document.name,revision:r.document.revision,archived:r.document.archived}:row))}catch(e){setError(e instanceof Error?e.message:'Lecture impossible.')}finally{setBusy(false)}
 }
 let invalid=''
 if(draft)try{validatePersonalFood(draft)}catch(e){invalid=e instanceof Error?e.message:'Fiche invalide.'}
 async function save(){if(!draft||invalid)return;setBusy(true);setError('');setMessage('')
  try{const r=await requestPrivateJson<{document:PersonalFood}>('/api/private/personal-foods/'+draft.id,{method:'PUT',body:JSON.stringify({document:{...draft,name:draft.name.trim(),revision:revision+1},expectedRevision:revision})});setDraft(r.document);setRevision(r.document.revision);setDirty(false);setRows(current=>[{id:r.document.id,name:r.document.name,revision:r.document.revision,archived:r.document.archived},...current.filter(row=>row.id!==r.document.id)]);setMessage('Fiche enregistrée. Disponible dans le journal et les recettes.')}
  catch(e){setError(e instanceof Error?e.message:'Enregistrement impossible.')}finally{setBusy(false)}
 }
 async function archive(row:Row){if(!window.confirm(`Archiver « ${row.name} » ? Les repas et recettes confirmés restent inchangés.`))return;setBusy(true);setError('')
  try{await requestPrivateJson('/api/private/personal-foods/'+row.id,{method:'DELETE',body:JSON.stringify({expectedRevision:row.revision})});setRows(current=>current.map(r=>r.id===row.id?{...r,archived:true,revision:r.revision+1}:r));if(draft?.id===row.id){setDraft(null);setDirty(false)}setMessage('Fiche archivée. Les historiques confirmés sont conservés.')}
  catch(e){setError(e instanceof Error?e.message:'Archivage impossible.')}finally{setBusy(false)}
 }
 function portion(index:number,changes:Partial<PersonalPortion>){if(draft)change({...draft,portions:draft.portions.map((p,i)=>i===index?{...p,...changes}:p)})}
 return <section className="personal-foods recipes-page" aria-label="Mes fiches personnelles"><h2>Mes aliments personnels</h2><p>Valeur vide = inconnue. Le zéro doit être saisi explicitement.</p>
  {error&&<p role="alert" className="data-error">{error}</p>}{message&&<p role="status">{message}</p>}
  <button type="button" disabled={busy} onClick={create}>Créer une fiche alimentaire</button>
  {draft&&<section className="data-card recipe-editor" aria-label="Éditeur de fiche alimentaire"><h3>{draft.archived?'Fiche archivée':'Fiche alimentaire'}</h3><fieldset disabled={busy||draft.archived}>
   <label>Nom de l’aliment<input value={draft.name} onChange={e=>change({...draft,name:e.target.value})}/></label>
   <label>Catégorie<input value={draft.category} onChange={e=>change({...draft,category:e.target.value})}/></label>
   <label>Source ou référence<input value={draft.reference} onChange={e=>change({...draft,reference:e.target.value})}/></label>
   <label>Notes<textarea value={draft.notes} onChange={e=>change({...draft,notes:e.target.value})}/></label>
   <label>Base nutritionnelle<select aria-label="Base nutritionnelle" value={draft.basis} onChange={e=>change({...draft,basis:e.target.value as 'g'|'ml'})}><option value="g">Pour 100 g</option><option value="ml">Pour 100 ml</option></select></label>
   {NUTRIENT_CODES.map(code=><div className="recipe-fields" key={code}><label>{labels[code]} pour 100 {draft.basis}<input aria-label={labels[code]+' de référence'} inputMode="decimal" value={draft.nutrients[code].value??''} placeholder="Inconnu" onChange={e=>change({...draft,nutrients:{...draft.nutrients,[code]:{...draft.nutrients[code],value:e.target.value===''?null:e.target.value.replace(',','.')}}})}/></label>
    <label>Unité {labels[code]}<select aria-label={'Unité '+labels[code]} value={draft.nutrients[code].unit} onChange={e=>change({...draft,nutrients:{...draft.nutrients,[code]:{...draft.nutrients[code],unit:e.target.value as NutrientSourceUnit}}})}>{(code==='energy'?['kcal','kJ']:['g','mg']).map(unit=><option key={unit}>{unit}</option>)}</select></label></div>)}
   <h3>Équivalences de portions</h3><p>Chaque référence correspond exactement à une portion : 1 cuillère, 1 pièce ou 1 verre. Une quantité vide reste inconnue.</p>
   {draft.portions.map((p,index)=><div className="recipe-ingredient" key={p.id}><label>Nom de la portion<input aria-label={'Nom de portion '+(index+1)} value={p.label} onChange={e=>portion(index,{label:e.target.value})}/></label>
    <label>Type de portion<select aria-label={'Type de portion '+(index+1)} value={p.unit} onChange={e=>portion(index,{unit:e.target.value as PersonalPortion['unit']})}><option value="custom">Personnalisée (verre…)</option><option value="piece">Pièce</option><option value="slice">Tranche</option><option value="teaspoon">Cuillère à café</option><option value="tablespoon">Cuillère à soupe</option></select></label>
    <div className="recipe-fields"><label>1 {p.label||'portion'} =<input aria-label={'Quantité équivalente '+(index+1)} inputMode="decimal" value={p.amount??''} placeholder="Inconnue" onChange={e=>portion(index,{amount:e.target.value===''?null:e.target.value.replace(',','.')})}/></label><label>Unité équivalente<select aria-label={'Unité équivalente '+(index+1)} value={p.basis} onChange={e=>portion(index,{basis:e.target.value as 'g'|'ml'})}><option>g</option><option>ml</option></select></label><button type="button" onClick={()=>change({...draft,portions:draft.portions.filter((_,i)=>i!==index)})}>Retirer cette équivalence</button></div>
   </div>)}
   <button type="button" onClick={()=>change({...draft,portions:[...draft.portions,{id:createUuidV4(),label:'',unit:'custom',amount:null,basis:draft.basis}]})}>Ajouter une équivalence</button>
   {invalid?<p role="status" className="data-error">{invalid}</p>:<NutritionValues food={personalFoodSnapshot(draft)}/>}
   <button type="button" className="journal-primary" disabled={!!invalid||!dirty} onClick={()=>void save()}>Enregistrer la fiche</button>
  </fieldset><div className="recipe-actions">{revision>0&&<button type="button" disabled={busy} onClick={()=>void open(draft.id)}>Recharger la fiche</button>}<button type="button" disabled={busy} onClick={()=>{if(mayLeave()){setDraft(null);setDirty(false)}}}>Fermer la fiche</button></div></section>}
  <label><input type="checkbox" checked={archives} onChange={e=>setArchives(e.target.checked)}/> Afficher les fiches archivées</label>
  <div className="recipes-list">{rows.filter(r=>archives||!r.archived).map(row=><article key={row.id}><div><h3>{row.name}</h3><p>Version {row.revision}{row.archived?' · Archivée':''}</p></div><button type="button" disabled={busy} onClick={()=>void open(row.id)}>{row.archived?'Consulter':'Consulter / modifier'}</button>{!row.archived&&<button type="button" disabled={busy} onClick={()=>void archive(row)}>Archiver</button>}</article>)}</div>
  {!busy&&!rows.some(r=>archives||!r.archived)&&<p>Aucune fiche personnelle.</p>}
 </section>
}
