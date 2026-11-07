import {emptyPersonalFood,personalFoodSnapshot,validatePersonalFood,type PersonalFood} from './personal-food.ts'
import type { ConfirmedRecipeSnapshot } from './domain/nutrition/recipe-snapshot.ts'
import {
  addFoodJournalItem, addRecipeJournalItem, cancelConfirmedMeal, confirmMeal, createJournalDay, createJournalState,
  createMeal, selectActiveMealSnapshots, type ConfirmedMealSnapshot, type JournalDayDraft,
} from './domain/nutrition/journal.ts'
import { createConfirmedRecipeSnapshot } from './domain/nutrition/recipe-snapshot.ts'
import { addRecipeIngredient, calculateRecipe, createRecipe, setRecipeServings, type RecipeDraft, type FoodNutritionSnapshot } from './domain/nutrition/recipes.ts'
import type { NutrientCode, NutrientDatum } from './domain/nutrition/types.ts'

export const fixtureUserId = '00000000-0000-4000-8000-000000000001'
const recipeId = 'fixture-recipe-bowl'
type SyntheticNutrients = {
  protein: string
  carbohydrate: string
  energyKcal?: string
  fat?: string
  fiber?: string
}
function food(fdcId: number, description: string, values: SyntheticNutrients): FoodNutritionSnapshot {
  const foodId = `usda:${fdcId}`
  const source = { sourceType: 'usda' as const, sourceName: 'NutriPerso UI fixture', sourceReference: `fixture:${fdcId}`, nutrientSourceId: 1003 }
  const datum = (code: NutrientCode,
    sourceValue: string, sourceUnit: 'kcal' | 'g', nutrientSourceId: number): NutrientDatum =>
    ({ status: 'reported', code, sourceValue, sourceUnit, basis: { amount: '100', unit: 'g', source: 'manual' },
      source: { ...source, nutrientSourceId } })
  const nutrients: NutrientDatum[] = [
    ...(values.energyKcal === undefined ? [] : [datum('energy', values.energyKcal, 'kcal', 1008)]),
    datum('protein', values.protein, 'g', 1003),
    datum('carbohydrate', values.carbohydrate, 'g', 1005),
    ...(values.fat === undefined ? [] : [datum('fat', values.fat, 'g', 1004)]),
    ...(values.fiber === undefined ? [] : [datum('fiber', values.fiber, 'g', 1079)]),
  ]
  return { foodId, sourceType: 'usda', fdcId, description, category: 'Synthétique', dataType: 'Fixture', brandOwner: null,
    sourceName: 'NutriPerso UI fixture', sourceReference: `fixture:${fdcId}`, sourceNotes: 'Valeurs synthétiques réservées à la recette UI.',
    nutrients, portionEquivalences: [], edibleYieldConversions: [] }
}
// Complete fixture for UI/meal-flow coverage: values are explicitly synthetic per 100 g.
// Energy uses legacy USDA datum 1008 so the existing selector chooses it without summing sources.
const chickpea = food(90001, 'Pois chiches (synthétique)', {
  energyKcal: '139', protein: '8.9', carbohydrate: '8', fat: '2.6', fiber: '7.6',
})
// Deliberately incomplete fixture retained to exercise unknown nutrient handling.
const couscous = food(90002, 'Couscous (synthétique)', { protein: '3.8', carbohydrate: '8' })
const personalId = '00000000-0000-4000-8000-000000090003'
const personalBase = food(90003, 'Farine personnelle (synthétique)', { energyKcal: '165', protein: '10', carbohydrate: '20', fat: '5', fiber: '3' })
export function getFixtureFoodSource(foodId: string): FoodNutritionSnapshot | null {
  if(foodId.startsWith('catalog:')){const doc=fixturePersonalFoods.get(foodId.slice(8));return doc&&!doc.archived?personalFoodSnapshot(doc):null}
  return [chickpea, couscous].find((item) => item.foodId === foodId) ?? null
}
const recipeDraft = setRecipeServings(addRecipeIngredient(createRecipe({ id: recipeId, name: 'Bol céréales & pois chiches (synthétique)' }), {
  id: 'fixture-recipe-ingredient', foodId: chickpea.foodId,
  quantity: { kind: 'physical', amount: '100', unit: 'g', weightNature: 'edible' },
}), '2')
const recipeSnapshot = createConfirmedRecipeSnapshot(recipeDraft, calculateRecipe(recipeDraft, new Map([[chickpea.foodId, chickpea]])),
  'nutrition-engine-v1-fixture', '2026-11-05T12:00:00.000Z', 'fixture-recipe-snapshot')
