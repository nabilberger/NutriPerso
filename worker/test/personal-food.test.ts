import {getPersonalFood,listPersonalFoods} from '../src/personal-foods.ts'
import {PrivateApiError} from '../../src/auth/private-json-response.ts'
import {loadFoodSources,mergeLoadedFoodSources} from '../../src/journal-sources.ts'
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {emptyPersonalFood,personalFoodSnapshot,validatePersonalFood,withFoodIdentity,type PersonalFood} from '../../src/personal-food.ts'
import {calculateFoodSnapshot,calculateRecipe,createRecipe,addRecipeIngredient} from '../../src/domain/nutrition/recipes.ts'
import {aggregateNutrients} from '../../src/domain/nutrition/aggregate-nutrients.ts'
import {NUTRIENT_CODES} from '../../src/domain/nutrition/types.ts'
import {createConfirmedRecipeSnapshot} from '../../src/domain/nutrition/recipe-snapshot.ts'
import {addFoodJournalItem,confirmMeal,createJournalDay,createJournalState,createMeal} from '../../src/domain/nutrition/journal.ts'
import {createWorkerApp} from '../src/index.ts'
const id='60000000-0000-4000-8000-000000000001',owner='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002'
function doc():PersonalFood{return {...emptyPersonalFood(id),name:'Purée maison',reference:'Mesure personnelle',nutrients:{energy:{value:'120.123456789012345678',unit:'kcal'},protein:{value:'0',unit:'g'},carbohydrate:{value:null,unit:'g'},fat:{value:'5',unit:'g'},fiber:{value:'2',unit:'g'}},portions:[{id:'spoon',label:'Cuillère',unit:'tablespoon',amount:'15.5',basis:'g'}]}}
function totals(food:ReturnType<typeof personalFoodSnapshot>,quantity:Parameters<typeof calculateFoodSnapshot>[1]){return aggregateNutrients([{itemId:'i',nutrients:calculateFoodSnapshot(food,quantity).contributions}],NUTRIENT_CODES,{includeExact:true})}
test('personal values remain exact, zero differs from unknown, portions and aliases use the existing engine',()=>{
 const food=personalFoodSnapshot(doc()),all=totals(food,{kind:'physical',amount:'100',unit:'g',weightNature:'edible'})
 assert.equal(all.energy?.status,'complete');assert.equal(all.protein?.status,'complete');assert.equal(all.carbohydrate?.status,'unknown')
 if(all.energy?.status==='complete')assert.deepEqual(all.energy.exactValue,{numerator:'60061728394506172839',denominator:'500000000000000000'})
 if(all.protein?.status==='complete')assert.equal(all.protein.value,'0.000000')
 const serving=totals(food,{kind:'serving',amount:'2',unit:'tablespoon',equivalenceId:'spoon'})
 if(serving.fat?.status==='complete')assert.equal(serving.fat.value,'1.550000');else assert.fail('Missing fat contribution')
 const alias=withFoodIdentity(food,id)
 assert.equal(totals(alias,{kind:'serving',amount:'2',unit:'tablespoon',equivalenceId:'spoon'}).fat?.status,'complete')
})
test('volume units and unknown equivalences never invent conversions or zero',()=>{
 const document=doc();document.basis='ml';document.nutrients.energy={value:'418.4',unit:'kJ'};document.portions=[{id:'glass',unit:'custom',label:'Verre',amount:'200',basis:'ml'},{id:'unknown',unit:'piece',label:'Pièce',amount:null,basis:'g'}]
 const food=personalFoodSnapshot(document)
 const glass=totals(food,{kind:'serving',amount:'0.5',unit:'custom',equivalenceId:'glass'})
 if(glass.energy?.status==='complete')assert.equal(glass.energy.value,'100.000000');else assert.fail('Missing energy')
 assert.equal(totals(food,{kind:'physical',amount:'100',unit:'g',weightNature:'edible'}).energy?.status,'unknown')
 assert.equal(totals(food,{kind:'serving',amount:'1',unit:'piece',equivalenceId:'unknown'}).energy?.status,'unknown')
})
test('personal validation rejects invalid values, missing fields, duplicate portions and unsafe quantities',()=>{
 for(const value of ['-1','1,5','NaN','1e5','']){const food=doc();food.nutrients.energy.value=value;assert.throws(()=>validatePersonalFood(food))}
 for(const amount of ['0','-1','1000001']){const food=doc();food.portions[0]!.amount=amount;assert.throws(()=>validatePersonalFood(food))}
 const repeated=doc();repeated.portions.push({...repeated.portions[0]!});assert.throws(()=>validatePersonalFood(repeated))
 assert.throws(()=>validatePersonalFood({...doc(),name:''}));assert.throws(()=>validatePersonalFood({...doc(),nutrients:{}}))
})
test('food edits and archive leave confirmed meal and recipe snapshots fully immutable',()=>{
 const first=doc(),food=personalFoodSnapshot(first),foods=new Map([[food.foodId,food]])
 const recipe=addRecipeIngredient(createRecipe({id:'recipe',name:'Préparation'}),{id:'ingredient',foodId:food.foodId,quantity:{kind:'serving',amount:'2',unit:'tablespoon',equivalenceId:'spoon'}})
 const snapshot=createConfirmedRecipeSnapshot(recipe,calculateRecipe(recipe,foods),'v1','2026-11-06T12:00:00Z')
 let state=createMeal(createJournalDay(createJournalState(),{id:'day',localDate:'2026-11-06',timeZone:'UTC'}),'day',{id:'meal',kind:'lunch'})
 state=addFoodJournalItem(state,'day','meal',{id:'item',foodId:food.foodId,sortOrder:0,quantity:{kind:'serving',amount:'1',unit:'tablespoon',equivalenceId:'spoon'}})
 const confirmed=confirmMeal(state,'day','meal',{foods},{snapshotId:'meal-s1',confirmedAt:'2026-11-06T12:00:00Z',engineVersion:'v1'})
 const before=JSON.stringify({snapshot,meal:confirmed.snapshot})
 const edited=doc();edited.revision=2;edited.nutrients.energy.value='500';edited.portions[0]!.amount='30';personalFoodSnapshot(edited);edited.archived=true
 assert.equal(JSON.stringify({snapshot,meal:confirmed.snapshot}),before)
 assert.equal(snapshot.ingredients[0]!.equivalenceSnapshot?.version,1)
 assert.equal(personalFoodSnapshot(edited).portionEquivalences[0]!.version,2)
})
function backend(){
 const rows=new Map<string,any>(),requests:URL[]=[]
 const fetcher:typeof fetch=async(input,init={})=>{
  const url=new URL(input instanceof Request?input.url:String(input));requests.push(url)
  if(url.pathname.endsWith('/auth/v1/user'))return Response.json({id:new Headers(init.headers).get('Authorization')?.endsWith('.other')?other:owner,is_anonymous:false})
  assert.equal(new Headers(init.headers).get('apikey'),'test-secret')
  if(url.pathname.endsWith('/rpc/save_personal_food')){
   const b=JSON.parse(String(init.body)),current=rows.get(b.p_food_id)
   if(current&&(current.user_id!==b.p_user_id||current.archived))return Response.json({message:'PERSONAL_FOOD_OWNER',code:'40001'},{status:409})
   if(current?.revision===b.p_expected_revision+1&&JSON.stringify(current.personal_document)===JSON.stringify(b.p_document))return Response.json([current])
   if((current?.revision??0)!==b.p_expected_revision)return Response.json({message:'PERSONAL_FOOD_CONFLICT',code:'40001'},{status:409})
   const row={id:b.p_food_id,user_id:b.p_user_id,revision:b.p_document.revision,archived:false,personal_document:b.p_document,description:b.p_document.name,source_type:'custom',fdc_id:null,category:null,data_type:null,brand_owner:null,source_name:'Personnel',source_reference:null,source_notes:null,imported_at:null}
   rows.set(row.id,row);return Response.json([row])
  }
  if(url.pathname.endsWith('/rpc/archive_personal_food')){
   const b=JSON.parse(String(init.body)),current=rows.get(b.p_food_id)
   if(!current||current.user_id!==b.p_user_id)return Response.json([])
   if(!current.archived){if(current.revision!==b.p_expected_revision)return Response.json({message:'PERSONAL_FOOD_CONFLICT'},{status:409});current.archived=true;current.revision++;current.personal_document={...current.personal_document,archived:true,revision:current.revision}}
   return Response.json([current])
  }
  if(url.pathname.endsWith('/foods')){
   const requested=url.searchParams.get('id')?.replace('eq.',''),uid=url.searchParams.get('user_id')?.replace('eq.','')
   let result=[...rows.values()].filter(r=>(!requested||r.id===requested)&&(!uid||uid==='is.null'||r.user_id===uid))
   if(url.searchParams.get('archived')==='eq.false')result=result.filter(r=>!r.archived)
   return Response.json(result)
  }
  if(url.pathname.endsWith('/food_nutrients'))return Response.json([])
  throw new Error('Unexpected '+url)
 }
 const app=createWorkerApp({fetcher}),env={SUPABASE_URL:'https://personal.test',SUPABASE_SECRET_KEY:'test-secret',SUPABASE_PUBLISHABLE_KEY:'test-publishable'}
 const call=(path:string,method='GET',body?:unknown,token='owner')=>app.request('/api/private'+path,{method,headers:{Authorization:'Bearer e30.e30.'+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},env)
 return {call,rows,requests}
}
test('personal API CRUD, reload, ownership, archive and retries preserve the version contract',async()=>{
 const {call,rows}=backend()
 assert.equal((await call('/personal-foods/'+id,'PUT',{document:doc(),expectedRevision:0})).status,200)
 assert.equal((await call('/personal-foods/'+id,'PUT',{document:doc(),expectedRevision:0})).status,200)
 assert.equal(rows.size,1)
 assert.equal((await (await call('/personal-foods/'+id)).json() as {document:PersonalFood}).document.nutrients.protein.value,'0')
 assert.equal((await call('/personal-foods/'+id,'GET',undefined,'other')).status,404)
 assert.equal((await call('/personal-foods/'+id,'DELETE',{expectedRevision:1},'other')).status,404)
 assert.equal((await call('/personal-foods/'+id,'PUT',{document:{...doc(),revision:2},expectedRevision:1},'other')).status,409)
 assert.equal((await call('/personal-foods/'+id,'PUT',{document:{...doc(),revision:2},expectedRevision:1})).status,200)
 assert.equal((await call('/personal-foods/'+id,'PUT',{document:{...doc(),revision:2,name:'stale'},expectedRevision:1})).status,409)
 assert.equal((await call('/personal-foods/'+id,'DELETE',{expectedRevision:1})).status,409)
 assert.equal((await call('/personal-foods/'+id,'DELETE',{expectedRevision:2})).status,204)
 assert.equal((await call('/personal-foods/'+id,'DELETE',{expectedRevision:2})).status,204)
 assert.equal((await call('/catalog/'+id)).status,404)
 assert.equal((await (await call('/personal-foods/'+id)).json() as {document:PersonalFood}).document.archived,true)
})
test('catalogue lookup never exposes an owned food to another user or an archived food to a picker',async()=>{
 const {call}=backend();await call('/personal-foods/'+id,'PUT',{document:doc(),expectedRevision:0})
 assert.equal((await call('/catalog/'+id,'GET',undefined,'other')).status,404)
 assert.deepEqual(await (await call('/catalog?q=maison','GET',undefined,'other')).json(),{foods:[]})
 assert.equal((await call('/catalog/'+id)).status,200)
 await call('/personal-foods/'+id,'DELETE',{expectedRevision:1})
 assert.deepEqual(await (await call('/catalog?q=maison')).json(),{foods:[]})
})
test('new personal endpoints reject unauthenticated calls, client identities, invalid units and malformed records',async()=>{
 const {call,rows}=backend()
 assert.equal((await call('/personal-foods/'+id,'PUT',{document:{...doc(),user_id:other},expectedRevision:0})).status,403)
 assert.equal((await call('/personal-foods/'+id,'PUT',{document:{...doc(),nutrients:{}},expectedRevision:0})).status,400)
 const invalid=doc();invalid.nutrients.energy.unit='g';assert.equal((await call('/personal-foods/'+id,'PUT',{document:invalid,expectedRevision:0})).status,400)
 assert.equal(rows.size,0)
 const app=createWorkerApp();for(const method of ['GET','PUT','DELETE'])assert.equal((await app.request('/api/private/personal-foods/'+id,{method})).status,401)
})

test('personal draft sources refresh current values, preserve cache during network failures and ignore late dates',async()=>{
 const first=personalFoodSnapshot(doc()),changed=doc();changed.revision=2;changed.nutrients.energy.value='200'
 const cached={[first.foodId]:first}
 let state=createMeal(createJournalDay(createJournalState(),{id:'day',localDate:'2026-11-06',timeZone:'UTC'}),'day',{id:'meal',kind:'lunch'})
 state=addFoodJournalItem(state,'day','meal',{id:'i',foodId:first.foodId,sortOrder:0,quantity:{kind:'physical',amount:'100',unit:'g',weightNature:'edible'}})
 const day=state.days[0]!
 assert.equal((await loadFoodSources(day,cached,()=>true,fetch,async()=>personalFoodSnapshot(changed)))[first.foodId]!.nutrients[0]!.status,'reported')
 assert.deepEqual((await loadFoodSources(day,cached,()=>true,fetch,async()=>{throw new Error('offline')}))[first.foodId],first)
 assert.equal(await loadFoodSources(day,cached,()=>false,fetch,async()=>personalFoodSnapshot(changed)),cached)
 const archived=await loadFoodSources(day,cached,()=>true,fetch,async()=>{throw new PrivateApiError(404,'Aliment introuvable.')})
 assert.equal(archived[first.foodId]!.description,first.description)
 assert.equal(totals(archived[first.foodId]!,{kind:'physical',amount:'100',unit:'g',weightNature:'edible'}).energy?.status,'unknown')
})

test('a delayed catalogue refresh cannot overwrite a source selected more recently or remove a new selection',()=>{
 const old=personalFoodSnapshot(doc()),edited=doc();edited.revision=2;edited.nutrients.energy.value='300'
 const newest=personalFoodSnapshot(edited),added={...newest,foodId:'another'}
 const merged=mergeLoadedFoodSources({[old.foodId]:old},{[old.foodId]:newest,another:added},{[old.foodId]:old})
 assert.equal(merged[old.foodId],newest);assert.equal(merged.another,added)
})

test('legacy personal sheets preserve exact decimal text and normalize existing catalogue aliases',async()=>{
 const fetcher:typeof fetch=async input=>String(input).includes('food_nutrients')
 ? new Response('[{"nutrient_code":"name:protein:g","fdc_nutrient_id":null,"value":1.234567890123456789,"unit":"G","reference_quantity":100.0,"reference_unit":"g"}]',{headers:{'content-type':'application/json'}})
 : Response.json([{id,user_id:owner,revision:1,archived:false,personal_document:null,description:'Legacy',category:null,source_reference:'Original',source_notes:null}])
 const value=await getPersonalFood({SUPABASE_URL:'https://personal.test',SUPABASE_SECRET_KEY:'test'},owner,id,fetcher)
 assert.equal(value?.nutrients.protein.value,'1.234567890123456789')
 assert.equal(value?.nutrients.protein.unit,'g')
 assert.equal(value?.nutrients.fiber.value,null)
})

test('personal management lists every page instead of silently truncating at 200 entries',async()=>{
 const offsets:number[]=[]
 const fetcher:typeof fetch=async input=>{
  const offset=Number(new URL(String(input)).searchParams.get('offset'));offsets.push(offset)
  return Response.json(Array.from({length:offset===0?200:1},(_,index)=>({id:'food-'+(offset+index),user_id:owner,revision:1,archived:false,description:'Food '+(offset+index)})))
 }
 const foods=await listPersonalFoods({SUPABASE_URL:'https://personal.test',SUPABASE_SECRET_KEY:'test'},owner,fetcher)
 assert.equal(foods.length,201);assert.deepEqual(offsets,[0,200]);assert.equal(foods[200]!.name,'Food 200')
})
