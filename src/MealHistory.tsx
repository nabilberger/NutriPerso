import { useEffect, useRef, useState } from 'react'
import { requestPrivateJson } from './auth/client'
import type { ConfirmedMealSnapshot, MealKind } from './domain/nutrition/journal'
import type { MealReuseDTO } from './meal-reuse'
import { createUuidV4 } from './secure-uuid.ts'
import './meal-history.css'

type Template = { id: string; name: string; revision: number; meal: { id: string; name: string; revision: number; meal: { kind: MealKind; label: string | null; items: ConfirmedMealSnapshot['items'] } }; createdAt: string; updatedAt: string }
type Page = { meals: ConfirmedMealSnapshot[]; total: number; limit: number; offset: number }

export default function MealHistory({ onReuse }: { readonly onReuse: (meal: MealReuseDTO) => void }) {
  const [page, setPage] = useState<Page>({ meals: [], total: 0, limit: 20, offset: 0 })
  const [recentMeals, setRecentMeals] = useState<ConfirmedMealSnapshot[]>([])
  const requestSequence = useRef(0)
  const [templates, setTemplates] = useState<Template[]>([])
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<ConfirmedMealSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    const sequence = ++requestSequence.current
    setLoading(true); setError('')
    try {
      const [history, recent, saved] = await Promise.all([
        requestPrivateJson<Page>(`/api/private/journal/history?limit=20&offset=${page.offset}&q=${encodeURIComponent(query)}&from=${from}&to=${to}`),
        requestPrivateJson<Page>('/api/private/journal/history?limit=20&offset=0'),
        requestPrivateJson<{ templates: Template[] }>('/api/private/meal-templates'),
      ])
      if (sequence !== requestSequence.current) return
      setPage(history); setRecentMeals(recent.meals); setTemplates(saved.templates)
    } catch (e) { if (sequence === requestSequence.current) setError(e instanceof Error ? e.message : 'Historique indisponible.') }
    finally { if (sequence === requestSequence.current) setLoading(false) }
  }
  useEffect(() => { void load() }, [page.offset, query, from, to])
  async function saveTemplate() {
    if (!selected || !name.trim()) return
    setSaving(true); setError('')
    try {
      const now = new Date().toISOString()
      const id = createUuidV4()
      const meal = { id, name: name.trim(), revision: 1, meal: {
        kind: selected.mealKind, label: selected.label ?? null, items: selected.items,
      }, createdAt: now, updatedAt: now }
      const result = await requestPrivateJson<{ template: Template }>(`/api/private/meal-templates/${id}`, {
        method: 'PUT', body: JSON.stringify({ template: meal, expectedRevision: null }),
      })
      setTemplates((items) => [result.template, ...items]); setSelected(null); setName('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Modèle non enregistré.') }
    finally { setSaving(false) }
  }
  async function renameTemplate(item: Template) {
    const next = window.prompt('Nom du modèle', item.name)?.trim()
    if (!next || next === item.name) return
    try {
      const template = { ...item, name: next, revision: item.revision + 1, updatedAt: new Date().toISOString(),
        meal: { ...item.meal, name: next, revision: item.revision + 1 } }
      const result = await requestPrivateJson<{ template: Template }>(`/api/private/meal-templates/${item.id}`, {
        method: 'PUT', body: JSON.stringify({ template, expectedRevision: item.revision }),
      })
      setTemplates((items) => items.map((entry) => entry.id === item.id ? result.template : entry))
    } catch (e) { setError(e instanceof Error ? e.message : 'Modèle non modifié.') }
  }
  async function deleteTemplate(item: Template) {
    if (!window.confirm(`Supprimer le modèle « ${item.name} » ?`)) return
    try {
      await requestPrivateJson<void>(`/api/private/meal-templates/${item.id}`, { method: 'DELETE' })
      setTemplates((items) => items.filter((entry) => entry.id !== item.id))
    } catch (e) { setError(e instanceof Error ? e.message : 'Modèle non supprimé.') }
  }
  return <section className="meal-history data-page">
    <header className="data-heading"><small>JOURNAL · HISTORIQUE</small><h1>Repas <em>réutilisables.</em></h1><p>Vos consommations confirmées restent intactes; une reprise crée un nouveau brouillon.</p></header>
    {error && <p role="alert" className="data-error">{error}</p>}
    <section className="food-search" aria-label="Rechercher dans l'historique">
      <label>Rechercher un repas ou un aliment<input value={query} onChange={(e) => { setPage((p) => ({ ...p, offset: 0 })); setQuery(e.target.value) }} /></label>
      <div><label>Depuis<input type="date" value={from} onChange={(e) => { setPage((p) => ({ ...p, offset: 0 })); setFrom(e.target.value) }} /></label><label>Jusqu’au<input type="date" value={to} onChange={(e) => { setPage((p) => ({ ...p, offset: 0 })); setTo(e.target.value) }} /></label></div>
    </section>
    <section className="data-card"><h2>20 consommations les plus récentes</h2><p className="data-muted">Ce raccourci reste indépendant des filtres de recherche.</p>
      {loading ? <p role="status">Chargement des repas récents…</p> : recentMeals.length ? <div className="history-list">{recentMeals.map((meal) => <article key={meal.snapshotId}>
        <div><b>{meal.label || meal.items.map((i) => i.kind === 'food' ? i.foodSnapshot.description : i.recipeSnapshot.recipe.name).join(', ')}</b><small>{meal.localDate} · {meal.mealKind} · confirmé</small></div>
        <button type="button" onClick={() => onReuse(snapshotToReuse(meal))}>Réutiliser</button><button type="button" onClick={() => { setSelected(meal); setName('') }}>Enregistrer comme modèle</button>
      </article>)}</div> : <div className="data-empty">Aucune consommation confirmée ne correspond à ces filtres.</div>}
    </section>
    <section className="data-card"><h2>Historique filtré</h2><p className="data-muted">Résultats selon votre recherche et les dates sélectionnées.</p>
      {loading ? <p role="status">Recherche en cours…</p> : page.meals.length ? <div className="history-list">{page.meals.map((meal) => <article key={meal.snapshotId}>
        <div><b>{meal.label || meal.items.map((i) => i.kind === 'food' ? i.foodSnapshot.description : i.recipeSnapshot.recipe.name).join(', ')}</b><small>{meal.localDate} · {meal.mealKind} · confirmé</small></div>
        <button type="button" onClick={() => onReuse(snapshotToReuse(meal))}>Réutiliser</button><button type="button" onClick={() => { setSelected(meal); setName('') }}>Enregistrer comme modèle</button>
      </article>)}</div> : <div className="data-empty">Aucun résultat pour ces filtres.</div>}
      <div className="history-pages"><button type="button" disabled={page.offset === 0 || loading} onClick={() => setPage((p) => ({ ...p, offset: Math.max(0, p.offset - 20) }))}>Précédent</button><span>{page.total ? page.offset + 1 : 0}–{Math.min(page.total, page.offset + 20)} / {page.total}</span><button type="button" disabled={page.offset + 20 >= page.total || loading} onClick={() => setPage((p) => ({ ...p, offset: p.offset + 20 }))}>Suivant</button></div>
    </section>
    <section className="data-card"><h2>Modèles enregistrés</h2>{templates.length ? <div className="history-list">{templates.map((item) => <article key={item.id}>
      <div><b>{item.name}</b><small>Modèle enregistré volontairement · v{item.revision}</small></div>
      <button type="button" onClick={() => onReuse(templateToReuse(item))}>Réutiliser</button>
      <button type="button" onClick={() => void renameTemplate(item)}>Renommer</button><button type="button" onClick={() => void deleteTemplate(item)}>Supprimer</button>
    </article>)}</div> : <div className="data-empty">Aucun modèle enregistré. Enregistrez-en un depuis une consommation.</div>}</section>
    {selected && <div className="history-dialog" role="dialog" aria-modal="true" aria-labelledby="template-title"><form onSubmit={(e) => { e.preventDefault(); void saveTemplate() }}>
      <h2 id="template-title">Enregistrer un modèle</h2><label>Nom du modèle<input autoFocus maxLength={80} required value={name} onChange={(e) => setName(e.target.value)} /></label>
      <p>Les ingrédients et portions de cette consommation seront copiés. Le repas historique ne sera pas modifié.</p>
      <button type="button" onClick={() => setSelected(null)}>Annuler</button><button disabled={saving || !name.trim()} type="submit">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
    </form></div>}
  </section>
}

function snapshotToReuse(snapshot: ConfirmedMealSnapshot): MealReuseDTO {
  return { sourceKind: 'consumption', sourceId: snapshot.snapshotId, label: snapshot.label ?? null, mealKind: snapshot.mealKind,
    items: snapshot.items.map((item) => item.kind === 'food'
      ? { kind: 'food', foodId: item.foodId, quantity: item.enteredQuantity, sortOrder: item.sortOrder }
      : { kind: 'recipe', recipeId: item.recipeSnapshot.recipe.id, quantity: item.quantity, sortOrder: item.sortOrder }) }
}
function templateToReuse(template: Template): MealReuseDTO {
  return { sourceKind: 'template', sourceId: template.id, label: template.name, mealKind: template.meal.meal.kind,
    items: template.meal.meal.items.map((item) => item.kind === 'food'
      ? { kind: 'food', foodId: item.foodId, quantity: item.enteredQuantity, sortOrder: item.sortOrder }
      : { kind: 'recipe', recipeId: item.recipeSnapshot.recipe.id, quantity: item.quantity, sortOrder: item.sortOrder }) }
}