const fixtureRecipes = new Map<string, { draft: RecipeDraft; snapshots: ConfirmedRecipeSnapshot[] }>([[recipeId, { draft: recipeDraft, snapshots: [recipeSnapshot] }]])
// Only the opt-in synthetic UI backend persists here, never production API data.
const fixtureStorage = typeof sessionStorage !== 'undefined' && import.meta.env?.VITE_NUTRIPERSO_UI_FIXTURES === '1' ? sessionStorage : null
try { const stored = fixtureStorage?.getItem('nutrip-fixture-recipes-v1'); if (stored) for (const [id, record] of JSON.parse(stored)) fixtureRecipes.set(id, record) } catch { /* Seed remains available. */ }
function saveFixtureRecipes() { fixtureStorage?.setItem('nutrip-fixture-recipes-v1', JSON.stringify([...fixtureRecipes])) }
const seedPersonal:PersonalFood={...emptyPersonalFood(personalId),name:personalBase.description,reference:'Catalogue personnel synthétique',nutrients:{energy:{value:'165',unit:'kcal'},protein:{value:'10',unit:'g'},carbohydrate:{value:'20',unit:'g'},fat:{value:'5',unit:'g'},fiber:{value:'3',unit:'g'}}}
const fixturePersonalFoods=new Map<string,PersonalFood>([[personalId,seedPersonal]])
try{const data=fixtureStorage?.getItem('nutrip-fixture-personal-v1');if(data)for(const [id,food] of JSON.parse(data))fixturePersonalFoods.set(id,food)}catch{/* Seed remains available. */}
function saveFixturePersonal(){fixtureStorage?.setItem('nutrip-fixture-personal-v1',JSON.stringify([...fixturePersonalFoods]))}
function fixtureFoodMap(){return new Map([chickpea,couscous,...[...fixturePersonalFoods.values()].filter(f=>!f.archived).map(personalFoodSnapshot)].map(f=>[f.foodId,f]))}
function dateDaysAgo(days: number): string {
  const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()-days)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function makeSnapshot(daysAgo: number): ConfirmedMealSnapshot {
  const date=dateDaysAgo(daysAgo), dayId=`fixture-day-${daysAgo}`, mealId=`fixture-meal-${daysAgo}`
  let state=createJournalDay(createJournalState(),{id:dayId,localDate:date,timeZone:'UTC'})
  state=createMeal(state,dayId,{id:mealId,kind:daysAgo%2?'lunch':'dinner',label:daysAgo===0?'Déjeuner démo':`Repas synthétique ${daysAgo+1}`,occurredAt:`${date}T12:00:00.000Z`})
  state=addFoodJournalItem(state,dayId,mealId,{id:`fixture-food-item-${daysAgo}`,foodId:chickpea.foodId,
    quantity:{kind:'physical',amount:String(100+daysAgo),unit:'g',weightNature:'edible'},sortOrder:0})
  if(daysAgo===0) state=addRecipeJournalItem(state,dayId,mealId,{id:'fixture-recipe-item',recipeSnapshot,
    quantity:{kind:'servings',amount:'1'},sortOrder:1})
  return confirmMeal(state,dayId,mealId,{foods:fixtureFoodMap()},
    {snapshotId:`fixture-confirmed-${daysAgo}`,confirmedAt:`${date}T12:30:00.000Z`,engineVersion:'nutrition-engine-v1-fixture'}).snapshot
}
const history: ConfirmedMealSnapshot[]=Array.from({length:24},(_,i)=>makeSnapshot(i))
type FixtureTemplate={id:string;name:string;revision:number;meal:{id:string;name:string;revision:number;meal:{kind:ConfirmedMealSnapshot['mealKind'];label:string|null;items:ConfirmedMealSnapshot['items']}};createdAt:string;updatedAt:string}
const now=new Date().toISOString()
const templates:FixtureTemplate[]=[{id:'fixture-template-breakfast',name:'Bol du matin (synthétique)',revision:1,
  meal:{id:'fixture-template-meal',name:'Bol du matin (synthétique)',revision:1,meal:{kind:'breakfast',label:'Recette UI',items:history[0]!.items}},createdAt:now,updatedAt:now}]
