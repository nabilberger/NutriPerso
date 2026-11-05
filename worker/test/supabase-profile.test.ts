import test from 'node:test'
import assert from 'node:assert/strict'
import { getProfile, saveProfile, ProfileError } from '../src/supabase-profile.ts'

const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'service-test-only'}
const userId='441c9076-c5fd-4937-b980-dbc0c84a3cbc'
const sample={
  displayName:'Mon profil',avatarDataUrl:null,heightCm:176,targetWeightKg:75,goal:'maintain',
  dietaryPattern:'mediterranean',mealsPerDay:2,fastingEnabled:true,fastingStart:'20:00',fastingEnd:'12:00',
  avoidAddedSalt:true,avoidAddedSugar:true,notes:'Cuisine maison',timeZone:'Africa/Casablanca',
} as const
function response(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}})}
function row(){return {user_id:userId,display_name:sample.displayName,avatar_data_url:null,height_cm:'176.0',target_weight_kg:'75.0',
goal:'maintain',dietary_pattern:'mediterranean',meals_per_day:2,fasting_enabled:true,fasting_start:'20:00:00',fasting_end:'12:00:00',
avoid_added_salt:true,avoid_added_sugar:true,notes:'Cuisine maison',time_zone:'Africa/Casablanca'}}
test('new users receive safe defaults without creating any row',async()=>{
  const profile=await getProfile(env,userId,async(input,init)=>{
    assert.match(String(input),new RegExp('user_id=eq.'+userId))
    assert.equal(init?.method,undefined)
    return response([])
  })
  assert.equal(profile.mealsPerDay,2);assert.equal(profile.targetWeightKg,null)
})
test('profile writes have server-derived owner, on-conflict upsert and the expected fields',async()=>{
  const saved=await saveProfile(env,userId,sample,async(input,init)=>{
    assert.match(String(input),/on_conflict=user_id/)
    const p=JSON.parse(String(init?.body))
    assert.equal(p.user_id,userId)
    assert.equal(p.target_weight_kg,75)
    assert.equal(p.dietary_pattern,'mediterranean')
    assert.equal((init?.headers as Record<string,string>).Prefer,'resolution=merge-duplicates,return=representation')
    return response([row()])
  })
  assert.equal(saved.displayName,sample.displayName)
  assert.equal(saved.fastingStart,'20:00')
})
test('profile rejects invalid preferences before remote request',async()=>{
  let called=false
  const fetcher=async()=>{called=true;return response([])}
  await assert.rejects(saveProfile(env,userId,{...sample,mealsPerDay:0},fetcher),ProfileError)
  await assert.rejects(saveProfile(env,userId,{...sample,avatarDataUrl:'data:image/svg+xml;base64,dGVzdA=='},fetcher),ProfileError)
  await assert.rejects(saveProfile(env,userId,{...sample,timeZone:'invalid_zone'},fetcher),ProfileError)
  await assert.rejects(saveProfile(env,userId,{...sample,fastingStart:null},fetcher),ProfileError)
  await assert.rejects(saveProfile(env,userId,{...sample,fastingEnabled:true,fastingEnd:null},fetcher),ProfileError)
  assert.equal(called,false)
})
