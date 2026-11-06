import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  addFoodJournalItem, calculateJournalDayPreview, calculateJournalMeal, cancelConfirmedMeal,
  createJournalDay, createJournalState, createMeal, createMealCorrectionDraft, removeJournalItem,
  removeMealDraft, selectActiveMealSnapshots, setFoodJournalItemQuantity, updateMealDetails,
  type ConfirmedMealSnapshot, type JournalDayDraft, type JournalState, type MealKind,
} from './domain/nutrition/journal.ts'
import type { FoodNutritionSnapshot } from './domain/nutrition/recipes.ts'
import type { FoodQuantityInput } from './domain/nutrition/portions.ts'
import type { NutrientTotal } from './domain/nutrition/types.ts'
import type { ConfirmedRecipeSnapshot } from './domain/nutrition/recipe-snapshot.ts'
import { buildMealReuseDraft, selectCurrentRecipeSnapshot, type MealReuseDTO } from './meal-reuse'
import { createUuidV4 } from './secure-uuid.ts'
import { uiFixtureMode } from './ui-fixture-mode'
import { getFixtureFoodSource } from './dev-ui-fixtures'
import { requestFoodCatalog } from './catalog-client'
import { decimalToFraction, fractionToDecimal, parseDecimal } from './domain/nutrition/decimal.ts'
import { usdaDetailToFoodSnapshot, type UsdaFoodDetailForNutrition } from './domain/nutrition/usda-food-snapshot.ts'
import { requestPrivateJson } from './auth/client'
import { loadFoodSources } from './journal-sources.ts'
import './journal.css'
import { emptyJournalCache, journalCacheKey, persistJournalCacheForKey, readJournalCache, resolveJournalCacheConflict, writeJournalCache, type JournalCacheRecord, type PendingJournalCancel } from './journal-cache.ts'

type PersistedJournal = { readonly day: JournalDayDraft; readonly snapshots: readonly ConfirmedMealSnapshot[] }
type JournalCache = JournalCacheRecord
type SearchFood = { readonly fdcId: number; readonly description: string; readonly dataType: string | null; readonly brandOwner: string | null; readonly foodCategory: 'generic' | 'branded' }
type SearchResult = { readonly foods: readonly SearchFood[]; readonly totalHits: number; readonly currentPage: number; readonly totalPages: number }
type FoodDetail = UsdaFoodDetailForNutrition
type DisplaySection = 'energy' | 'protein' | 'carbohydrate' | 'fat' | 'fiber'
const sections: readonly { readonly code: DisplaySection; readonly label: string; readonly unit: string }[] = [
  { code: 'energy', label: 'Énergie', unit: 'kcal' }, { code: 'protein', label: 'Protéines', unit: 'g' },
  { code: 'carbohydrate', label: 'Glucides', unit: 'g' }, { code: 'fat', label: 'Lipides', unit: 'g' },
  { code: 'fiber', label: 'Fibres', unit: 'g' },
]
const mealLabels: Record<MealKind, string> = { breakfast: 'Petit-déjeuner', lunch: 'Déjeuner', dinner: 'Dîner', snack: 'Collation', custom: 'Autre repas' }
const engineVersion = 'nutrition-engine-v1'

