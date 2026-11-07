import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePhotoProposal, validatePhotoData } from '../../src/photo-analysis.ts'
import { geminiPhoto } from '../src/gemini-photo.ts'
import { analyzePhoto, expirePhotos, photoRpc } from '../src/photo-service.ts'
const proposal={version:1,warning:'Estimation',items:[{name:'Riz',amount:null,unit:'g',source:'USDA',uncertainty:'Portion inconnue'}]}
test('AI proposals preserve unknown quantities and discard nutrition fields',()=>{const p=parsePhotoProposal({...proposal,calories:1234});assert.equal(p.items[0].amount,null);assert.equal('calories' in p,false)})
test('AI proposals reject malformed quantities, units and partial output',()=>{for(const patch of [{amount:'-1'},{amount:0},{unit:'cups'},{name:''}])assert.throws(()=>parsePhotoProposal({...proposal,items:[{...proposal.items[0],...patch}]}));assert.throws(()=>parsePhotoProposal({items:[]}))})
test('photo accepts bounded JPEG only',()=>{assert.equal(validatePhotoData('data:image/jpeg;base64,/9j/wAALCAABAAEBAREA/9k='),'/9j/wAALCAABAAEBAREA/9k=');for(const p of ['data:image/png;base64,AA==','data:image/jpeg;base64,AA==','x'.repeat(1400001)])assert.throws(()=>validatePhotoData(p))})
test('Gemini is server-only, configurable and cannot supply nutritional authority',async()=>{
 const ai=geminiPhoto('test-secret','gemini-test',async(url,init)=>{assert.match(String(url),/models\/gemini-test:generateContent$/);assert.equal(new Headers(init?.headers).get('x-goog-api-key'),'test-secret');assert.ok(!String(url).includes('test-secret'));return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(proposal)}]}}],usageMetadata:{totalTokenCount:42}})})
 assert.equal((await ai.analyze('/9j/')).tokens,42)
})
test('Gemini normalizes quota, truncation and ambiguous refusal',async()=>{for(const response of [new Response('',{status:429}),Response.json({candidates:[{finishReason:'MAX_TOKENS'}]}),Response.json({candidates:[]})])await assert.rejects(geminiPhoto('k','m',async()=>response).analyze('/9j/'))})
test('quota reservation precedes storage and provider; unavailable budget prevents charge',async()=>{
 let called=false
 const env={GEMINI_API_KEY:'k',GEMINI_MODEL:'m',AI_REQUEST_MAX_DH:'1',SUPABASE_URL:'https://test.invalid',SUPABASE_SECRET_KEY:'x',MEAL_PHOTOS:{put:async()=>{called=true}} as never}
 await assert.rejects(analyzePhoto(env,'user',{id:'11111111-1111-4111-8111-111111111111',photo:'data:image/jpeg;base64,/9j/wAALCAABAAEBAREA/9k='},async()=>new Response('',{status:429}),{analyze:async()=>{called=true;return {proposal:parsePhotoProposal(proposal),tokens:1}}}))
 assert.equal(called,false)
})
test('private storage is user scoped and has 30-day expiry; provider has no journal access',async()=>{
 const events:string[]=[];let expiry=0
 const env={GEMINI_API_KEY:'k',GEMINI_MODEL:'m',AI_REQUEST_MAX_DH:'1',SUPABASE_URL:'https://test.invalid',SUPABASE_SECRET_KEY:'x',MEAL_PHOTOS:{put:async(key:string,_:unknown,options:{customMetadata:{expires:string}})=>{assert.match(key,/^user\//);expiry=Number(options.customMetadata.expires);events.push('store')}} as never}
 const result=await analyzePhoto(env,'user',{id:'11111111-1111-4111-8111-111111111111',photo:'data:image/jpeg;base64,/9j/wAALCAABAAEBAREA/9k='},async(url)=>{events.push(String(url).split('/').pop()!);return new Response(null,{status:204})},{analyze:async()=>{events.push('provider');return {proposal:parsePhotoProposal(proposal),tokens:1}}})
 assert.deepEqual(events,['reserve_photo_analysis','store','provider','finish_photo_analysis']);assert.ok(Math.abs(expiry-Date.now()-30*86400000)<1000);assert.equal(result.proposal.items[0].amount,null)
})
test('retention deletes expired private objects across pagination only',async()=>{const removed:string[]=[];let n=0;await expirePhotos({MEAL_PHOTOS:{list:async()=>++n===1?{objects:[{key:'old',customMetadata:{expires:'1'}}],truncated:true,cursor:'next'}:{objects:[{key:'new',customMetadata:{expires:String(Date.now()+10000)}}],truncated:false},delete:async(k:string)=>{removed.push(k)}} as never});assert.deepEqual(removed,['old']);assert.equal(n,2)})

test('photo routes require Auth; deletion never trusts frontend user identity',async()=>{
 const {createWorkerApp}=await import('../src/index.ts')
 const removed:string[]=[]
 const env={SUPABASE_URL:'https://test.invalid',SUPABASE_PUBLISHABLE_KEY:'test',MEAL_PHOTOS:{delete:async(key:string)=>{removed.push(key)}} as never}
 const app=createWorkerApp({fetcher:async()=>Response.json({id:'11111111-1111-4111-8111-111111111111',is_anonymous:false})})
 assert.equal((await app.request('/api/private/photo-analysis',{method:'POST'},env)).status,401)
 const r=await app.request('/api/private/photos/22222222-2222-4222-8222-222222222222',{method:'DELETE',headers:{Authorization:'Bearer e30.e30.sig'},body:JSON.stringify({userId:'victim'})},env)
 assert.equal(r.status,204);assert.deepEqual(removed,['11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg'])
})
test('provider schema errors and timeouts leave no partial proposal',async()=>{
 for(const fetcher of [async()=>{throw new Error('timeout')},async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"version":1,"items":[{}],"warning":""}'}]}}]})])await assert.rejects(geminiPhoto('key','model',fetcher).analyze(''))
})
test('server rejects oversized dimensions before provider or quota',()=>{
 const bytes=Buffer.from('ffd8ffc0000b080001100101011100ffd9','hex')
 assert.throws(()=>validatePhotoData('data:image/jpeg;base64,'+bytes.toString('base64')),/Dimensions/)
})
test('local retention preserves queued analysis and all nutrition data',async()=>{
 const {expireLocalPhotos}=await import('../../src/photo-retention.ts')
 const values:Record<string,string>={day:JSON.stringify({photoDataUrl:'photo',day:{id:'unchanged'}}),'nutrip-photo-expiry:day':'1'}
 const storage={...values,getItem:(k:string)=>values[k]??null,setItem:(k:string,v:string)=>{values[k]=v},removeItem:(k:string)=>{delete values[k]}} as unknown as Storage
 values['nutrip-photo-v1:day']=JSON.stringify({pending:true})
 expireLocalPhotos(storage,2);assert.equal(JSON.parse(values.day).photoDataUrl,'photo')
 values['nutrip-photo-v1:day']=JSON.stringify({pending:false})
 expireLocalPhotos(storage,2);assert.equal(JSON.parse(values.day).photoDataUrl,null);assert.equal(JSON.parse(values.day).day.id,'unchanged')
})


const rpcTestEnv = { SUPABASE_URL: 'https://supabase.test.invalid', SUPABASE_SECRET_KEY: 'test-only' }

test('photo RPC accepts successful HTTP 204 without decoding JSON', async () => {
  assert.equal(await photoRpc(rpcTestEnv, 'reserve_photo_analysis', {}, async () => new Response(null, { status: 204 })), undefined)
})

test('photo RPC accepts successful empty and whitespace response bodies', async () => {
  for (const body of ['', '  \n\t']) {
    assert.equal(await photoRpc(rpcTestEnv, 'finish_photo_analysis', {}, async () => new Response(body, { status: 200 })), undefined)
  }
})

test('photo RPC still decodes valid JSON data and JSON null', async () => {
  for (const data of [{ reservedDh: 0.1, requests: 1, tokens: 42 }, null]) {
    assert.deepEqual(await photoRpc(rpcTestEnv, 'photo_analysis_usage', {}, async () => Response.json(data)), data)
  }
})

test('photo RPC rejects HTTP errors before attempting body decoding', async () => {
  for (const [status, body] of [[400, ''], [429, 'private upstream details'], [503, '{"error":"sensitive"}']] as const) {
    await assert.rejects(photoRpc(rpcTestEnv, 'reserve_photo_analysis', {}, async () => new Response(body, { status })), {
      message: 'Budget IA indisponible ou limite atteinte. La saisie manuelle reste disponible.',
    })
  }
})

test('photo RPC rejects malformed nonempty JSON instead of accepting an empty result', async () => {
  await assert.rejects(photoRpc(rpcTestEnv, 'photo_analysis_usage', {}, async () => new Response('{invalid', { status: 200 })), SyntaxError)
})
