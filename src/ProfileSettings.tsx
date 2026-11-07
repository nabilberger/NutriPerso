import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { requestPrivateJson } from './auth/client'

export type Profile = {
  displayName: string
  avatarDataUrl: string | null
  heightCm: number | null
  targetWeightKg: number | null
  goal: 'maintain' | 'lose' | 'gain'
  dietaryPattern: 'mediterranean' | 'vegetarian' | 'vegan' | 'other'
  mealsPerDay: number
  fastingEnabled: boolean
  fastingStart: string | null
  fastingEnd: string | null
  avoidAddedSalt: boolean
  avoidAddedSugar: boolean
  notes: string
  timeZone: string
}
type ProfileResponse = { profile: Profile }
type Props = { email: string | null; onSaved: (profile: Profile) => void }

function profileInitial(email: string | null): string {
  return email?.split('@')[0] ?? 'Votre profil'
}
async function compressPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choisissez une image.')
  if (file.size > 12_000_000) throw new Error('La photo est trop volumineuse.')
  const img = new Image()
  const url = URL.createObjectURL(file)
  try {
    await new Promise<void>((resolve,reject) => {
      img.onload=()=>resolve(); img.onerror=()=>reject(new Error('Impossible de lire la photo.')); img.src=url
    })
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 256/Math.max(img.naturalWidth,img.naturalHeight))
    canvas.width=Math.max(1,Math.round(img.naturalWidth*scale))
    canvas.height=Math.max(1,Math.round(img.naturalHeight*scale))
    const ctx=canvas.getContext('2d')
    if (!ctx) throw new Error('Conversion de la photo impossible.')
    ctx.drawImage(img,0,0,canvas.width,canvas.height)
    const result=canvas.toDataURL('image/jpeg',0.68)
    if (result.length>90000) throw new Error('Photo trop lourde après compression.')
    return result
  } finally { URL.revokeObjectURL(url) }
}
export default function ProfileSettings({email,onSaved,guided = false,onGuideDone}: Props & { guided?: boolean; onGuideDone?: () => void }) {
  const [step,setStep]=useState(0)
  const [profile,setProfile]=useState<Profile|null>(null)
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [photoProcessing,setPhotoProcessing]=useState(false)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  useEffect(()=>{
    let active=true
    void requestPrivateJson<ProfileResponse>('/api/private/profile').then(x=>{
      if(active){setProfile(x.profile);onSaved(x.profile)}
    }).catch((e:unknown)=>{if(active)setError(e instanceof Error?e.message:'Profil inaccessible.')})
      .finally(()=>{if(active)setLoading(false)})
    return ()=>{active=false}
  },[onSaved])
  function patch<K extends keyof Profile>(key: K, value: Profile[K]) {setProfile(p=>p?{...p,[key]:value}:p);setMessage('')}
  async function photoChanged(e:ChangeEvent<HTMLInputElement>) {
    const file=e.target.files?.[0]
    if(!file)return
    setPhotoProcessing(true)
    try {patch('avatarDataUrl',await compressPhoto(file));setError('')}
    catch(err){setError(err instanceof Error?err.message:'Photo invalide.')}
    finally {e.target.value='';setPhotoProcessing(false)}
  }
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault()
    if(!profile)return
    if(guided && step < 2){setStep(step + 1);return}
    setSaving(true);setError('');setMessage('')
    try {
      const saved=await requestPrivateJson<ProfileResponse>('/api/private/profile',{
        method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(profile)
      })
      setProfile(saved.profile);onSaved(saved.profile);setMessage('Votre profil a été enregistré.');if(guided)onGuideDone?.()
    }catch(err){setError(err instanceof Error?err.message:'Enregistrement impossible.')}
    finally {setSaving(false)}
  }
  return <div className="profile-page">
    <div className="profile-heading"><small>VOTRE ESPACE PERSONNEL</small><h1 tabIndex={-1}>{guided ? 'Configuration du profil' : <>Un espace <em>à votre image.</em></>}</h1>{guided && <p role="status">Étape {step+1} sur 3. Vous pourrez modifier vos choix ensuite.</p>}
      <p>Vos objectifs, vos habitudes et vos préférences, au même endroit.</p></div>
    {loading ? <p className="profile-notice">Chargement de votre profil…</p>
    : !profile ? <div className="profile-notice" role="alert">{error || 'Impossible de charger le profil.'}</div>
    : <form className="profile-layout" onSubmit={e=>void submit(e)} aria-busy={saving}>
      <fieldset className="profile-edit-fields" aria-label="Paramètres personnels" disabled={saving}>
      {(!guided || step === 0) && <section className="profile-panel profile-identity">
        <div className="profile-avatar">
          {profile.avatarDataUrl ? <img src={profile.avatarDataUrl} alt="Photo de profil"/> : <span>{profile.displayName.trim().charAt(0).toUpperCase() || profileInitial(email).charAt(0).toUpperCase()}</span>}
        </div>
        <label className="photo-action">Choisir une photo<input type="file" accept="image/*" disabled={photoProcessing} onChange={e=>void photoChanged(e)} /></label>
        {photoProcessing&&<span className="profile-feedback" role="status">Traitement de la photo…</span>}
        {profile.avatarDataUrl && <button type="button" className="text-button" disabled={photoProcessing} onClick={()=>patch('avatarDataUrl',null)}>Retirer la photo</button>}
        <h2>{profile.displayName || profileInitial(email)}</h2><p>{email}</p>
        <div className="profile-detail"><span>Votre objectif</span><strong>{profile.goal==='maintain'?'Stabiliser':profile.goal==='lose'?'Réduire':'Augmenter'} le poids</strong></div>
        <div className="profile-detail"><span>Vos repas quotidiens</span><strong>{profile.mealsPerDay}</strong></div>
      </section>}
      <section className="profile-panel profile-fields">
        {(!guided || step === 0) && <>
        <div className="profile-section-title"><small>01 / IDENTITÉ & OBJECTIFS</small><h2>Mes repères</h2></div>
        <div className="profile-form-grid">
          <label>Nom affiché<input maxLength={80} value={profile.displayName} onChange={e=>patch('displayName',e.target.value)} placeholder="Votre prénom" /></label>
          <label>Taille (cm)<input inputMode="decimal" type="number" min="80" max="250" step="0.1" value={profile.heightCm??''} onChange={e=>patch('heightCm',e.target.value===''?null:Number(e.target.value))} placeholder="—" /></label>
          <label>Poids cible (kg)<input inputMode="decimal" type="number" min="25" max="350" step="0.1" value={profile.targetWeightKg??''} onChange={e=>patch('targetWeightKg',e.target.value===''?null:Number(e.target.value))} placeholder="—" /></label>
          <label>Objectif<select value={profile.goal} onChange={e=>patch('goal',e.target.value as Profile['goal'])}>
            <option value="maintain">Stabiliser mon poids</option><option value="lose">Réduire mon poids</option><option value="gain">Augmenter mon poids</option>
          </select></label>
        </div>
        </>}
        {(!guided || step === 1) && <>
        <div className="profile-section-title"><small>02 / ALIMENTATION</small><h2>Ma façon de manger</h2></div>
        <div className="profile-form-grid">
          <label>Type d'alimentation<select value={profile.dietaryPattern} onChange={e=>patch('dietaryPattern',e.target.value as Profile['dietaryPattern'])}>
            <option value="mediterranean">Méditerranéenne</option><option value="vegetarian">Végétarienne</option><option value="vegan">Végétalienne</option><option value="other">Personnalisée</option>
          </select></label>
          <label>Nombre de repas par jour<input type="number" min="1" max="6" value={profile.mealsPerDay} onChange={e=>patch('mealsPerDay',Number(e.target.value))}/></label>
          <label className="profile-check"><input type="checkbox" checked={profile.avoidAddedSalt} onChange={e=>patch('avoidAddedSalt',e.target.checked)}/>Sans sel ajouté</label>
          <label className="profile-check"><input type="checkbox" checked={profile.avoidAddedSugar} onChange={e=>patch('avoidAddedSugar',e.target.checked)}/>Sans sucre ajouté</label>
          <label className="profile-check"><input type="checkbox" checked={profile.fastingEnabled} onChange={e=>patch('fastingEnabled',e.target.checked)}/>Je pratique le jeûne intermittent</label>
        </div>
        {profile.fastingEnabled && <div className="profile-form-grid">
          <label>Début du jeûne<input type="time" required={profile.fastingEnabled} value={profile.fastingStart??''} onChange={e=>patch('fastingStart',e.target.value||null)}/></label>
          <label>Fin du jeûne<input type="time" required={profile.fastingEnabled} value={profile.fastingEnd??''} onChange={e=>patch('fastingEnd',e.target.value||null)}/></label>
        </div>}
        </>}
        {(!guided || step === 2) && <>
        <div className="profile-section-title"><small>03 / PRÉFÉRENCES</small><h2>Mes habitudes</h2></div>
        <div className="profile-form-grid"><label>Fuseau horaire<input value={profile.timeZone} onChange={e=>patch('timeZone',e.target.value)} required/></label></div>
        <label className="profile-notes">Notes et préférences personnelles<textarea maxLength={1200} rows={4} value={profile.notes} onChange={e=>patch('notes',e.target.value)} placeholder="Mes aliments habituels, mes préférences, mes objectifs…"/></label>
        </>}
        {error && <p className="profile-feedback error" role="alert">{error}</p>}
        {message && <p className="profile-feedback" role="status">{message}</p>}
      </section>
      </fieldset>
      {guided && <div className="profile-guide-controls">
        {step > 0 && <button type="button" disabled={saving} onClick={()=>setStep(step-1)}>Retour</button>}
        <button type="button" disabled={saving} onClick={onGuideDone}>Passer la configuration</button>
      </div>}
      <button type="submit" className="profile-save profile-save-submit" disabled={saving||photoProcessing}>{photoProcessing?'Traitement de la photo…':saving?'Enregistrement…':guided && step < 2 ? 'Continuer' : 'Enregistrer mon profil'}</button>
    </form>}
  </div>
}
