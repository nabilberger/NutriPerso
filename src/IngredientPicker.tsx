import { useState } from 'react'
import { FoodPicker, formatTotal } from './Journal'
import { requestPrivateJson } from './auth/client'
import { loadRecipeFood } from './recipe-foods'
import { calculateFoodSnapshot, type FoodNutritionSnapshot } from './domain/nutrition/recipes'
import { aggregateNutrients } from './domain/nutrition/aggregate-nutrients'
import type { FoodQuantityInput } from './domain/nutrition/portions'
import type { CatalogEntry } from './catalog-nutrition'
const labels = [['energy', 'Calories', 'kcal'], ['protein', 'Protéines', 'g'], ['carbohydrate', 'Glucides', 'g'], ['fat', 'Lipides', 'g'], ['fiber', 'Fibres', 'g']] as const
function referenceQuantity(food: FoodNutritionSnapshot): FoodQuantityInput {
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
export default function IngredientPicker({ onSelect, onClose }: { onSelect: (food: FoodNutritionSnapshot, quantity: FoodQuantityInput) => void; onClose: () => void }) {
  const [source, setSource] = useState('usda')
  return <section className="recipe-picker" aria-label="Choisir un ingrédient"><label>Source des ingrédients<select value={source} onChange={e => setSource(e.target.value)}><option value="usda">USDA</option><option value="catalog">Catalogue local / personnel</option></select></label>
    {source === 'usda' ? <FoodPicker addLabel="Ajouter cet ingrédient" onCancel={onClose} onSelect={onSelect}/> : <LocalCatalog onSelect={food => onSelect(food, referenceQuantity(food))} onClose={onClose}/>}
  </section>
}
export function LocalCatalog({ onSelect, onClose }: { onSelect?: (food: FoodNutritionSnapshot) => void; onClose?: () => void }) {
  const [query, setQuery] = useState(''), [foods, setFoods] = useState<CatalogEntry[]>([])
  const [selected, setSelected] = useState<FoodNutritionSnapshot | null>(null), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [searched, setSearched] = useState(false)
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
  return <div aria-busy={busy}><form onSubmit={e => { e.preventDefault(); void search() }}><label>Rechercher dans mon catalogue<input value={query} onChange={e => setQuery(e.target.value)}/></label><button disabled={busy}>Rechercher dans le catalogue</button></form>
    {error && <p role="alert" className="data-error">{error}</p>}
    <div className="food-results">{foods.map(food => <button type="button" key={food.id} disabled={busy} onClick={() => void choose(food.id)}><b>{food.description}</b><small>{food.source_type === 'custom' ? 'Personnel' : food.source_type === 'local' ? 'Local' : 'USDA importé'} · {food.source_name}</small></button>)}</div>
    {searched && !busy && !foods.length && !error && <p>Aucun aliment dans le catalogue pour cette recherche.</p>}
    {selected && <div><h3>{selected.description}</h3><p>Valeurs pour 100 {referenceQuantity(selected).unit} · {selected.sourceName} · {selected.sourceReference}</p><NutritionValues food={selected}/>
      {onSelect && <button type="button" disabled={busy} onClick={() => onSelect(selected)}>Ajouter cet ingrédient</button>}</div>}
    {onClose && <button type="button" onClick={onClose}>Fermer les ingrédients</button>}
  </div>
}