export default function Journal({ userId, reuseRequest, onReuseConsumed }: { readonly userId: string; readonly reuseRequest: { readonly token: number; readonly source: MealReuseDTO } | null; readonly onReuseConsumed: () => void }) {
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', [])
  const [date, setDate] = useState(() => todayIn(timeZone))
  const [cache, setCache] = useState<JournalCache>(emptyJournalCache)
  const cacheRef = useRef(cache)
  const [loading, setLoading] = useState(true)
  const [initialized, setInitialized] = useState(false)
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const [syncMessage, setSyncMessage] = useState('Chargement du journal…')
  const [error, setError] = useState('')
  const [addingMeal, setAddingMeal] = useState(false)
  const [newMealKind, setNewMealKind] = useState<MealKind>('lunch')
  const [newMealLabel, setNewMealLabel] = useState('')
  const [newMealTime, setNewMealTime] = useState(() => localDateTimeInput(new Date()))
  const [addingFoodTo, setAddingFoodTo] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const storageErrorRef = useRef(false)
  const syncLocks = useRef(new Set<string>())
  const cacheKey = journalCacheKey(userId, date)
  const activeCacheKey = useRef(cacheKey)
  const cacheRefKey = useRef(cacheKey)
  activeCacheKey.current = cacheKey

  const commitForKey = useCallback((key: string, next: JournalCache) => {
    const result = persistJournalCacheForKey(localStorage, key, activeCacheKey.current, next)
    if (result.updateActiveView) {
      cacheRef.current = next
      cacheRefKey.current = key
      setCache(next)
      storageErrorRef.current = !result.persisted
      setStorageError(!result.persisted)
      if (!result.persisted) setSyncMessage(navigator.onLine
        ? 'Écriture locale impossible. La modification reste en mémoire pendant la tentative de synchronisation.'
        : 'Écriture locale impossible : cette modification n’est pas sauvegardée hors connexion.')
    }
    return result.persisted
  }, [])
  const commit = useCallback((next: JournalCache) => commitForKey(cacheKey, next), [cacheKey, commitForKey])
  const setMessageForKey = useCallback((key: string, message: string) => {
    if (activeCacheKey.current === key) setSyncMessage(message)
  }, [])

  const sync = useCallback(async () => {
    const requestKey = cacheKey
    if (!navigator.onLine || syncLocks.current.has(requestKey) || activeCacheKey.current !== requestKey) return
    syncLocks.current.add(requestKey); setSyncing(true)
    const inMemory = cacheRefKey.current === requestKey ? cacheRef.current : null
    if (!inMemory) { syncLocks.current.delete(requestKey); setSyncing(syncLocks.current.size > 0); return }
    let working = inMemory
    try {
      if (working.dirty && working.day && (working.day.meals.length > 0 || working.serverRevision > 0)) {
        const sentDay = working.day
        const saved = await requestPrivateJson<{ draft: JournalDayDraft }>(`/api/private/journal/${encodeURIComponent(sentDay.id)}/draft`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedRevision: working.serverRevision, draft: { ...sentDay, revision: working.serverRevision + 1 } }),
        })
        const latest = cacheRefKey.current === requestKey ? cacheRef.current : (readJournalCache(localStorage, requestKey) ?? working)
        if (!latest.day || latest.day.revision !== sentDay.revision) {
          working = { ...latest, serverRevision: saved.draft.revision, dirty: true }
          commitForKey(requestKey, working); setMessageForKey(requestKey, 'Une nouvelle modification reste en attente de synchronisation.'); return
        }
        working = { ...working, day: saved.draft, serverRevision: saved.draft.revision, dirty: false }
        commitForKey(requestKey, working)
      } else if (working.dirty && !working.day) {
        working = { ...working, dirty: false }; commitForKey(requestKey, working)
      }
      if (working.pendingConfirm) {
        const pending = working.pendingConfirm
        if (working.dirty || !working.day?.meals.some((meal) => meal.id === pending.mealId)) {
          setMessageForKey(requestKey, 'Confirmation en attente : le brouillon local reste conservé.')
        } else {
          const result = await requestPrivateJson<{ day: JournalDayDraft; snapshot: ConfirmedMealSnapshot }>(
            `/api/private/journal/${encodeURIComponent(working.day.id)}/meals/${encodeURIComponent(pending.mealId)}/confirm`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
              snapshotId: pending.snapshotId, confirmedAt: pending.confirmedAt, engineVersion: pending.engineVersion,
            }) },
          )
          working = { ...working, day: result.day, serverRevision: result.day.revision,
            snapshots: replaceSnapshot(working.snapshots, result.snapshot), pendingConfirm: null, dirty: false }
          commitForKey(requestKey, working)
        }
      }
      for (const pending of working.pendingCancels) {
        const result = await requestPrivateJson<{ day: JournalDayDraft; snapshot: ConfirmedMealSnapshot }>(
          `/api/private/journal/snapshots/${encodeURIComponent(pending.snapshotId)}/cancel`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            newSnapshotId: pending.newSnapshotId, confirmedAt: pending.confirmedAt, engineVersion: pending.engineVersion,
          }) },
        )
        working = { ...working, day: result.day, serverRevision: result.day.revision, dirty: false,
          snapshots: replaceSnapshot(working.snapshots, result.snapshot),
          pendingConfirm: working.pendingConfirm?.mealId === result.snapshot.logicalMealId ? null : working.pendingConfirm,
          pendingCancels: working.pendingCancels.filter((item) => item.newSnapshotId !== pending.newSnapshotId) }
        commitForKey(requestKey, working)
      }
      setMessageForKey(requestKey, working.dirty || working.pendingConfirm || working.pendingCancels.length
        ? 'Modifications conservées sur cet appareil, synchronisation en attente.' : 'Synchronisé avec votre journal.')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : ''
      if (/409|révision|version plus récente|changé|changed/i.test(message)) {
        try {
          const latest = await requestPrivateJson<{ journal: PersistedJournal | null }>('/api/private/journal?date=' + encodeURIComponent(date))
          const resolved = resolveJournalCacheConflict(working, latest.journal)
          commitForKey(requestKey, resolved)
          setMessageForKey(requestKey, resolved.pendingConfirm || resolved.pendingCancels.length
            ? 'Version serveur reprise automatiquement ; les opérations encore compatibles vont être retentées.'
            : 'Version serveur reprise automatiquement ; sa dernière révision confirmée est conservée.')
        } catch {
          setMessageForKey(requestKey, 'Synchronisation en attente : la dernière version serveur n’a pas pu être relue.')
        }
      } else if (uiFixtureMode) {
        setMessageForKey(requestKey, `Erreur de simulation locale : ${message || 'la transition fictive n’a pas abouti.'}`)
      } else setMessageForKey(requestKey, navigator.onLine
        ? 'Serveur inaccessible : les changements restent en attente sur cet appareil.'
        : storageErrorRef.current ? 'Stockage local indisponible : la modification n’est pas sauvegardée et sera perdue à la fermeture.'
          : 'Hors connexion : les changements sont enregistrés sur cet appareil.')
    } finally {
      syncLocks.current.delete(requestKey)
      setSyncing(syncLocks.current.size > 0)
    }
  }, [cacheKey, commitForKey, date, setMessageForKey, storageError])

  useEffect(() => { cacheRef.current = cache }, [cache])
  useEffect(() => {
    let active = true
    setLoading(true); setInitialized(false); setError('')
    const local = readJournalCache(localStorage, cacheKey) ?? emptyJournalCache()
    cacheRef.current = local; cacheRefKey.current = cacheKey; setCache(local)
    async function load() {
      try {
        const { journal } = await requestPrivateJson<{ journal: PersistedJournal | null }>(`/api/private/journal?date=${encodeURIComponent(date)}`)
        if (!active) return
        if (local.dirty && ((journal?.day.id ?? null) !== (local.day?.id ?? null) || (journal?.day.revision ?? 0) !== local.serverRevision)) {
          const resolved = resolveJournalCacheConflict(local, journal)
          cacheRef.current = resolved; cacheRefKey.current = cacheKey; setCache(resolved)
          setSyncMessage('Version serveur reprise automatiquement ; sa dernière révision confirmée est conservée.')
          if (!persistJournalCacheForKey(localStorage, cacheKey, cacheKey, resolved).persisted) setStorageError(true)
        } else if (local.dirty || local.pendingConfirm || local.pendingCancels.length) {
          const restored = { ...local, ...(journal ? { snapshots: journal.snapshots } : {}) }
          cacheRef.current = restored; cacheRefKey.current = cacheKey; setCache(restored); setSyncMessage('Reprise des opérations locales en attente.')
        } else if (journal) {
          const restored = { ...emptyJournalCache(), day: journal.day, snapshots: journal.snapshots, serverRevision: journal.day.revision,
            sources: local.sources, photoDataUrl: local.photoDataUrl }
          cacheRef.current = restored; cacheRefKey.current = cacheKey; setCache(restored); setSyncMessage('Journal chargé depuis Supabase.')
          void loadFoodSources(journal.day, restored.sources, () => active).then((sources) => {
            if (active) commit({ ...cacheRef.current, sources })
          })
        } else {
          const fresh = { ...emptyJournalCache(), sources: local.sources, photoDataUrl: local.photoDataUrl }
          cacheRef.current = fresh; cacheRefKey.current = cacheKey; setCache(fresh)
          setSyncMessage(navigator.onLine ? 'Aucun repas enregistré pour cette journée.' : 'Aucune copie locale pour cette journée.')
        }
      } catch {
        if (!active) return
        cacheRef.current = local; cacheRefKey.current = cacheKey; setCache(local)
        setSyncMessage(local.day || local.snapshots.length ? 'Serveur inaccessible : copie locale chargée.' : 'La journée sera créée localement dès votre première saisie.')
      } finally {
        if (active) { setLoading(false); setInitialized(true) }
      }
    }
    void load()
    return () => { active = false }
  }, [cacheKey, date, commit])

  useEffect(() => {
    const onOnline = () => { setOnline(true); void sync() }
    const onOffline = () => { setOnline(false); setSyncMessage(storageErrorRef.current ? 'Hors connexion : le stockage local a échoué, cette modification n’est pas sauvegardée.' : 'Hors connexion : les brouillons et opérations sont conservés localement.') }
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [storageError, sync])

  useEffect(() => {
    if (!initialized) return
    if (!writeJournalCache(localStorage, cacheKey, cache)) {
      storageErrorRef.current = true
      setStorageError(true)
      setSyncMessage(navigator.onLine ? 'Écriture locale impossible. La synchronisation serveur est en cours.' : 'Écriture locale impossible : cette modification n’est pas sauvegardée hors connexion.')
    } else { storageErrorRef.current = false; setStorageError(false) }
    if (cache.dirty || cache.pendingConfirm || cache.pendingCancels.length) {
      const timer = window.setTimeout(() => { void sync() }, 700)
      return () => window.clearTimeout(timer)
    }
  }, [cache, cacheKey, initialized, sync])

  const state: JournalState = useMemo(() => ({ days: cache.day ? [cache.day] : [], snapshots: cache.snapshots }), [cache.day, cache.snapshots])
  const sources = useMemo(() => new Map(Object.entries(cache.sources)), [cache.sources])
  const totals = useMemo(() => {
    if (!cache.day) return {}
    try { return calculateJournalDayPreview(state, cache.day.id, { foods: sources }) } catch { return {} }
  }, [cache.day, sources, state])
  const activeSnapshots = useMemo(() => {
    const replaced = new Set((cache.day?.meals ?? []).flatMap((meal) => meal.supersedesSnapshotId ? [meal.supersedesSnapshotId] : []))
    return selectActiveMealSnapshots(cache.snapshots).filter((snapshot) => snapshot.localDate === date && !replaced.has(snapshot.snapshotId))
  }, [cache.day?.meals, cache.snapshots, date])

  function mutate(transform: (current: JournalState) => JournalState) {
    try {
      const current = { days: cacheRef.current.day ? [cacheRef.current.day] : [], snapshots: cacheRef.current.snapshots }
      const next = transform(current)
      const day = next.days.find((candidate) => candidate.localDate === date) ?? null
      commit({ ...cacheRef.current, day, dirty: true, conflict: false }); setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'La modification n’a pas pu être appliquée.') }
  }

  function addMeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      let current: JournalState = { days: cacheRef.current.day ? [cacheRef.current.day] : [], snapshots: cacheRef.current.snapshots }
      let day = cacheRef.current.day
      if (!day) {
        current = createJournalDay(createJournalState(), { id: createUuidV4(), localDate: date, timeZone })
        day = current.days[0]!
      }
      current = createMeal(current, day.id, { id: createUuidV4(), kind: newMealKind, label: newMealLabel || null,
        occurredAt: inputToInstant(newMealTime), sortOrder: day.meals.length })
      commit({ ...cacheRef.current, day: current.days[0]!, dirty: true, conflict: false })
      setAddingMeal(false); setNewMealLabel(''); setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Le repas n’a pas pu être créé.') }
  }

  function requestConfirm(mealId: string) {
    commit({ ...cacheRef.current, pendingConfirm: { mealId, snapshotId: createUuidV4(),
      confirmedAt: new Date().toISOString(), engineVersion }, conflict: false })
    setSyncMessage(!online && storageErrorRef.current ? 'Confirmation en attente, mais le stockage local a échoué : le brouillon n’est pas sauvegardé hors connexion.' : online ? 'Confirmation en cours…' : 'Confirmation en attente de connexion ; le brouillon reste conservé.')
    if (online) void sync()
  }

  function requestCancel(snapshot: ConfirmedMealSnapshot) {
    const pending: PendingJournalCancel = { snapshotId: snapshot.snapshotId, newSnapshotId: createUuidV4(),
      confirmedAt: new Date().toISOString(), engineVersion }
    try {
      const result = cancelConfirmedMeal({ days: cacheRef.current.day ? [cacheRef.current.day] : [], snapshots: cacheRef.current.snapshots },
        snapshot.snapshotId, { newSnapshotId: pending.newSnapshotId, confirmedAt: pending.confirmedAt, engineVersion })
      const day = cacheRef.current.day
      const nextDay = day ? { ...day, revision: day.revision + 1, meals: day.meals.filter((meal) => meal.id !== snapshot.logicalMealId) } : null
      commit({ ...cacheRef.current, day: nextDay, dirty: nextDay ? true : cacheRef.current.dirty,
        snapshots: result.state.snapshots, pendingCancels: [...cacheRef.current.pendingCancels, pending] })
      setSyncMessage(!online && storageErrorRef.current ? 'Annulation en attente, mais le stockage local a échoué : cette action n’est pas sauvegardée hors connexion.' : online ? 'Annulation en cours…' : 'Annulation en attente de connexion, exclue du total local.')
      if (online) void sync()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Le repas n’a pas pu être annulé.') }
  }

  function startCorrection(snapshot: ConfirmedMealSnapshot) {
    mutate((current) => createMealCorrectionDraft({ ...current, snapshots: cacheRef.current.snapshots }, snapshot.snapshotId))
    setAddingFoodTo(null)
  }
  function removeDraft(mealId: string) {
    mutate((current) => removeMealDraft(current, cacheRef.current.day!.id, mealId))
    setAddingFoodTo(null)
  }
  function addSelectedFood(mealId: string, food: FoodNutritionSnapshot, quantity: FoodQuantityInput) {
    try {
      const current = { days: cacheRef.current.day ? [cacheRef.current.day] : [], snapshots: cacheRef.current.snapshots }
      const next = addFoodJournalItem(current, cacheRef.current.day!.id, mealId, {
        id: createUuidV4(), foodId: food.foodId, quantity,
        sortOrder: cacheRef.current.day!.meals.find((meal) => meal.id === mealId)?.items.length ?? 0,
      })
      commit({ ...cacheRef.current, day: next.days[0]!, sources: { ...cacheRef.current.sources, [food.foodId]: food },
        dirty: true, conflict: false })
      setAddingFoodTo(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'L’aliment n’a pas pu être ajouté.') }
  }

  useEffect(() => {
    if (!reuseRequest || loading) return
    const today = todayIn(timeZone)
    if (date !== today) { setDate(today); return }
    let cancelled = false
    const run = async () => {
      try {
        const cacheNow = cacheRef.current
        if (cacheNow.conflict) throw new Error('Résolvez le conflit de synchronisation avant de reprendre un repas.')
        let day = cacheNow.day?.localDate === today ? cacheNow.day : null
        let state: JournalState = { days: day ? [day] : [], snapshots: cacheNow.snapshots }
        if (!day) {
          state = createJournalDay(state, { id: createUuidV4(), localDate: today, timeZone })
          day = state.days[0]!
        }
        const recipeIds = [...new Set(reuseRequest.source.items.flatMap((item) => item.kind === 'recipe' ? [item.recipeId] : []))]
        const recipeEntries = await Promise.all(recipeIds.map(async (recipeId) => {
          const result = await requestPrivateJson<{ snapshots: ConfirmedRecipeSnapshot[] }>(`/api/private/recipes/${encodeURIComponent(recipeId)}`)
          const latest = selectCurrentRecipeSnapshot(result.snapshots, recipeId)
          if (!latest) throw new Error('Aucun snapshot confirmé actuel de cette recette n’est disponible.')
          return [recipeId, latest] as const
        }))
        const recipes = Object.fromEntries(recipeEntries)
        const reusedState = buildMealReuseDraft(
          { days: day ? [day] : [], snapshots: cacheNow.snapshots },
          { id: day?.id ?? createUuidV4(), localDate: today, timeZone },
          reuseRequest.source, recipes, () => createUuidV4(),
        )
        if (cancelled) return
        const nextDay = reusedState.days.find((entry) => entry.id === day!.id)!
        const currentFoods = { ...cacheNow.sources }
        for (const item of reuseRequest.source.items) if (item.kind === 'food') delete currentFoods[item.foodId]
        const currentSources = await loadFoodSources(nextDay, currentFoods, () => !cancelled)
        if (cancelled) return
        commit({ ...cacheNow, day: nextDay, sources: currentSources, dirty: true })
        setSyncMessage(navigator.onLine ? 'Nouveau brouillon créé. Vérifiez les quantités avant confirmation.' : 'Brouillon créé hors ligne; il sera synchronisé lorsque la connexion sera rétablie.')
        onReuseConsumed()
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Le repas n’a pas pu être repris.')
      }
    }
    void run()
    return () => { cancelled = true }
  }, [reuseRequest, loading, date, timeZone, onReuseConsumed])

  async function attachPhoto(file: File | undefined, input: HTMLInputElement) {
    input.value = ''
    if (!file) return
    const requestKey = cacheKey
    setError('')
    try {
      const photoDataUrl = await compressPhoto(file)
      const latest = cacheRefKey.current === requestKey ? cacheRef.current : readJournalCache(localStorage, requestKey)
      if (!latest) return
      commitForKey(requestKey, { ...latest, photoDataUrl })
      setMessageForKey(requestKey, !navigator.onLine && storageErrorRef.current ? 'La photo est uniquement en mémoire : le stockage local a échoué et elle sera perdue à la fermeture.' : 'Photo jointe à la copie locale. Son analyse n’est pas disponible dans ce lot.')
    } catch {
      if (activeCacheKey.current === requestKey) setError('Cette photo n’a pas pu être préparée sur cet appareil.')
    }
  }


  return <div className="journal-page">
    <header className="journal-heading">
      <div><small>JOURNAL ALIMENTAIRE</small><h1>Votre journée, <em>en détail.</em></h1><p>Saisie manuelle et calcul déterministe à partir des fiches USDA.</p></div>
      <label className="journal-date">Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Choisir la journée" /></label>
    </header>
    <div className={online ? 'journal-sync' : 'journal-sync offline'} role="status" aria-live="polite"><span aria-hidden="true">{online ? '●' : '◌'}</span>{syncMessage}{syncing && <span className="sync-spinner" aria-label="Synchronisation en cours"/>}</div>
    {error && <p role="alert" className="journal-error">{error}</p>}
    {storageError && <p role="alert" className="journal-error">{online ? 'Le stockage local a échoué. Vérifiez la synchronisation avant de fermer cette page.' : 'Le brouillon n’a pas pu être enregistré sur cet appareil et sera perdu à la fermeture.'}</p>}
    {cache.photoDataUrl && <div className="journal-photo"><img src={cache.photoDataUrl} alt="Photo jointe localement au journal"/><div><b>Photo jointe sur cet appareil</b><small>Elle n’est pas envoyée ni analysée dans ce lot.</small></div><button type="button" onClick={() => commit({ ...cacheRef.current, photoDataUrl: null })}>Retirer</button></div>}
    {loading ? <div className="journal-loading" role="status">Chargement de la journée…</div> : <>
      <section className="journal-totals" aria-label="Totaux nutritionnels de la journée">
        <div className="journal-total-intro"><small>TOTAUX DU JOUR</small><b>{cache.day?.meals.length || activeSnapshots.length ? 'Calculés avec les données disponibles' : 'Aucun repas pour cette journée'}</b><span>Les valeurs partielles et inconnues restent signalées.</span></div>
        {sections.map((item) => <div className="journal-total" key={item.code}><small>{item.label}</small><strong>{formatTotal(totals[item.code], item.unit)}</strong><span>{item.unit}</span></div>)}
      </section>
      <section className="journal-meals-section">
        <div className="journal-section-heading"><div><small>MES REPAS</small><h2>{cache.day?.meals.length ?? 0} brouillon(s) · {activeSnapshots.length} confirmé(s)</h2></div><div className="journal-secondary-actions"><label className="journal-photo-button">Prendre une photo<input type="file" accept="image/*" capture="environment" aria-label="Prendre une photo avec l’appareil photo" onChange={(event) => void attachPhoto(event.currentTarget.files?.[0], event.currentTarget)}/></label><label className="journal-photo-button">Choisir dans la galerie / fichiers<input type="file" accept="image/*" aria-label="Choisir une photo dans la galerie ou les fichiers" onChange={(event) => void attachPhoto(event.currentTarget.files?.[0], event.currentTarget)}/></label><button type="button" className="journal-primary" onClick={() => { setNewMealTime(localDateTimeInput(new Date(date + 'T12:00:00'))); setAddingMeal(true) }}>+ Ajouter un repas</button></div></div>
        {cache.day?.meals.map((meal) => <article className="journal-meal" key={meal.id}>
          <div className="journal-meal-header">
            <div className="journal-meal-kind"><span className="meal-dot"/><select aria-label="Catégorie du repas" value={meal.kind} onChange={(event) => mutate((current) => updateMealDetails(current, cache.day!.id, meal.id, { kind: event.target.value as MealKind }))}>{Object.entries(mealLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
            <label className="meal-time">Heure<input type="datetime-local" value={instantToInput(meal.occurredAt, date)} onChange={(event) => mutate((current) => updateMealDetails(current, cache.day!.id, meal.id, { occurredAt: inputToInstant(event.target.value) }))}/></label>
            <label className="meal-name">Nom facultatif<input value={meal.label ?? ''} placeholder="Ex. repas en famille" onChange={(event) => mutate((current) => updateMealDetails(current, cache.day!.id, meal.id, { label: event.target.value }))}/></label>
            <button type="button" className="journal-link danger" onClick={() => removeDraft(meal.id)}>Supprimer le brouillon</button>
          </div>
          {meal.items.length === 0 ? <p className="journal-empty-meal">Ajoutez un aliment pour calculer les apports de ce repas.</p> :
            <div className="journal-items">{meal.items.map((item) => item.kind === 'food' ? <article className="journal-food" key={item.id}>
              <div className="journal-food-name"><b>{item.pinnedFoodSnapshot?.description ?? cache.sources[item.foodId]?.description ?? item.foodId}</b><small>{item.pinnedFoodSnapshot?.dataType ?? cache.sources[item.foodId]?.dataType ?? 'Source USDA'}</small></div>
              <QuantityInput itemId={item.id} mealId={meal.id} quantity={item.quantity} onChange={(quantity) => mutate((current) => setFoodJournalItemQuantity(current, cache.day!.id, meal.id, item.id, quantity))}/>
              <button type="button" className="journal-link danger" aria-label={`Retirer ${item.pinnedFoodSnapshot?.description ?? cache.sources[item.foodId]?.description ?? 'cet aliment'}`} onClick={() => mutate((current) => removeJournalItem(current, cache.day!.id, meal.id, item.id))}>Retirer</button>
            </article> : <article className="journal-food" key={item.id}><div className="journal-food-name"><b>{item.recipeSnapshot.recipe.name}</b><small>Recette confirmée</small></div><span>{item.quantity.amount} {item.quantity.kind === 'servings' ? 'portion(s)' : 'g'}</span></article>)}</div>}
          <div className="journal-meal-totals"><b>Apports de ce repas</b>{sections.map(({code,label,unit})=><span key={code}>{label} <strong>{formatTotal(calculateMealTotal(state, cache.day?.id, meal.id, sources, code), unit)}</strong></span>)}</div>
          {addingFoodTo === meal.id ? <FoodPicker onCancel={() => setAddingFoodTo(null)} onSelect={(food, quantity) => addSelectedFood(meal.id, food, quantity)}/> :
            <button type="button" className="journal-add-food" onClick={() => setAddingFoodTo(meal.id)}>+ Ajouter un aliment</button>}
          {cache.pendingConfirm?.mealId === meal.id ? <div className="journal-pending-confirm" role="status">Confirmation en attente de synchronisation. Le brouillon reste modifiable.</div> :
            <button type="button" className="journal-confirm" disabled={meal.items.length === 0 || syncing} onClick={() => requestConfirm(meal.id)}>Confirmer ce repas</button>}
        </article>)}
        {addingMeal && <form className="journal-new-meal" onSubmit={addMeal}>
          <h3>Nouveau repas</h3><label>Catégorie<select value={newMealKind} onChange={(event) => setNewMealKind(event.target.value as MealKind)}>{Object.entries(mealLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
          <label>Heure<input type="datetime-local" value={newMealTime} onChange={(event) => setNewMealTime(event.target.value)} required/></label>
          <label>Nom facultatif<input value={newMealLabel} onChange={(event) => setNewMealLabel(event.target.value)} placeholder="Ex. déjeuner au bureau"/></label>
          <div><button type="button" className="journal-link" onClick={() => setAddingMeal(false)}>Annuler</button><button className="journal-primary" type="submit">Créer le repas</button></div>
        </form>}
        {activeSnapshots.map((snapshot) => <article className="journal-meal journal-confirmed" key={snapshot.snapshotId}>
          <div className="journal-meal-header"><div className="journal-meal-kind"><span className="meal-dot confirmed-dot"/><b>{mealLabels[snapshot.mealKind]} · confirmé</b></div><span className="confirmed-time">{instantToLabel(snapshot.occurredAt)}</span>
            <button type="button" className="journal-link" disabled={cache.dirty || syncing} onClick={() => startCorrection(snapshot)}>Corriger</button>
            <button type="button" className="journal-link danger" disabled={syncing} onClick={() => requestCancel(snapshot)}>Supprimer</button></div>
          <div className="journal-confirmed-items">{snapshot.items.map((item) => <span key={item.id}>{item.kind === 'food' ? item.foodSnapshot.description : item.recipeSnapshot.recipe.name}{item.kind === 'food' ? ` · ${item.enteredQuantity.amount} ${item.enteredQuantity.unit}` : ''}</span>)}</div>
          <div className="journal-meal-totals"><b>Apports confirmés</b>{sections.map(({code,label,unit})=><span key={code}>{label} <strong>{formatTotal(snapshot.status === 'confirmed' ? snapshot.totals[code] : undefined, unit)}</strong></span>)}</div>
          {cache.pendingCancels.some((pending) => pending.snapshotId === snapshot.snapshotId) && <div className="journal-pending-confirm">Annulation en attente de synchronisation.</div>}
        </article>)}
        {!cache.day?.meals.length && !activeSnapshots.length && <div className="journal-empty-day"><span>▤</span><h3>Aucun repas enregistré</h3><p>Ajoutez les aliments consommés. Les totaux se calculeront à partir de données nutritionnelles réelles.</p><button className="journal-primary" onClick={() => setAddingMeal(true)}>Ajouter mon premier repas</button></div>}
      </section>
    </>}
  </div>
}

function QuantityInput({ itemId, mealId, quantity, onChange }: { readonly itemId: string; readonly mealId: string; readonly quantity: FoodQuantityInput; readonly onChange: (value: FoodQuantityInput) => void }) {
  const [amount, setAmount] = useState(quantity.amount)
  useEffect(() => setAmount(quantity.amount), [quantity.amount])
  const isMass = quantity.kind === 'physical' && (quantity.unit === 'g' || quantity.unit === 'kg')
  function changeAmount(value: string) {
    setAmount(value)
    const normalized = value.replace(',', '.')
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(normalized)) return
    try {
      if (decimalToFraction(parseDecimal(normalized)).numerator <= 0n) return
      onChange({ ...quantity, amount: normalized })
    } catch { /* Keep the edited text local until it becomes a valid exact decimal. */ }
  }
  return <div className="journal-quantity" data-item={itemId} data-meal={mealId}>
    <label>Quantité<input type="text" inputMode="decimal" value={amount} onChange={(event) => changeAmount(event.target.value)} onBlur={() => setAmount(quantity.amount)} aria-label="Quantité consommée"/></label>
    {quantity.kind === 'physical' && <label>Unité<select value={quantity.unit} onChange={(event) => {
      const unit = event.target.value
      if (unit === 'g') onChange({ kind: 'physical', amount, unit: 'g', weightNature: 'edible' })
      else onChange({ kind: 'physical', amount, unit: 'ml', weightNature: 'not-applicable' })
    }}><option value="g">g</option><option value="ml">ml</option></select></label>}
    {isMass && quantity.kind === 'physical' && <label>Poids<select value={quantity.weightNature} onChange={(event) => onChange({ ...quantity, weightNature: event.target.value as 'edible' | 'gross' | 'unknown' })}><option value="edible">Comestible</option><option value="gross">Brut</option><option value="unknown">Inconnu</option></select></label>}
  </div>
}
function FoodPicker({ onCancel, onSelect }: { readonly onCancel: () => void; readonly onSelect: (food: FoodNutritionSnapshot, quantity: FoodQuantityInput) => void }) {
  const [query, setQuery] = useState('')
  const [foods, setFoods] = useState<readonly SearchFood[]>([])
  const [detail, setDetail] = useState<FoodNutritionSnapshot | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [amount, setAmount] = useState('100')
  const [unit, setUnit] = useState<'g' | 'ml'>('g')
  const [nature, setNature] = useState<'edible' | 'gross' | 'unknown'>('edible')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function loadPage(requestedPage: number) {
    if (query.trim().length < 2) { setError('Saisissez au moins deux caractères.'); return }
    setBusy(true); setError('')
    try {
      const response = await requestFoodCatalog(`/api/foods/search?q=${encodeURIComponent(query.trim())}&page=${requestedPage}&pageSize=25`)
      if (!response.ok) throw new Error('La recherche USDA est indisponible.')
      const data = await response.json() as SearchResult
      setFoods(data.foods); setPage(data.currentPage); setTotalPages(data.totalPages); setDetail(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Recherche indisponible.') }
    finally { setBusy(false) }
  }
  async function choose(food: SearchFood) {
    setBusy(true); setError('')
    try {
      const response = await requestFoodCatalog(`/api/foods/${food.fdcId}`)
      if (!response.ok) throw new Error('La fiche USDA est indisponible.')
      const snapshot = uiFixtureMode ? getFixtureFoodSource(`usda:${food.fdcId}`) : usdaDetailToFoodSnapshot(await response.json() as FoodDetail)
      if (!snapshot) throw new Error('La fiche synthétique est introuvable.')
      setDetail(snapshot)
      const basis = snapshot.nutrients.find((datum) => datum.status === 'reported')?.basis
      if (basis) { setAmount(basis.amount); setUnit(basis.unit) }
      else { setAmount('100'); setUnit('g') }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Fiche indisponible.') }
    finally { setBusy(false) }
  }
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!detail) return
    const normalizedAmount = amount.replace(',', '.')
    const quantity: FoodQuantityInput = unit === 'g'
      ? { kind: 'physical', amount: normalizedAmount, unit: 'g', weightNature: nature }
      : { kind: 'physical', amount: normalizedAmount, unit: 'ml', weightNature: 'not-applicable' }
    onSelect(detail, quantity)
  }
  return <section className="journal-food-picker" aria-label="Rechercher un aliment">
    <form onSubmit={(event) => { event.preventDefault(); void loadPage(1) }}><label>Rechercher dans FoodData Central<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex. lentilles, œuf, poulet…" autoFocus/></label><button className="journal-primary" disabled={busy}>{busy ? 'Recherche…' : 'Rechercher'}</button><button type="button" className="journal-link" onClick={onCancel}>Fermer</button></form>
    {error && <p role="alert" className="journal-error">{error}</p>}
    {foods.length > 0 && <div className="journal-search-results" aria-busy={busy}>{foods.map((food) => <button type="button" key={food.fdcId} onClick={() => void choose(food)} disabled={busy}><b>{food.description}</b><small>{food.brandOwner ?? food.dataType ?? 'USDA'}</small></button>)}</div>}
    {totalPages > 1 && <div className="journal-pagination"><button type="button" disabled={page <= 1 || busy} onClick={() => void loadPage(page - 1)}>Précédent</button><span>Page {page} sur {totalPages}</span><button type="button" disabled={page >= totalPages || busy} onClick={() => void loadPage(page + 1)}>Suivant</button></div>}
    {detail && <form className="journal-food-detail" onSubmit={add}><div><b>{detail.description}</b><small>{detail.dataType ?? 'USDA'} · {detail.fdcId}</small></div><label>Quantité<input type="text" inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)}/></label><label>Unité<select value={unit} onChange={(event) => { const next = event.target.value as 'g' | 'ml'; setUnit(next); if (next === 'ml') setNature('edible') }}><option value="g">g</option><option value="ml">ml</option></select></label>{unit === 'g' && <label>Nature du poids<select value={nature} onChange={(event) => setNature(event.target.value as typeof nature)}><option value="edible">Comestible</option><option value="gross">Brut</option><option value="unknown">Inconnue</option></select></label>}<button className="journal-primary" type="submit">Ajouter au repas</button></form>}
  </section>
}

function calculateMealTotal(state: JournalState, dayId: string | undefined, mealId: string, sources: ReadonlyMap<string, FoodNutritionSnapshot>, code: DisplaySection): NutrientTotal | undefined {
  if (!dayId) return undefined
  try { return calculateJournalMeal(state, dayId, mealId, { foods: sources }).totals[code] } catch { return undefined }
}
function formatTotal(total: NutrientTotal | undefined, unit: string): string {
  if (!total) return 'Inconnu'
  const scale = unit === 'kcal' ? 0 : 1
  if (total.status === 'unknown') return 'Inconnu'
  const fraction = total.status === 'complete' ? total.exactValue : total.exactKnownSubtotal
  const value = fraction
    ? fractionToDecimal({ numerator: BigInt(fraction.numerator), denominator: BigInt(fraction.denominator) }, scale)
    : total.status === 'complete' ? total.value : total.knownSubtotal
  return total.status === 'partial' ? `≥ ${value} ${unit} · partiel` : `${value} ${unit}`
}
function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function localDateTimeInput(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 16)
}
function inputToInstant(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
function instantToInput(value: string | null, date: string): string {
  return value ? localDateTimeInput(new Date(value)) : `${date}T12:00`
}
function instantToLabel(value: string | null): string {
  return value ? new Intl.DateTimeFormat('fr-MA', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : 'Heure non définie'
}
function replaceSnapshot(snapshots: readonly ConfirmedMealSnapshot[], snapshot: ConfirmedMealSnapshot): readonly ConfirmedMealSnapshot[] {
  return [...snapshots.filter((item) => item.snapshotId !== snapshot.snapshotId), snapshot]
}

async function compressPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new TypeError('Image required')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Compression failed')), 'image/jpeg', 0.78))
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Read failed'))
    reader.onerror = () => reject(new Error('Read failed'))
    reader.readAsDataURL(blob)
  })
}
