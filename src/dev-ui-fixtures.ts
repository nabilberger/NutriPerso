import {
  addFoodJournalItem, addRecipeJournalItem, confirmMeal, createJournalDay, createJournalState,
  createMeal, type ConfirmedMealSnapshot, type JournalDayDraft,
} from './domain/nutrition/journal.ts'
import { createConfirmedRecipeSnapshot } from './domain/nutrition/recipe-snapshot.ts'
import { addRecipeIngredient, calculateRecipe, createRecipe, setRecipeServings, type FoodNutritionSnapshot } from './domain/nutrition/recipes.ts'
import type { NutrientDatum } from './domain/nutrition/types.ts'

export const fixtureUserId = '00000000-0000-4000-8000-000000000001'
const recipeId = 'fixture-recipe-bowl'
function food(fdcId: number, description: string, protein: string): FoodNutritionSnapshot {
  const foodId = `usda:${fdcId}`
  const source = { sourceType: 'usda' as const, sourceName: 'NutriPerso UI fixture', sourceReference: `fixture:${fdcId}`, nutrientSourceId: 1003 }
  const nutrients: NutrientDatum[] = [
    { status: 'reported', code: 'protein', sourceValue: protein, sourceUnit: 'g', basis: { amount: '100', unit: 'g', source: 'manual' }, source },
    { status: 'reported', code: 'carbohydrate', sourceValue: '8', sourceUnit: 'g', basis: { amount: '100', unit: 'g', source: 'manual' }, source: { ...source, nutrientSourceId: 1005 } },
  ]
  return { foodId, sourceType: 'usda', fdcId, description, category: 'Synthétique', dataType: 'Fixture', brandOwner: null,
    sourceName: 'NutriPerso UI fixture', sourceReference: `fixture:${fdcId}`, sourceNotes: 'Valeurs synthétiques réservées à la recette UI.',
    nutrients, portionEquivalences: [], edibleYieldConversions: [] }
}
const chickpea = food(90001, 'Pois chiches (synthétique)', '8.9')
const couscous = food(90002, 'Couscous (synthétique)', '3.8')
export function getFixtureFoodSource(foodId: string): FoodNutritionSnapshot | null {
  return [chickpea, couscous].find((item) => item.foodId === foodId) ?? null
}
const recipeDraft = setRecipeServings(addRecipeIngredient(createRecipe({ id: recipeId, name: 'Bol céréales & pois chiches (synthétique)' }), {
  id: 'fixture-recipe-ingredient', foodId: chickpea.foodId,
  quantity: { kind: 'physical', amount: '100', unit: 'g', weightNature: 'edible' },
}), '2')
const recipeSnapshot = createConfirmedRecipeSnapshot(recipeDraft, calculateRecipe(recipeDraft, new Map([[chickpea.foodId, chickpea]])),
  'nutrition-engine-v1-fixture', '2026-11-05T12:00:00.000Z', 'fixture-recipe-snapshot')
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
  return confirmMeal(state,dayId,mealId,{foods:new Map([[chickpea.foodId,chickpea],[couscous.foodId,couscous]])},
    {snapshotId:`fixture-confirmed-${daysAgo}`,confirmedAt:`${date}T12:30:00.000Z`,engineVersion:'nutrition-engine-v1-fixture'}).snapshot
}
const history: ConfirmedMealSnapshot[]=Array.from({length:24},(_,i)=>makeSnapshot(i))
type FixtureTemplate={id:string;name:string;revision:number;meal:{id:string;name:string;revision:number;meal:{kind:ConfirmedMealSnapshot['mealKind'];label:string|null;items:ConfirmedMealSnapshot['items']}};createdAt:string;updatedAt:string}
const now=new Date().toISOString()
const templates:FixtureTemplate[]=[{id:'fixture-template-breakfast',name:'Bol du matin (synthétique)',revision:1,
  meal:{id:'fixture-template-meal',name:'Bol du matin (synthétique)',revision:1,meal:{kind:'breakfast',label:'Recette UI',items:history[0]!.items}},createdAt:now,updatedAt:now}]
const drafts=new Map<string,JournalDayDraft>()
const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr')
const body=(init:RequestInit)=>JSON.parse(String(init.body??'{}')) as Record<string, any>
export async function fixtureRequest<T>(path:string,init:RequestInit={}):Promise<T>{
  const url=new URL(path,'http://nutrip.local'),method=(init.method??'GET').toUpperCase()
  if(url.pathname==='/api/private/profile'&&method==='GET')return {profile:null} as T
  if(url.pathname==='/api/private/journal/history'&&method==='GET'){
    const q=url.searchParams.get('q')??'',from=url.searchParams.get('from')??'',to=url.searchParams.get('to')??''
    const filtered=history.filter(m=>m.status==='confirmed'&&(!q||normalize([m.label??'',...m.items.map(i=>i.kind==='food'?i.foodSnapshot.description:i.recipeSnapshot.recipe.name)].join(' ')).includes(normalize(q)))&&(!from||m.localDate>=from)&&(!to||m.localDate<=to)).sort((a,b)=>b.localDate.localeCompare(a.localDate))
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
  if(recipePath&&method==='GET'&&decodeURIComponent(recipePath[1]!)===recipeId)return {snapshots:[recipeSnapshot]} as T
  if(url.pathname==='/api/private/journal'&&method==='GET'){
    const date=url.searchParams.get('date')??dateDaysAgo(0)
    return {journal:{day:drafts.get(date)??null,snapshots:history.filter(m=>m.localDate===date)}} as T
  }
  if(url.pathname.endsWith('/draft')&&method==='PUT'){const draft=body(init).draft as JournalDayDraft;drafts.set(draft.localDate,draft);return {draft} as T}
  if(url.pathname.endsWith('/confirm')&&method==='POST'){
    const data=body(init),segments=url.pathname.split('/'),dayId=segments.at(-4),mealId=segments.at(-2),day=[...drafts.values()].find(d=>d.id===dayId),meal=day?.meals.find(m=>m.id===mealId)
    if(!day||!meal)throw new Error('Mode recette : repas de démonstration introuvable.')
    const result=confirmMeal({days:[day],snapshots:history},day.id,meal.id,{foods:new Map([[chickpea.foodId,chickpea],[couscous.foodId,couscous]])},
      {snapshotId:String(data.snapshotId),confirmedAt:String(data.confirmedAt),engineVersion:String(data.engineVersion)})
    const updated={...day,revision:day.revision+1,meals:day.meals.filter(m=>m.id!==meal.id)}
    drafts.set(day.localDate,updated);history.unshift(result.snapshot);return {day:updated,snapshot:result.snapshot} as T
  }
  throw new Error(`Mode recette UI : route non simulée; aucun appel réseau effectué (${method} ${url.pathname}).`)
}
