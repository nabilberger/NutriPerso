import {useState,useEffect} from 'react'
import {formatTotal} from './nutrition-presentation'
import {requestPrivateJson} from './auth/client'
import {loadRecipeFood} from './recipe-foods'
import {calculateFoodSnapshot,type FoodNutritionSnapshot} from './domain/nutrition/recipes'
import {aggregateNutrients} from './domain/nutrition/aggregate-nutrients'
import type {FoodQuantityInput} from './domain/nutrition/portions'
import type {CatalogEntry} from './catalog-nutrition'
import FoodQuantityEditor from './FoodQuantityEditor'
const labels=[['energy','Calories','kcal'],['protein','Protéines','g'],['carbohydrate','Glucides','g'],['fat','Lipides','g'],['fiber','Fibres','g']] as const
export function referenceQuantity(food: FoodNutritionSnapshot): FoodQuantityInput {
  const datum = food.nutrients.find(d => d.status === 'reported' && d.basis)
  return datum?.status === 'reported' && datum.basis?.unit === 'ml'
    ? { kind: 'physical', amount: '100', unit: 'ml', weightNature: 'not-applicable' }
    : { kind: 'physical', amount: '100', unit: 'g', weightNature: 'edible' }
}
export function NutritionValues({ food }: { food: FoodNutritionSnapshot }) {
  const result = calculateFoodSnapshot(food, referenceQuantity(food))
  const totals = aggregateNutrients([{ itemId: food.foodId, nutrients: result.contributions }], labels.map(([code]) => code), { includeExact: true })
  return <div className="nutrients-grid">{labels.map(([code, label, unit]) => <div key={code}><small>{label}</small><strong>{formatTotal(totals[code], unit)}</strong></div>)}</div>
}
export function LocalCatalog({ onSelect, onClose }: { onSelect?: (food: FoodNutritionSnapshot, quantity: FoodQuantityInput) => void; onClose?: () => void }) {
  const [quantity,setQuantity]=useState<FoodQuantityInput>({kind:'physical',amount:'100',unit:'g',weightNature:'edible'})
  const [query, setQuery] = useState(''), [foods, setFoods] = useState<CatalogEntry[]>([])
  const [selected, setSelected] = useState<FoodNutritionSnapshot | null>(null), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [searched, setSearched] = useState(false)
  useEffect(()=>{if(selected)setQuantity(referenceQuantity(selected))},[selected])
  async function search() {
    if (query.trim().length < 2) { setError('Saisissez au moins deux caractères.'); return }
    setBusy(true); setError(''); setSelected(null); setSearched(true)
    try { setFoods((await requestPrivateJson<{ foods: CatalogEntry[] }>('/api/private/catalog?q=' + encodeURIComponent(query.trim()))).foods) }
    catch (e) { setError(e instanceof Error ? e.message : 'Catalogue indisponible.') } finally { setBusy(false) }
  }
  async function choose(id: string) {
    setBusy(true); setError('')
    try { setSelected(await loadRecipeFood('catalog:' + id)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Aliment indisponible.') } finally { setBusy(false) }
  }
  let selectionError=''
  if(selected)try{calculateFoodSnapshot(selected,quantity)}catch(e){selectionError=e instanceof Error?e.message:'Quantité invalide.'}
  return <div aria-busy={busy}><form onSubmit={e => { e.preventDefault(); void search() }}><label>Rechercher dans mon catalogue<input value={query} onChange={e => setQuery(e.target.value)}/></label><button disabled={busy}>Rechercher dans le catalogue</button></form>
    {error && <p role="alert" className="data-error">{error}</p>}
    <div className="food-results">{foods.map(food => <button type="button" key={food.id} disabled={busy} onClick={() => void choose(food.id)}><b>{food.description}</b><small>{food.source_type === 'custom' ? 'Personnel' : food.source_type === 'local' ? 'Local' : 'USDA importé'} · {food.source_name}</small></button>)}</div>
    {searched && !busy && !foods.length && !error && <p>Aucun aliment dans le catalogue pour cette recherche.</p>}
    {selected && <div><h3>{selected.description}</h3><p>Valeurs pour 100 {referenceQuantity(selected).unit} · {selected.sourceName} · {selected.sourceReference}</p><NutritionValues food={selected}/>
      {onSelect && <FoodQuantityEditor raw food={selected} quantity={quantity} onChange={setQuantity}/>}
      {selectionError&&<p role="alert">{selectionError}</p>}
      {onSelect && <button type="button" disabled={busy||!!selectionError} onClick={() => onSelect(selected,quantity)}>Ajouter cet ingrédient</button>}</div>}
    {onClose && <button type="button" onClick={onClose}>Fermer les ingrédients</button>}
  </div>
}
