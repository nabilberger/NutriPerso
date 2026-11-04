import type {SupabaseCatalogEnv} from './supabase-catalog.ts'
import {ProfileError} from './supabase-profile.ts'

export type Measurement={id:string;measuredOn:string;weightKg:number;note:string}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function config(env:SupabaseCatalogEnv){
  if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)throw new ProfileError(503,'Suivi du poids indisponible.')
  return env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/body_measurements'
}
function headers(env:SupabaseCatalogEnv, extra:Record<string,string>={}):HeadersInit{
  return {apikey:env.SUPABASE_SECRET_KEY!,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY!,Accept:'application/json',...extra}
}
function parseRow(x:unknown):Measurement{
  if(!x||typeof x!=='object')throw new ProfileError(502,'Mesure invalide.')
  const v=x as Record<string,unknown>
  if(typeof v.id!=='string'||!UUID.test(v.id)||typeof v.measured_on!=='string')throw new ProfileError(502,'Mesure invalide.')
  const weight=Number(v.weight_kg)
  if(!Number.isFinite(weight))throw new ProfileError(502,'Mesure invalide.')
  return {id:v.id,measuredOn:v.measured_on,weightKg:weight,note:typeof v.note==='string'?v.note:''}
}
export async function listMeasurements(env:SupabaseCatalogEnv,userId:string,fetcher:typeof fetch=globalThis.fetch.bind(globalThis)):Promise<Measurement[]>{
  const url=new URL(config(env));url.searchParams.set('select','id,measured_on,weight_kg,note')
  url.searchParams.set('user_id','eq.'+userId);url.searchParams.set('order','measured_on.desc,created_at.desc');url.searchParams.set('limit','150')
  const r=await fetcher(url.toString(),{headers:headers(env),cache:'no-store'})
  if(!r.ok)throw new ProfileError(502,'Impossible de charger les mesures.')
  const rows:unknown=await r.json()
  if(!Array.isArray(rows))throw new ProfileError(502,'Mesures invalides.')
  return rows.map(parseRow)
}
export async function addMeasurement(env:SupabaseCatalogEnv,userId:string,input:unknown,fetcher:typeof fetch=globalThis.fetch.bind(globalThis)):Promise<Measurement>{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ProfileError(400,'Mesure invalide.')
  const v=input as Record<string,unknown>
  if(typeof v.measuredOn!=='string'||! /^\d{4}-\d{2}-\d{2}$/.test(v.measuredOn)||Number.isNaN(Date.parse(v.measuredOn+'T12:00:00Z'))||new Date(v.measuredOn+'T12:00:00Z').toISOString().slice(0,10)!==v.measuredOn)throw new ProfileError(400,'Date invalide.')
  if(typeof v.weightKg!=='number'||!Number.isFinite(v.weightKg)||v.weightKg<25||v.weightKg>350)throw new ProfileError(400,'Poids invalide.')
  const note=typeof v.note==='string'&&v.note.length<=300?v.note.trim():v.note===undefined?'':null
  if(note===null)throw new ProfileError(400,'Note invalide.')
  const row={id:crypto.randomUUID(),user_id:userId,measured_on:v.measuredOn,weight_kg:Math.round(v.weightKg*10)/10,note}
  const r=await fetcher(config(env),{method:'POST',headers:headers(env,{'Content-Type':'application/json',Prefer:'return=representation'}),body:JSON.stringify(row),cache:'no-store'})
  if(!r.ok)throw new ProfileError(502,'Impossible d’enregistrer la mesure.')
  const rows:unknown=await r.json()
  if(!Array.isArray(rows)||!rows[0])throw new ProfileError(502,'Confirmation invalide.')
  return parseRow(rows[0])
}
export async function deleteMeasurement(env:SupabaseCatalogEnv,userId:string,id:string,fetcher:typeof fetch=globalThis.fetch.bind(globalThis)):Promise<void>{
  if(!UUID.test(id))throw new ProfileError(400,'Identifiant de mesure invalide.')
  const url=new URL(config(env));url.searchParams.set('user_id','eq.'+userId);url.searchParams.set('id','eq.'+id)
  const r=await fetcher(url.toString(),{method:'DELETE',headers:headers(env),cache:'no-store'})
  if(!r.ok)throw new ProfileError(502,'Impossible de supprimer la mesure.')
}