const drafts=new Map<string,JournalDayDraft>()
try { const stored = fixtureStorage?.getItem('nutrip-fixture-journal-v1'); if (stored) { const data=JSON.parse(stored);history.splice(0,history.length,...data.history);for(const [date,day] of data.drafts)drafts.set(date,day) } } catch { /* Seed remains available. */ }
function saveFixtureJournal() { fixtureStorage?.setItem('nutrip-fixture-journal-v1',JSON.stringify({history,drafts:[...drafts]})) }

const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr')
const body=(init:RequestInit)=>JSON.parse(String(init.body??'{}')) as Record<string, any>
const defaultFixtureProfile = {
  displayName:'',avatarDataUrl:null,heightCm:null,targetWeightKg:70,goal:'lose',dietaryPattern:'mediterranean',
  mealsPerDay:3,fastingEnabled:false,fastingStart:null,fastingEnd:null,avoidAddedSalt:false,avoidAddedSugar:false,
  notes:'',timeZone:'UTC',
}
type FixtureWaist = { id: string; measuredOn: string; waistCm: number }
let fixtureProfile = defaultFixtureProfile
let fixtureWaist: FixtureWaist[] = []
try {
  fixtureProfile = JSON.parse(fixtureStorage?.getItem('nutrip-fixture-profile') ?? 'null') ?? defaultFixtureProfile
  fixtureWaist = JSON.parse(fixtureStorage?.getItem('nutrip-fixture-waist') ?? '[]')
} catch { /* Defaults stay available. */ }
export async function fixtureRequest<T>(path:string,init:RequestInit={}):Promise<T>{
  const url=new URL(path,'http://nutrip.local'),method=(init.method??'GET').toUpperCase()
  if(url.pathname==='/api/private/photos'&&method==='GET')return {photos:[]} as T
  if(url.pathname==='/api/private/measurements'&&method==='GET')return {measurements:[
    {id:'fixture-weight-3',measuredOn:'2026-11-07',weightKg:71.5,note:'Mesure de démonstration'},
    {id:'fixture-weight-2',measuredOn:'2026-11-04',weightKg:72.3,note:''},
    {id:'fixture-weight-1',measuredOn:'2026-10-20',weightKg:73.8,note:''},
  ]} as T
  if(url.pathname==='/api/private/profile'){
    if(method==='PUT'){
      fixtureProfile = JSON.parse(String(init.body))
      fixtureStorage?.setItem('nutrip-fixture-profile', JSON.stringify(fixtureProfile))
    }
    return {profile:fixtureProfile} as T
  }
  if(url.pathname==='/api/private/waist-measurements'){
    if(method==='GET')return {measurements:fixtureWaist} as T
    const { measuredOn, waistCm } = body(init)
    const measurement = { id: crypto.randomUUID(), measuredOn, waistCm }
    fixtureWaist = [measurement, ...fixtureWaist]
    fixtureStorage?.setItem('nutrip-fixture-waist', JSON.stringify(fixtureWaist))
    return {measurement} as T
  }
  if(url.pathname.startsWith('/api/private/waist-measurements/')&&method==='DELETE'){
    fixtureWaist = fixtureWaist.filter(row=>!url.pathname.endsWith('/'+row.id))
    fixtureStorage?.setItem('nutrip-fixture-waist', JSON.stringify(fixtureWaist))
    return undefined as T
  }
  if(url.pathname==='/api/private/coach'&&method==='POST')return {answer:{recorded:'Journal de démonstration',suggestions:'Préparez un plat de pois chiches et de légumes.',uncertainty:'Suggestion simulée'}} as T
  if(url.pathname==='/api/private/photo-analysis'&&method==='POST')return {proposal:{version:1,warning:'Simulation uniquement : photo ambiguë, ingrédients cachés possibles.',items:[{name:'Pois chiches',amount:'120',unit:'g',source:'USDA',uncertainty:'Estimation visuelle'},{name:'Sauce',amount:null,unit:'g',source:'Catalogue personnel',uncertainty:'Quantité inconnue'}]}} as T
  if(url.pathname==='/api/private/photo-analysis/usage')return {reservedDh:1,requests:1} as T
  if(url.pathname.startsWith('/api/private/photos/')&&method==='DELETE')return undefined as T
  if(url.pathname==='/api/foods/search'&&method==='GET'){
    const q=normalize(url.searchParams.get('q')??'')
    const foods=[chickpea,couscous].filter(food=>normalize(food.description).includes(q)).map(food=>({
      fdcId:food.fdcId,description:food.description,dataType:food.dataType,brandOwner:food.brandOwner,foodCategory:'generic',
    }))
    return {foods,totalHits:foods.length,currentPage:1,totalPages:foods.length?1:0} as T
  }
  const foodPath=/^\/api\/foods\/(\d+)$/.exec(url.pathname)
  if(foodPath&&method==='GET'){
    const food=getFixtureFoodSource(`usda:${foodPath[1]}`)
    if(!food)throw new Error('Mode recette : aliment synthétique introuvable.')
    const reported=food.nutrients.filter(datum=>datum.status==='reported')
    const nutrient=(code:string)=>{const datum=reported.find(d=>d.code===code);return datum?{
      name:datum.code,value:datum.sourceValue,unitName:datum.sourceUnit,
      basis:datum.basis?{quantity:datum.basis.amount,unit:datum.basis.unit,source:datum.basis.source}:null,
    }:null}
    return {fdcId:food.fdcId,description:food.description,dataType:food.dataType,foodCategory:food.category,brandOwner:food.brandOwner,
      nutrients:reported.map(d=>({id:d.source.nutrientSourceId,name:d.code,unitName:d.sourceUnit,value:d.sourceValue,
        basis:d.basis?{quantity:d.basis.amount,unit:d.basis.unit,source:d.basis.source}:null})),
      keyNutrients:{energy:nutrient('energy'),protein:nutrient('protein'),carbohydrates:nutrient('carbohydrate'),fat:nutrient('fat'),fiber:nutrient('fiber')},
    } as T
  }
  if(url.pathname==='/api/private/recipes'&&method==='GET')return {recipes:[...fixtureRecipes.values()].map(r=>r.draft).filter(r=>!r.archived)} as T
  if(url.pathname==='/api/private/personal-foods'&&method==='GET')return {foods:[...fixturePersonalFoods.values()].map(f=>({id:f.id,name:f.name,revision:f.revision,archived:f.archived}))} as T
  const personalPath=/^\/api\/private\/personal-foods\/([^/]+)$/.exec(url.pathname)
  if(personalPath){
    const id=decodeURIComponent(personalPath[1]!),current=fixturePersonalFoods.get(id)
    if(method==='GET'){if(!current)throw new Error('404 Fiche introuvable.');return {document:current} as T}
    if(method==='PUT'){
      const data=body(init),document=data.document as PersonalFood;validatePersonalFood(document)
      if(document.id!==id||document.archived)throw new Error('400 Fiche invalide.')
      if(current&&current.revision===Number(data.expectedRevision)+1&&JSON.stringify(current)===JSON.stringify(document))return {document:current} as T
      if(current?.archived||data.expectedRevision!==(current?.revision??0)||document.revision!==Number(data.expectedRevision)+1)throw new Error('409 Cette fiche a changé. Rechargez la version actuelle avant de réessayer.')
      fixturePersonalFoods.set(id,document);saveFixturePersonal();return {document} as T
    }
    if(method==='DELETE'){
      if(!current)throw new Error('404 Fiche introuvable.')
      if(!current.archived){if(body(init).expectedRevision!==current.revision)throw new Error('409 Cette fiche a changé.');fixturePersonalFoods.set(id,{...current,archived:true,revision:current.revision+1});saveFixturePersonal()}
      return undefined as T
    }
  }
  if(url.pathname==='/api/private/catalog'&&method==='GET')return {foods:[...fixturePersonalFoods.values()].filter(f=>!f.archived&&normalize(f.name).includes(normalize(url.searchParams.get('q')??''))).map(f=>({id:f.id,description:f.name,source_type:'custom',source_name:'Saisie personnelle',revision:f.revision}))} as T
  const catalogPath=/^\/api\/private\/catalog\/([^/]+)$/.exec(url.pathname)
  if(catalogPath&&method==='GET'){const food=getFixtureFoodSource('catalog:'+decodeURIComponent(catalogPath[1]!));if(!food)throw new Error('404 Aliment indisponible ou archivé.');return {food} as T}
  if(url.pathname==='/api/private/profile'&&method==='GET')return {profile:null} as T
  if(url.pathname==='/api/private/journal/history'&&method==='GET'){
    const q=url.searchParams.get('q')??'',from=url.searchParams.get('from')??'',to=url.searchParams.get('to')??''
    const filtered=selectActiveMealSnapshots(history).filter(m=>(!q||normalize([m.label??'',...m.items.map(i=>i.kind==='food'?i.foodSnapshot.description:i.recipeSnapshot.recipe.name)].join(' ')).includes(normalize(q)))&&(!from||m.localDate>=from)&&(!to||m.localDate<=to)).sort((a,b)=>b.localDate.localeCompare(a.localDate))
    const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||20)),offset=Math.max(0,Number(url.searchParams.get('offset'))||0)
    return {meals:filtered.slice(offset,offset+limit),total:filtered.length,limit,offset} as T
  }
  if(url.pathname==='/api/private/meal-templates'&&method==='GET')return {templates:[...templates]} as T
  const templatePath=/^\/api\/private\/meal-templates\/([^/]+)$/.exec(url.pathname)
  if(templatePath&&method==='PUT'){
    const incoming=body(init).template as any
    if(!incoming)throw new Error('Mode recette : modèle synthétique invalide.')
    const index=templates.findIndex(t=>t.id===incoming.id)
    const saved:FixtureTemplate=index<0
      ?{id:incoming.id,name:incoming.name,revision:incoming.revision,meal:incoming as FixtureTemplate['meal'],createdAt:now,updatedAt:now}
      :{...incoming,updatedAt:new Date().toISOString()}
    if(index<0)templates.unshift(saved);else templates[index]=saved
    return {template:saved} as T
  }
  if(templatePath&&method==='DELETE'){const i=templates.findIndex(t=>t.id===decodeURIComponent(templatePath[1]!));if(i>=0)templates.splice(i,1);return undefined as T}
  const recipePath=/^\/api\/private\/recipes\/([^/]+)$/.exec(url.pathname)
  if(recipePath&&method==='GET'){
    const record=fixtureRecipes.get(decodeURIComponent(recipePath[1]!)); if(!record)throw new Error('404 Recette introuvable.'); return record as T
  }
  const recipeDraftPath=/^\/api\/private\/recipes\/([^/]+)\/draft$/.exec(url.pathname)
  if(recipeDraftPath&&method==='PUT'){
    const data=body(init),draft=data.draft as RecipeDraft,id=decodeURIComponent(recipeDraftPath[1]!)
    const record=fixtureRecipes.get(id)
    if(draft.id!==id||!draft.name.trim()||data.expectedRevision!==(record?.draft.revision??0)||draft.revision!==Number(data.expectedRevision)+1)throw new Error('409 La recette a changé.')
    fixtureRecipes.set(id,{draft,snapshots:record?.snapshots??[]});saveFixtureRecipes();return {draft} as T
  }
  const recipeConfirmPath=/^\/api\/private\/recipes\/([^/]+)\/confirm$/.exec(url.pathname)
  if(recipeConfirmPath&&method==='POST'){
    const record=fixtureRecipes.get(decodeURIComponent(recipeConfirmPath[1]!)),data=body(init)
    if(!record||record.draft.archived)throw new Error('404 Recette introuvable.')
    if(data.expectedRevision!==record.draft.revision)throw new Error('409 La recette a changé.')
    const last=record.snapshots.at(-1)
    if(last?.recipe.revision===record.draft.revision)return {snapshot:last} as T
    if((last?.snapshotId??null)!==data.expectedPredecessorSnapshotId)throw new Error('409 Le prédécesseur a changé.')
    if(!record.draft.ingredients.length||!record.draft.servings)throw new Error('Ajoutez des ingrédients et des portions.')
    const calculation=calculateRecipe(record.draft,fixtureFoodMap())
    const snapshot=createConfirmedRecipeSnapshot(record.draft,calculation,'nutrition-engine-v1-fixture',new Date().toISOString())
    record.snapshots.push(snapshot);saveFixtureRecipes();return {snapshot} as T
  }
  if(recipePath&&method==='DELETE'){
    const record=fixtureRecipes.get(decodeURIComponent(recipePath[1]!))
    if(!record)throw new Error('404 Recette introuvable.')
    if(!record.draft.archived){if(body(init).expectedRevision!==record.draft.revision)throw new Error('409 La recette a changé.');record.draft={...record.draft,archived:true,revision:record.draft.revision+1};saveFixtureRecipes()}
    return undefined as T
  }
  if(url.pathname==='/api/private/journal'&&method==='GET'){
    const date=url.searchParams.get('date')??dateDaysAgo(0)
    const snapshots=history.filter(m=>m.localDate===date)
    let day=drafts.get(date)??null
    if(!day&&snapshots.length){
      const latest=snapshots.reduce((a,b)=>a.dayRevision>=b.dayRevision?a:b)
      day={...createJournalDay(createJournalState(),{id:latest.dayId,localDate:latest.localDate,timeZone:latest.timeZone}).days[0]!,
        revision:latest.dayRevision+1,meals:[]}
      drafts.set(date,day)
    }
    return {journal:day?{day,snapshots}:null} as T
  }
  if(url.pathname.endsWith('/draft')&&method==='PUT'){
    const data=body(init),draft=data.draft as JournalDayDraft,expectedRevision=Number(data.expectedRevision)
    const routeDayId=url.pathname.split('/').at(-2)
    const current=drafts.get(draft.localDate),currentRevision=current?.revision??0
    if(!draft||draft.id!==routeDayId)throw new Error('400 Identifiant de journée invalide dans la recette UI.')
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==currentRevision||draft.revision!==expectedRevision+1)
      throw new Error('409 Conflit de révision du brouillon simulé.')
    drafts.set(draft.localDate,draft);saveFixtureJournal()
    return {draft} as T
  }
  if(url.pathname.endsWith('/confirm')&&method==='POST'){
    const data=body(init),segments=url.pathname.split('/'),dayId=segments.at(-4),mealId=segments.at(-2)
    const day=[...drafts.values()].find(d=>d.id===dayId),meal=day?.meals.find(m=>m.id===mealId)
    if(!day||!meal)throw new Error('409 Brouillon de repas introuvable ou déjà confirmé dans la recette UI.')
    const retry=history.find(s=>s.snapshotId===data.snapshotId)
    if(retry){
      if(retry.logicalMealId!==mealId||retry.dayId!==dayId||retry.status!=='confirmed')throw new Error('409 Identifiant de confirmation déjà utilisé.')
      return {day,snapshot:retry} as T
    }
    const result=confirmMeal({days:[day],snapshots:history},day.id,meal.id,{foods:fixtureFoodMap()},
      {snapshotId:String(data.snapshotId),confirmedAt:String(data.confirmedAt),engineVersion:String(data.engineVersion)})
    const updated=result.state.days.find(candidate=>candidate.id===day.id)!
    drafts.set(day.localDate,updated)
    history.splice(0,history.length,...result.state.snapshots);saveFixtureJournal()
    return {day:updated,snapshot:result.snapshot} as T
  }
  const cancelPath=/^\/api\/private\/journal\/snapshots\/([^/]+)\/cancel$/.exec(url.pathname)
  if(cancelPath&&method==='POST'){
    const data=body(init),snapshotId=decodeURIComponent(cancelPath[1]!)
    const input={newSnapshotId:String(data.newSnapshotId),confirmedAt:String(data.confirmedAt),engineVersion:String(data.engineVersion)}
    const retry=history.find(s=>s.snapshotId===input.newSnapshotId)
    if(retry){
      if(retry.status!=='void'||retry.supersedesSnapshotId!==snapshotId)throw new Error('409 Identifiant d’annulation déjà utilisé.')
      const saved=drafts.get(retry.localDate)
      if(!saved)throw new Error('404 Journée de la correction introuvable dans la recette UI.')
      return {day:saved,snapshot:retry} as T
    }
    const predecessor=history.find(s=>s.snapshotId===snapshotId)
    if(!predecessor)throw new Error('404 Snapshot de repas introuvable dans la recette UI.')
    let day=drafts.get(predecessor.localDate)
    if(!day){
      day={...createJournalDay(createJournalState(),{id:predecessor.dayId,localDate:predecessor.localDate,timeZone:predecessor.timeZone}).days[0]!,
        revision:predecessor.dayRevision+1,meals:[]}
    }
    const result=cancelConfirmedMeal({days:[day],snapshots:history},snapshotId,input)
    const updated={...day,revision:day.revision+1,meals:day.meals.filter(m=>m.id!==predecessor.logicalMealId)}
    drafts.set(updated.localDate,updated)
    history.splice(0,history.length,...result.state.snapshots);saveFixtureJournal()
    return {day:updated,snapshot:result.snapshot} as T
  }
  throw new Error(`Mode recette UI : route non simulée; aucun appel réseau effectué (${method} ${url.pathname}).`)
}
