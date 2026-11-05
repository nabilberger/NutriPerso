import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldEnableUiFixtures } from '../../src/ui-fixture-mode.ts'
import { fixtureRequest } from '../../src/dev-ui-fixtures.ts'
import { missingWorkerVars } from '../../scripts/dev-stack-config.mjs'
test('fixtures require development and explicit opt-in; production stays disabled',()=>{
 assert.equal(shouldEnableUiFixtures(false,'1'),false)
 assert.equal(shouldEnableUiFixtures(true,undefined),false)
 assert.equal(shouldEnableUiFixtures(true,'true'),false)
 assert.equal(shouldEnableUiFixtures(true,'1'),true)
})
test('synthetic history exposes 20 recent meals and accent-insensitive search',async()=>{
 const page=await fixtureRequest<{meals:unknown[];total:number}>('/api/private/journal/history?limit=20')
 assert.equal(page.meals.length,20);assert.equal(page.total,24)
 const search=await fixtureRequest<{meals:Array<{label:string|null}>}>('/api/private/journal/history?q=dejeuner')
 assert.equal(search.meals.length,1);assert.equal(search.meals[0]?.label,'Déjeuner démo')
})
test('template changes are held in memory only',async()=>{
 const initial=await fixtureRequest<{templates:Array<{id:string;name:string}>}>('/api/private/meal-templates')
 assert.equal(initial.templates.length,1)
 const item=initial.templates[0]!
 const changed={id:item.id,name:'Renommé en recette',revision:2,meal:{id:item.id,name:'Renommé en recette',revision:2,meal:{kind:'breakfast',label:null,items:[]}}}
 const result=await fixtureRequest<{template:{name:string}}>('/api/private/meal-templates/'+item.id,{method:'PUT',body:JSON.stringify({template:changed,expectedRevision:1})})
 assert.equal(result.template.name,'Renommé en recette')
 await fixtureRequest<void>('/api/private/meal-templates/'+item.id,{method:'DELETE'})
 assert.equal((await fixtureRequest<{templates:unknown[]}>('/api/private/meal-templates')).templates.length,0)
})
test('unmapped fixture routes fail locally without a network fallback',async()=>{
 await assert.rejects(()=>fixtureRequest('/api/private/unmocked'),/aucun appel réseau effectué/)
})

test('connected local startup checks required variable names without printing or parsing their values',()=>{
 assert.deepEqual(missingWorkerVars(''),['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','FDC_API_KEY'])
 assert.deepEqual(missingWorkerVars('SUPABASE_URL=https://local.invalid\nSUPABASE_PUBLISHABLE_KEY=public\nSUPABASE_SECRET_KEY=private\nFDC_API_KEY=local'),[])
})
