import { useEffect, useRef, useState } from 'react'
import { requestPrivateJson } from './auth/client'
import { createUuidV4 } from './secure-uuid'
import { loadRecipeFood } from './recipe-foods'
import IngredientPicker from './IngredientPicker'
import { formatTotal } from './Journal'
import { addRecipeIngredient, calculateRecipe, createRecipe, removeRecipeIngredient, setRecipeFinalWeight, updateRecipeIngredientQuantity,
  type FoodNutritionSnapshot, type RecipeDraft } from './domain/nutrition/recipes'
import type { FoodQuantityInput } from './domain/nutrition/portions'
import type { ConfirmedRecipeSnapshot } from './domain/nutrition/recipe-snapshot'
import { selectCurrentRecipeSnapshot } from './meal-reuse'
import './recipes.css'
type Persisted = { draft: RecipeDraft; snapshots: ConfirmedRecipeSnapshot[] }
function physicalQuantity(amount: string, unit: 'g' | 'kg' | 'ml' | 'l', nature: 'edible' | 'gross' | 'unknown' = 'edible'): FoodQuantityInput {
  return unit === 'g' || unit === 'kg' ? { kind: 'physical', amount, unit, weightNature: nature } : { kind: 'physical', amount, unit, weightNature: 'not-applicable' }
}
const metrics = [['energy', 'Calories', 'kcal'], ['protein', 'Protéines', 'g'], ['carbohydrate', 'Glucides', 'g'], ['fat', 'Lipides', 'g'], ['fiber', 'Fibres', 'g']] as const
export default function RecipeLibrary({ onUse }: { onUse: (snapshot: ConfirmedRecipeSnapshot) => void }) {
  const [recipes, setRecipes] = useState<RecipeDraft[]>([]), [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<RecipeDraft | null>(null), [serverRevision, setServerRevision] = useState(0)
  const [snapshots, setSnapshots] = useState<ConfirmedRecipeSnapshot[]>([])
  const [foods, setFoods] = useState<Record<string, FoodNutritionSnapshot>>({})
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [picker, setPicker] = useState(false)
  const [error, setError] = useState(''), [message, setMessage] = useState('')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    void requestPrivateJson<{ recipes: RecipeDraft[] }>('/api/private/recipes?limit=100')
      .then(result => { if (alive.current) setRecipes(result.recipes) })
      .catch(e => { if (alive.current) setError(e instanceof Error ? e.message : 'Recettes inaccessibles.') })
      .finally(() => { if (alive.current) setLoading(false) })
    return () => { alive.current = false }
  }, [])
  function canLeave() { return !dirty || window.confirm('Abandonner les modifications non enregistrées de cette recette ?') }
  function newRecipe() {
    if (!canLeave()) return
    setDraft({ ...createRecipe({ id: createUuidV4(), name: 'Nouvelle recette' }), servings: '1', description: '', instructions: '' })
    setFoods({}); setServerRevision(0); setSnapshots([]); setDirty(true); setPicker(false); setError(''); setMessage('')
  }
  async function open(id: string) {
    if (!canLeave()) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await requestPrivateJson<Persisted>('/api/private/recipes/' + encodeURIComponent(id))
      const loaded = await Promise.allSettled([...new Set(result.draft.ingredients.map(i => i.foodId))].map(async id => [id, await loadRecipeFood(id)] as const))
      const entries = loaded.flatMap(entry => entry.status === 'fulfilled' ? [entry.value] : [])
      if (!alive.current) return
      setDraft(result.draft); setFoods(Object.fromEntries(entries)); setServerRevision(result.draft.revision)
      setSnapshots(result.snapshots); setDirty(false); setPicker(false)
      if (loaded.some(entry => entry.status === 'rejected')) setError('Une fiche d’ingrédient est indisponible. Réouvrez la recette pour réessayer ou retirez cet ingrédient avant de confirmer.')
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Recette inaccessible.') } finally { if (alive.current) setBusy(false) }
  }
  function change(next: RecipeDraft) { setDraft(next); setDirty(true); setMessage(''); setError('') }
  let calculation: ReturnType<typeof calculateRecipe> | null = null, perServing: ReturnType<typeof calculateRecipe> | null = null, invalid = ''
  if (draft) {
    try {
      if (!draft.name.trim()) throw new Error('Le nom de la recette est obligatoire.')
      if (!draft.ingredients.length) throw new Error('Ajoutez au moins un ingrédient.')
      if (draft.finalWeight) setRecipeFinalWeight(draft, draft.finalWeight)
      calculation = calculateRecipe(draft, new Map(Object.entries(foods)))
      perServing = calculateRecipe(draft, new Map(Object.entries(foods)), { kind: 'per-serving' })
    } catch (e) { invalid = e instanceof Error ? e.message : 'Quantité ou portions invalides.' }
  }
  async function save(confirm: boolean) {
    if (!draft || (confirm && invalid)) return
    setBusy(true); setError(''); setMessage('')
    try {
      if (!draft.name.trim()) throw new Error('Le nom de la recette est obligatoire.')
      // Validate all decimal fields even for a draft; incomplete text stays in the editor on failure.
      if (draft.finalWeight) setRecipeFinalWeight(draft, draft.finalWeight)
      calculateRecipe(draft, new Map(Object.entries(foods)), { kind: 'per-serving' })
      let saved = draft
      if (dirty || !serverRevision) {
        saved = (await requestPrivateJson<{ draft: RecipeDraft }>(`/api/private/recipes/${draft.id}/draft`, {
          method: 'PUT', body: JSON.stringify({ draft: { ...draft, name: draft.name.trim(), revision: serverRevision + 1 }, expectedRevision: serverRevision }),
        })).draft
        if (!alive.current) return
        setDraft(saved); setServerRevision(saved.revision); setDirty(false)
        setRecipes(current => [saved, ...current.filter(item => item.id !== saved.id)])
        setMessage('Brouillon enregistré.')
      }
      if (confirm) {
        const result = await requestPrivateJson<{ snapshot: ConfirmedRecipeSnapshot }>(`/api/private/recipes/${saved.id}/confirm`, {
          method: 'POST', body: JSON.stringify({ expectedRevision: saved.revision, expectedPredecessorSnapshotId: selectCurrentRecipeSnapshot(snapshots, saved.id)?.snapshotId ?? null }),
        })
        if (!alive.current) return
        setSnapshots(current => [...current.filter(s => s.snapshotId !== result.snapshot.snapshotId), result.snapshot])
        setFoods(current => ({ ...current, ...Object.fromEntries(result.snapshot.ingredients.map(i => [i.food.foodId, { ...i.food, nutrients: i.sourceNutrients, portionEquivalences: i.equivalenceSnapshot ? [i.equivalenceSnapshot] : [], edibleYieldConversions: i.resolvedQuantity.status === 'resolved' && i.resolvedQuantity.yieldConversion ? [i.resolvedQuantity.yieldConversion] : [] }])) }))
        setMessage('Recette confirmée. Elle peut être utilisée dans le journal.')
      }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Enregistrement impossible.') } finally { if (alive.current) setBusy(false) }
  }
  async function useRecipe(id: string) {
    if (!canLeave()) return
    setBusy(true); setError('')
    try {
      const record = await requestPrivateJson<Persisted>('/api/private/recipes/' + encodeURIComponent(id))
      const snapshot = selectCurrentRecipeSnapshot(record.snapshots, id)
      if (record.draft.archived || !snapshot) throw new Error('Confirmez cette recette avant de l’utiliser dans le journal.')
      onUse(snapshot)
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Recette indisponible.') } finally { if (alive.current) setBusy(false) }
  }
  async function remove(recipe: RecipeDraft) {
    if (!window.confirm(`Supprimer « ${recipe.name} » de la bibliothèque ? Les repas confirmés seront conservés.`)) return
    setBusy(true); setError('')
    try {
      await requestPrivateJson(`/api/private/recipes/${recipe.id}`, { method: 'DELETE', body: JSON.stringify({ expectedRevision: recipe.revision }) })
      if (!alive.current) return
      setRecipes(current => current.filter(r => r.id !== recipe.id))
      if (draft?.id === recipe.id) { setDraft(null); setDirty(false); setPicker(false) }
      setMessage('Recette supprimée de la bibliothèque. Les instantanés historiques sont conservés.')
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Suppression impossible.') } finally { if (alive.current) setBusy(false) }
  }
  return <div className="data-page recipes-page"><div className="data-heading"><small>MA CUISINE</small><h1>Mes recettes, <em>à portée de main.</em></h1><p>Préparez vos plats et ajoutez une version confirmée à votre journal.</p></div>
    {error && <p role="alert" className="data-error">{error}</p>}{message && <p role="status">{message}</p>}
    <button className="journal-primary" type="button" disabled={busy || loading} onClick={newRecipe}>Créer une recette</button>
    {draft && <section className="data-card recipe-editor" aria-label="Éditeur de recette"><h2>Préparation de la recette</h2><fieldset disabled={busy}>
      <label>Nom de la recette<input value={draft.name} onChange={e => change({ ...draft, name: e.target.value })}/></label>
      <label>Description facultative<textarea value={draft.description ?? ''} onChange={e => change({ ...draft, description: e.target.value })}/></label>
      <div className="recipe-fields"><label>Nombre de portions<input inputMode="decimal" value={draft.servings ?? ''} onChange={e => change({ ...draft, servings: e.target.value.replace(',', '.') })}/></label>
      <label>Poids final comestible (g), facultatif<input inputMode="decimal" value={draft.finalWeight?.amount ?? ''} onChange={e => change({ ...draft, finalWeight: e.target.value ? { amount: e.target.value.replace(',', '.'), unit: 'g', weightNature: 'edible' } : null })}/></label></div>
      <h3>Ingrédients</h3>{draft.ingredients.map(ingredient => <article className="recipe-ingredient" key={ingredient.id}>
        <b>{foods[ingredient.foodId]?.description ?? ingredient.foodId}</b><small>{foods[ingredient.foodId]?.sourceName}</small>
        <div className="recipe-fields"><label>Quantité de {foods[ingredient.foodId]?.description ?? 'cet ingrédient'}<input inputMode="decimal" value={ingredient.quantity.amount} onChange={e => change(updateRecipeIngredientQuantity(draft, ingredient.id, { ...ingredient.quantity, amount: e.target.value.replace(',', '.') }))}/></label>
        {ingredient.quantity.kind === 'physical' && <><label>Unité de {foods[ingredient.foodId]?.description ?? 'cet ingrédient'}<select value={ingredient.quantity.unit} onChange={e => {
          const unit = e.target.value as 'g' | 'kg' | 'ml' | 'l'
          change(updateRecipeIngredientQuantity(draft, ingredient.id, physicalQuantity(ingredient.quantity.amount, unit)))
        }}><option>g</option><option>kg</option><option>ml</option><option>l</option></select></label>
        {(ingredient.quantity.unit === 'g' || ingredient.quantity.unit === 'kg') && <label>Nature du poids<select value={ingredient.quantity.weightNature} onChange={e => change(updateRecipeIngredientQuantity(draft, ingredient.id, physicalQuantity(ingredient.quantity.amount, ingredient.quantity.kind === 'physical' ? ingredient.quantity.unit : 'g', e.target.value as 'edible' | 'gross' | 'unknown')))}><option value="edible">Comestible</option><option value="gross">Brut</option><option value="unknown">Inconnu</option></select></label>}</>}
        <button type="button" onClick={() => change(removeRecipeIngredient(draft, ingredient.id))}>Retirer cet ingrédient</button></div>
      </article>)}
      <button type="button" onClick={() => setPicker(true)}>Ajouter un ingrédient</button>
      {picker && <IngredientPicker onClose={() => setPicker(false)} onSelect={(food, quantity) => { setFoods(current => ({ ...current, [food.foodId]: food })); change(addRecipeIngredient(draft, { id: createUuidV4(), foodId: food.foodId, quantity })); setPicker(false) }}/>}
      <label>Étapes de préparation<textarea value={draft.instructions ?? ''} onChange={e => change({ ...draft, instructions: e.target.value })}/></label>
      {invalid && <p role="status" className="data-error">{invalid}</p>}
      <div className="recipe-totals">{[['Recette complète', calculation], ['Par portion', perServing]].map(([title, result]) => <section key={String(title)} aria-label={String(title)}><h3>{String(title)}</h3><div className="nutrients-grid">{metrics.map(([code, label, unit]) => <div key={code}><small>{label}</small><strong>{formatTotal(typeof result === 'object' && result ? result.totals[code] : undefined, unit)}</strong></div>)}</div></section>)}</div>
      <div className="recipe-actions"><button type="button" onClick={() => void save(false)}>Enregistrer le brouillon</button><button type="button" className="journal-primary" disabled={!!invalid} onClick={() => void save(true)}>Confirmer la recette</button><button type="button" onClick={() => { if (canLeave()) { setDraft(null); setDirty(false); setPicker(false) } }}>Fermer l’éditeur</button></div>
      <p>Les données inconnues restent signalées. Une nouvelle confirmation ne modifie jamais les repas déjà confirmés.</p>
    </fieldset></section>}
    <section className="data-card"><h2>Bibliothèque personnelle</h2>{loading ? <p role="status">Chargement des recettes…</p> : !recipes.length ? <p>Aucune recette enregistrée.</p> : <div className="recipes-list">{recipes.map(recipe => <article key={recipe.id}><div><h3>{recipe.name}</h3><p>{recipe.ingredients.length} ingrédient(s) · Version {recipe.revision}</p></div><div className="recipe-actions"><button type="button" disabled={busy} onClick={() => void open(recipe.id)}>Modifier</button><button type="button" disabled={busy} onClick={() => void useRecipe(recipe.id)}>Utiliser la version confirmée</button><button type="button" disabled={busy} onClick={() => void remove(recipe)}>Supprimer</button></div></article>)}</div>}</section>
  </div>
}
