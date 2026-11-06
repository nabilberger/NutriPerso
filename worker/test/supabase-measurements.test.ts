import test from 'node:test'
import assert from 'node:assert/strict'
import {listMeasurements,addMeasurement,deleteMeasurement} from '../src/supabase-measurements.ts'
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'test-secret'}
const userId='441c9076-c5fd-4937-b980-dbc0c84a3cbc'
const measurement={id:'b6356903-3b48-4f0e-8469-23b792ca1649',measured_on:'2026-11-04',weight_kg:'75.1',note:''}
function reply(value:unknown){return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}})}
test('weight history is scoped to the authenticated identity',async()=>{
  const rows=await listMeasurements(env,userId,async (url,init)=>{
    assert.equal(new URL(String(url)).searchParams.get('user_id'),'eq.'+userId)
    assert.equal((init?.headers as Record<string,string>).apikey,env.SUPABASE_SECRET_KEY)
    return reply([measurement])
  })
  assert.deepEqual(rows,[{id:measurement.id,measuredOn:'2026-11-04',weightKg:75.1,note:''}])
})
test('weight entry is validated and assigned to the authenticated identity',async()=>{
  const saved=await addMeasurement(env,userId,{measuredOn:'2026-11-04',weightKg:75.16,note:''},async (_url,init)=>{
    const body=JSON.parse(String(init?.body))
    assert.equal(body.user_id,userId)
    assert.equal(body.weight_kg,75.2)
    assert.ok(typeof body.id==='string')
    return reply([measurement])
  })
  assert.equal(saved.weightKg,75.1)
  let called=false
  await assert.rejects(addMeasurement(env,userId,{measuredOn:'2026-02-30',weightKg:75},async()=>{called=true;return reply([])}))
  assert.equal(called,false)
})
test('deletion includes both item id and authenticated user scope',async()=>{
  await deleteMeasurement(env,userId,measurement.id,async(url,init)=>{
    const u=new URL(String(url));assert.equal(u.searchParams.get('user_id'),'eq.'+userId)
    assert.equal(u.searchParams.get('id'),'eq.'+measurement.id)
    assert.equal(init?.method,'DELETE')
    return new Response(null,{status:204})
  })
})
