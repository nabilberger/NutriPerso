import {
  assertFractionAtMost,
  compareFractions,
  decimalToFraction,
  divideFractions,
  isPositive,
  makeFraction,
  multiplyFractions,
  parseDecimal,
  type ExactFraction,
} from './decimal.ts'
import { aggregateNutrients } from './aggregate-nutrients.ts'
import { calculateFoodSnapshot, type FoodNutritionSnapshot } from './recipes.ts'
import type { ConfirmedRecipeSnapshot } from './recipe-snapshot.ts'
import { MAX_CONSUMED_QUANTITY } from './units.ts'
import {
  NutritionError,
  NUTRIENT_CODES,
  type CalculationUnknownReason,
  type CanonicalNutrientUnit,
  type ContributionOrigin,
  type ContributionProvenance,
  type MissingNutrientReason,
  type NutrientCode,
  type NutrientComponent,
  type NutrientContribution,
  type NutrientSource,
  type NutrientTotal,
} from './types.ts'
import type { FoodPortionEquivalence, FoodQuantityInput, ResolvedFoodQuantity } from './portions.ts'

export type MealKind = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'custom'

export type JournalItemDraft =
  | {
      readonly kind: 'food'
      readonly id: string
      readonly foodId: string
      readonly quantity: FoodQuantityInput
      readonly sortOrder: number
      /** Present on corrections to pin the exact source data used by the predecessor. */
      readonly pinnedFoodSnapshot?: FoodNutritionSnapshot
    }
  | {
      readonly kind: 'recipe'
      readonly id: string
      readonly recipeSnapshot: ConfirmedRecipeSnapshot
      readonly quantity: RecipeJournalQuantity
      readonly sortOrder: number
    }

export type RecipeJournalQuantity =
  | { readonly kind: 'servings'; readonly amount: string }
  | { readonly kind: 'weight'; readonly amount: string; readonly unit: 'g'; readonly weightNature: 'edible' }

export type MealDraft = {
  readonly id: string
  readonly dayId: string
  readonly revision: number
  readonly kind: MealKind
  readonly label: string | null
  readonly occurredAt: string | null
  readonly sortOrder: number
  readonly supersedesSnapshotId: string | null
  readonly items: readonly JournalItemDraft[]
}

export type JournalDayDraft = {
  readonly id: string
  readonly localDate: string
  readonly timeZone: string
  readonly revision: number
  readonly meals: readonly MealDraft[]
}

export type SerializedJournalContribution =
  | {
      readonly status: 'complete'
      readonly exactValue: { readonly numerator: string; readonly denominator: string }
      readonly unit: CanonicalNutrientUnit
      readonly source: NutrientSource
      readonly origin: ContributionOrigin
      readonly provenance?: ContributionProvenance
    }
  | {
      readonly status: 'partial'
      readonly exactKnownSubtotal: { readonly numerator: string; readonly denominator: string }
      readonly unit: CanonicalNutrientUnit
      readonly missing: readonly MissingNutrientReason[]
      readonly origin: ContributionOrigin
      readonly provenance: ContributionProvenance
    }
  | {
      readonly status: 'unknown'
      readonly reason: CalculationUnknownReason
      readonly unit: CanonicalNutrientUnit
      readonly source: NutrientSource | null
      readonly missing?: readonly MissingNutrientReason[]
      readonly origin: ContributionOrigin
      readonly provenance?: ContributionProvenance
    }

export type ConfirmedFoodJournalItem = {
  readonly kind: 'food'
  readonly id: string
  readonly foodId: string
  readonly foodSnapshot: FoodNutritionSnapshot
  readonly enteredQuantity: FoodQuantityInput
  readonly resolvedQuantity: SerializedResolvedFoodQuantity
  readonly contributions: Partial<Record<NutrientCode, SerializedJournalContribution>>
  readonly sortOrder: number
}

export type ConfirmedRecipeJournalItem = {
  readonly kind: 'recipe'
  readonly id: string
  readonly recipeSnapshot: ConfirmedRecipeSnapshot
  readonly quantity: RecipeJournalQuantity
  readonly multiplier: { readonly numerator: string; readonly denominator: string }
  readonly allocationAssumption: 'homogeneous-preparation' | null
  readonly contributions: Partial<Record<NutrientCode, SerializedJournalContribution>>
  readonly sortOrder: number
}

export type ConfirmedJournalItem = ConfirmedFoodJournalItem | ConfirmedRecipeJournalItem

export type SerializedResolvedFoodQuantity =
  | {
      readonly status: 'resolved'
      readonly numerator: string
      readonly denominator: string
      readonly unit: 'g' | 'ml'
      readonly weightNature: 'edible' | 'gross' | 'unknown' | 'not-applicable'
      readonly edibleNumerator: string | null
      readonly edibleDenominator: string | null
      readonly equivalenceSnapshot: FoodPortionEquivalence | null
    }
  | { readonly status: 'unknown'; readonly reason: string; readonly equivalenceId: string }

type MealSnapshotBase = {
  readonly snapshotId: string
  readonly logicalMealId: string
  readonly revision: number
  readonly supersedesSnapshotId: string | null
  readonly dayId: string
  readonly localDate: string
  readonly timeZone: string
  readonly mealKind: MealKind
  readonly label: string | null
  readonly occurredAt: string | null
  readonly sortOrder: number
  readonly mealRevision: number
  readonly dayRevision: number
  readonly confirmedAt: string
  readonly engineVersion: string
}

export type ConfirmedMealSnapshot = MealSnapshotBase & (
  | {
      readonly status: 'confirmed'
      readonly items: readonly ConfirmedJournalItem[]
      readonly totals: Partial<Record<NutrientCode, NutrientTotal>>
    }
  | {
      readonly status: 'void'
      readonly items: readonly []
      readonly totals: readonly []
      readonly voidReason: 'cancelled'
    }
)

export type JournalState = {
  readonly days: readonly JournalDayDraft[]
  readonly snapshots: readonly ConfirmedMealSnapshot[]
}

export type JournalCalculationSources = {
  readonly foods: ReadonlyMap<string, FoodNutritionSnapshot>
}

export type JournalMealCalculation = {
  readonly dayId: string
  readonly dayRevision: number
  readonly mealId: string
  readonly mealRevision: number
  readonly items: readonly {
    readonly item: ConfirmedJournalItem
    readonly contributions: Partial<Record<NutrientCode, NutrientContribution>>
  }[]
  readonly totals: Partial<Record<NutrientCode, NutrientTotal>>
}

export type ConfirmMealResult = {
  readonly state: JournalState
  readonly snapshot: ConfirmedMealSnapshot
  readonly calculation: JournalMealCalculation
}

export function createJournalState(): JournalState {
  return { days: [], snapshots: [] }
}

export function createJournalDay(
  state: JournalState,
  input: { readonly id: string; readonly localDate: string; readonly timeZone: string },
): JournalState {
  if (!input.id.trim() || state.days.some((day) => day.id === input.id)) throw new NutritionError('INVALID_JOURNAL', 'Identifiant de journée vide ou déjà utilisé.')
  validateLocalDateAndTimeZone(input.localDate, input.timeZone)
  return { ...state, days: [...state.days, { ...input, revision: 1, meals: [] }] }
}

export function createMeal(
  state: JournalState,
  dayId: string,
  input: { readonly id: string; readonly kind: MealKind; readonly label?: string | null; readonly occurredAt?: string | null; readonly sortOrder?: number },
): JournalState {
  const day = requireDay(state, dayId)
  if (!input.id.trim() || hasLogicalMeal(state, input.id) || !Number.isInteger(input.sortOrder ?? day.meals.length)) {
    throw new NutritionError('INVALID_JOURNAL', 'Identifiant de repas invalide ou déjà utilisé.')
  }
  const occurredAt = normalizeOccurredAt(input.occurredAt ?? null, day.localDate, day.timeZone)
  const meal: MealDraft = {
    id: input.id, dayId, revision: 1, kind: input.kind, label: input.label ?? null,
    occurredAt, sortOrder: input.sortOrder ?? day.meals.length, supersedesSnapshotId: null, items: [],
  }
  return replaceDay(state, { ...day, revision: day.revision + 1, meals: sortMeals([...day.meals, meal]) })
}

export function addFoodJournalItem(
  state: JournalState,
  dayId: string,
  mealId: string,
  item: Omit<Extract<JournalItemDraft, { kind: 'food' }>, 'kind'>,
): JournalState {
  assertNewItemId(state, item.id)
  return updateMeal(state, dayId, mealId, (meal) => ({
    ...meal,
    items: sortItems([...meal.items, clonePlain({ ...item, kind: 'food' as const })]),
  }))
}

export function addRecipeJournalItem(
  state: JournalState,
  dayId: string,
  mealId: string,
  item: Omit<Extract<JournalItemDraft, { kind: 'recipe' }>, 'kind'>,
): JournalState {
  assertNewItemId(state, item.id)
  if (item.recipeSnapshot.schemaVersion !== '1' || !item.recipeSnapshot.snapshotId) {
    throw new NutritionError('JOURNAL_SOURCE_NOT_FOUND', 'La référence doit être un snapshot de recette confirmé valide.')
  }
  return updateMeal(state, dayId, mealId, (meal) => ({
    ...meal,
    items: sortItems([...meal.items, clonePlain({ ...item, kind: 'recipe' as const })]),
  }))
}

export function setFoodJournalItemQuantity(state: JournalState, dayId: string, mealId: string, itemId: string, quantity: FoodQuantityInput): JournalState {
  return updateItem(state, dayId, mealId, itemId, 'food', (item) => ({ ...item, quantity: clonePlain(quantity) }))
}

export function setRecipeJournalItemQuantity(state: JournalState, dayId: string, mealId: string, itemId: string, quantity: RecipeJournalQuantity): JournalState {
  return updateItem(state, dayId, mealId, itemId, 'recipe', (item) => ({ ...item, quantity: clonePlain(quantity) }))
}

export function replaceFoodReference(
  state: JournalState,
  dayId: string,
  mealId: string,
  itemId: string,
  replacement: { readonly foodId: string; readonly quantity: FoodQuantityInput },
): JournalState {
  if (!replacement.foodId.trim()) throw new NutritionError('INVALID_JOURNAL', 'La référence aliment ne peut pas être vide.')
  return updateItem(state, dayId, mealId, itemId, 'food', (item) => ({
    kind: 'food', id: item.id, foodId: replacement.foodId, quantity: clonePlain(replacement.quantity), sortOrder: item.sortOrder,
  }))
}

export function replaceRecipeReference(
  state: JournalState,
  dayId: string,
  mealId: string,
  itemId: string,
  replacement: { readonly recipeSnapshot: ConfirmedRecipeSnapshot; readonly quantity: RecipeJournalQuantity },
): JournalState {
  return updateItem(state, dayId, mealId, itemId, 'recipe', (item) => ({
    kind: 'recipe', id: item.id, recipeSnapshot: clonePlain(replacement.recipeSnapshot),
    quantity: clonePlain(replacement.quantity), sortOrder: item.sortOrder,
  }))
}

export function moveJournalItem(state: JournalState, sourceMealId: string, targetMealId: string, itemId: string, sortOrder: number): JournalState {
  if (!Number.isInteger(sortOrder) || sortOrder < 0) throw new NutritionError('INVALID_JOURNAL', 'Ordre d’élément invalide.')
  const source = findMeal(state, sourceMealId)
  const target = findMeal(state, targetMealId)
  if (source.dayId !== target.dayId) throw new NutritionError('INVALID_JOURNAL', 'Un élément ne peut être déplacé qu’entre repas de la même journée.')
  const item = source.items.find((candidate) => candidate.id === itemId)
  if (!item) throw new NutritionError('JOURNAL_ITEM_NOT_FOUND', 'Élément de repas introuvable.')
  const day = requireDay(state, source.dayId)
  const sourceUpdated: MealDraft = { ...source, revision: source.revision + 1, items: sortItems(source.items.filter((candidate) => candidate.id !== itemId)) }
  const targetItems = sourceMealId === targetMealId
    ? insertAt(sourceUpdated.items, { ...item, sortOrder }, sortOrder)
    : insertAt(target.items, { ...item, sortOrder }, sortOrder)
  const meals = day.meals.map((meal) => {
    if (sourceMealId === targetMealId && meal.id === sourceMealId) return { ...sourceUpdated, items: targetItems }
    if (meal.id === sourceMealId) return sourceUpdated
    if (meal.id === targetMealId) return { ...target, revision: target.revision + 1, items: targetItems }
    return meal
  })
  return replaceDay(state, { ...day, revision: day.revision + 1, meals })
}

export function removeJournalItem(state: JournalState, dayId: string, mealId: string, itemId: string): JournalState {
  return updateMeal(state, dayId, mealId, (meal) => {
    if (!meal.items.some((item) => item.id === itemId)) throw new NutritionError('JOURNAL_ITEM_NOT_FOUND', 'Élément de repas introuvable.')
    return { ...meal, items: sortItems(meal.items.filter((item) => item.id !== itemId)) }
  })
}

export function setMealOccurredAt(state: JournalState, dayId: string, mealId: string, occurredAt: string | null): JournalState {
  const day = requireDay(state, dayId)
  const normalized = normalizeOccurredAt(occurredAt, day.localDate, day.timeZone)
  return updateMeal(state, dayId, mealId, (meal) => ({ ...meal, occurredAt: normalized }))
}

export function updateJournalDayContext(state: JournalState, dayId: string, localDate: string, timeZone: string): JournalState {
  const day = requireDay(state, dayId)
  validateLocalDateAndTimeZone(localDate, timeZone)
  const meals = day.meals.map((meal) => ({
    ...meal,
    revision: meal.revision + 1,
    occurredAt: normalizeOccurredAt(meal.occurredAt, localDate, timeZone),
  }))
  return replaceDay(state, { ...day, localDate, timeZone, revision: day.revision + 1, meals })
}

export function calculateJournalMeal(state: JournalState, dayId: string, mealId: string, sources: JournalCalculationSources): JournalMealCalculation {
  const day = requireDay(state, dayId)
  const meal = requireMeal(day, mealId)
  const items = meal.items.map((item) => calculateJournalItem(item, sources))
  const components: NutrientComponent[] = items.map((item) => ({ itemId: item.snapshotItem.id, nutrients: item.contributions }))
  return {
    dayId, dayRevision: day.revision, mealId, mealRevision: meal.revision,
    items: items.map(({ snapshotItem, contributions }) => ({ item: snapshotItem, contributions })),
    totals: aggregateNutrients(components, NUTRIENT_CODES, { includeExact: true }),
  }
}

/** Confirmation recalculates synchronously from the current draft; it never accepts a stale preview. */
export function confirmMeal(
  state: JournalState,
  dayId: string,
  mealId: string,
  sources: JournalCalculationSources,
  input: { readonly snapshotId: string; readonly confirmedAt: string; readonly engineVersion: string },
): ConfirmMealResult {
  const day = requireDay(state, dayId)
  const meal = requireMeal(day, mealId)
  if (!input.snapshotId.trim() || !input.engineVersion.trim() || !Number.isFinite(Date.parse(input.confirmedAt))) {
    throw new NutritionError('INVALID_JOURNAL', 'Identifiant de snapshot, date de confirmation et version moteur requis.')
  }
  if (state.snapshots.some((snapshot) => snapshot.snapshotId === input.snapshotId)) throw new NutritionError('DUPLICATE_SNAPSHOT', 'Identifiant de snapshot déjà utilisé.')
  validateSnapshotHistory(state.snapshots)
  const predecessor = activeSnapshotFor(state.snapshots, meal.id)
  if (meal.supersedesSnapshotId === null ? predecessor !== null : predecessor?.snapshotId !== meal.supersedesSnapshotId) {
    throw new NutritionError('JOURNAL_HISTORY_CONFLICT', 'Le prédécesseur du brouillon n’est plus la version active du repas.')
  }

  const calculation = calculateJournalMeal(state, dayId, mealId, sources)
  const snapshot: ConfirmedMealSnapshot = {
    snapshotId: input.snapshotId,
    logicalMealId: meal.id,
    revision: predecessor ? predecessor.revision + 1 : 1,
    supersedesSnapshotId: predecessor?.snapshotId ?? null,
    dayId,
    localDate: day.localDate,
    timeZone: day.timeZone,
    mealKind: meal.kind,
    label: meal.label,
    occurredAt: meal.occurredAt,
    sortOrder: meal.sortOrder,
    mealRevision: meal.revision,
    dayRevision: day.revision,
    confirmedAt: normalizeInstant(input.confirmedAt),
    engineVersion: input.engineVersion,
    status: 'confirmed',
    items: calculation.items.map((entry) => entry.item),
    totals: calculation.totals,
  }
  const meals = day.meals.filter((candidate) => candidate.id !== mealId)
  const immutableSnapshot = deepFreeze(clonePlain(snapshot))
  const nextState: JournalState = {
    days: state.days.map((candidate) => candidate.id === dayId ? { ...day, revision: day.revision + 1, meals } : candidate),
    snapshots: [...state.snapshots, immutableSnapshot],
  }
  validateSnapshotHistory(nextState.snapshots)
  return { state: nextState, snapshot: immutableSnapshot, calculation }
}

/** Creates a draft correction pinned to the source snapshots used by the confirmed predecessor. */
export function createMealCorrectionDraft(state: JournalState, snapshotId: string, newDayId?: string): JournalState {
  validateSnapshotHistory(state.snapshots)
  const predecessor = state.snapshots.find((snapshot) => snapshot.snapshotId === snapshotId)
  if (!predecessor || predecessor.status !== 'confirmed' || activeSnapshotFor(state.snapshots, predecessor.logicalMealId)?.snapshotId !== snapshotId) {
    throw new NutritionError('JOURNAL_HISTORY_CONFLICT', 'Une correction doit partir du snapshot confirmé actuellement actif.')
  }
  if (hasDraftMeal(state, predecessor.logicalMealId)) throw new NutritionError('JOURNAL_HISTORY_CONFLICT', 'Un brouillon existe déjà pour ce repas logique.')
  const dayId = newDayId ?? predecessor.dayId
  const day = requireDay(state, dayId)
  const items: JournalItemDraft[] = predecessor.items.map((item) => item.kind === 'food'
    ? {
        kind: 'food', id: item.id, foodId: item.foodId, quantity: clonePlain(item.enteredQuantity),
        pinnedFoodSnapshot: clonePlain(item.foodSnapshot), sortOrder: item.sortOrder,
      }
    : {
        kind: 'recipe', id: item.id, recipeSnapshot: clonePlain(item.recipeSnapshot),
        quantity: clonePlain(item.quantity), sortOrder: item.sortOrder,
      })
  const draft: MealDraft = {
    id: predecessor.logicalMealId, dayId, revision: predecessor.mealRevision + 1,
    kind: predecessor.mealKind, label: predecessor.label,
    occurredAt: normalizeOccurredAt(predecessor.occurredAt, day.localDate, day.timeZone),
    sortOrder: predecessor.sortOrder, supersedesSnapshotId: predecessor.snapshotId, items,
  }
  return replaceDay(state, { ...day, revision: day.revision + 1, meals: sortMeals([...day.meals, draft]) })
}

/** Appends a void successor. It preserves its predecessor and contributes nothing to statistics. */
export function cancelConfirmedMeal(
  state: JournalState,
  snapshotId: string,
  input: { readonly newSnapshotId: string; readonly confirmedAt: string; readonly engineVersion: string },
): { readonly state: JournalState; readonly snapshot: ConfirmedMealSnapshot } {
  validateSnapshotHistory(state.snapshots)
  const predecessor = state.snapshots.find((snapshot) => snapshot.snapshotId === snapshotId)
  if (!predecessor || predecessor.status !== 'confirmed' || activeSnapshotFor(state.snapshots, predecessor.logicalMealId)?.snapshotId !== snapshotId) {
    throw new NutritionError('JOURNAL_HISTORY_CONFLICT', 'Seul le snapshot confirmé actif peut être annulé.')
  }
  if (!input.newSnapshotId.trim() || state.snapshots.some((snapshot) => snapshot.snapshotId === input.newSnapshotId)) {
    throw new NutritionError('DUPLICATE_SNAPSHOT', 'Identifiant du snapshot d’annulation vide ou déjà utilisé.')
  }
  if (!input.engineVersion.trim() || !Number.isFinite(Date.parse(input.confirmedAt))) throw new NutritionError('INVALID_JOURNAL', 'Date ou version moteur invalide.')
  const snapshot: ConfirmedMealSnapshot = {
    snapshotId: input.newSnapshotId,
    logicalMealId: predecessor.logicalMealId,
    revision: predecessor.revision + 1,
    supersedesSnapshotId: predecessor.snapshotId,
    dayId: predecessor.dayId,
    localDate: predecessor.localDate,
    timeZone: predecessor.timeZone,
    mealKind: predecessor.mealKind,
    label: predecessor.label,
    occurredAt: predecessor.occurredAt,
    sortOrder: predecessor.sortOrder,
    mealRevision: predecessor.mealRevision + 1,
    dayRevision: predecessor.dayRevision,
    confirmedAt: normalizeInstant(input.confirmedAt),
    engineVersion: input.engineVersion,
    status: 'void',
    items: [],
    totals: [],
    voidReason: 'cancelled',
  }
  const immutableSnapshot = deepFreeze(clonePlain(snapshot))
  const nextState = { ...state, snapshots: [...state.snapshots, immutableSnapshot] }
  validateSnapshotHistory(nextState.snapshots)
  return { state: nextState, snapshot: immutableSnapshot }
}

export function selectActiveMealSnapshots(snapshots: readonly ConfirmedMealSnapshot[]): readonly ConfirmedMealSnapshot[] {
  validateSnapshotHistory(snapshots)
  const superseded = new Set(snapshots.flatMap((snapshot) => snapshot.supersedesSnapshotId ? [snapshot.supersedesSnapshotId] : []))
  return snapshots.filter((snapshot) => snapshot.status === 'confirmed' && !superseded.has(snapshot.snapshotId))
}

export function calculateJournalDay(state: JournalState, dayId: string): Partial<Record<NutrientCode, NutrientTotal>> {
  const day = requireDay(state, dayId)
  const activeForDay = selectActiveMealSnapshots(state.snapshots)
    .filter((snapshot) => snapshot.dayId === dayId && snapshot.localDate === day.localDate && snapshot.timeZone === day.timeZone)
  const components: NutrientComponent[] = activeForDay.flatMap((snapshot) => snapshot.items.map((item) => ({
    itemId: `${snapshot.snapshotId}/${item.id}`,
    nutrients: Object.fromEntries(Object.entries(item.contributions).flatMap(([rawCode, contribution]) => {
      if (!contribution) return []
      return [[rawCode, hydrateContribution(contribution, rawCode as NutrientCode)]]
    })) as NutrientComponent['nutrients'],
  })))
  return aggregateNutrients(components, NUTRIENT_CODES, { includeExact: true })
}

export function validateSnapshotHistory(snapshots: readonly ConfirmedMealSnapshot[]): void {
  const byId = new Map<string, ConfirmedMealSnapshot>()
  const roots = new Map<string, number>()
  const childCount = new Map<string, number>()
  const revisions = new Set<string>()
  for (const snapshot of snapshots) {
    if (!snapshot.snapshotId || byId.has(snapshot.snapshotId)) throw new NutritionError('JOURNAL_HISTORY_INVALID', 'Identifiant de snapshot absent ou dupliqué.')
    byId.set(snapshot.snapshotId, snapshot)
    if (snapshot.supersedesSnapshotId !== null) {
      const childCountForPredecessor = (childCount.get(snapshot.supersedesSnapshotId) ?? 0) + 1
      if (childCountForPredecessor > 1) throw new NutritionError('JOURNAL_HISTORY_CONFLICT', 'Deux snapshots remplacent le même prédécesseur.')
      childCount.set(snapshot.supersedesSnapshotId, childCountForPredecessor)
    }
    const revisionKey = `${snapshot.logicalMealId}:${snapshot.revision}`
    if (revisions.has(revisionKey) || !Number.isInteger(snapshot.revision) || snapshot.revision < 1) throw new NutritionError('JOURNAL_HISTORY_INVALID', 'Révision de snapshot absente ou dupliquée.')
    revisions.add(revisionKey)
    if (snapshot.supersedesSnapshotId === null) roots.set(snapshot.logicalMealId, (roots.get(snapshot.logicalMealId) ?? 0) + 1)
  }
  for (const [logicalMealId, count] of roots) {
    if (count !== 1) throw new NutritionError('JOURNAL_HISTORY_INVALID', `La chaîne de ${logicalMealId} doit avoir exactement une racine.`)
  }
  for (const [predecessorId, count] of childCount) {
    if (count > 1) throw new NutritionError('JOURNAL_HISTORY_CONFLICT', 'Deux snapshots remplacent le même prédécesseur.')
    const predecessor = byId.get(predecessorId)
    if (!predecessor) throw new NutritionError('JOURNAL_HISTORY_INVALID', 'Snapshot prédécesseur introuvable.')
  }
  for (const snapshot of snapshots) {
    if (snapshot.supersedesSnapshotId === null) {
      if (snapshot.revision !== 1) throw new NutritionError('JOURNAL_HISTORY_INVALID', 'La racine de la chaîne doit être en révision 1.')
      continue
    }
    const predecessor = byId.get(snapshot.supersedesSnapshotId)
    if (!predecessor || predecessor.logicalMealId !== snapshot.logicalMealId || snapshot.revision !== predecessor.revision + 1) {
      throw new NutritionError('JOURNAL_HISTORY_INVALID', 'Les identifiants ou révisions de la chaîne ne sont pas cohérents.')
    }
  }
}

function calculateJournalItem(item: JournalItemDraft, sources: JournalCalculationSources): {
  snapshotItem: ConfirmedJournalItem
  contributions: Partial<Record<NutrientCode, NutrientContribution>>
} {
  if (item.kind === 'food') {
    const source = item.pinnedFoodSnapshot ?? sources.foods.get(item.foodId)
    if (!source || source.foodId !== item.foodId) throw new NutritionError('JOURNAL_SOURCE_NOT_FOUND', `Snapshot alimentaire introuvable: ${item.foodId}`)
    const foodSnapshot = clonePlain(source)
    const calculation = calculateFoodSnapshot(foodSnapshot, item.quantity)
    const origin: ContributionOrigin = { kind: 'food-snapshot', foodId: item.foodId, snapshotId: foodSnapshot.sourceReference ?? foodSnapshot.foodId }
    const contributions = withOrigin(calculation.contributions, origin)
    const snapshotItem: ConfirmedFoodJournalItem = {
      kind: 'food', id: item.id, foodId: item.foodId, foodSnapshot,
      enteredQuantity: clonePlain(item.quantity),
      resolvedQuantity: serializeResolvedQuantity(calculation.resolvedQuantity, calculation.equivalenceSnapshot),
      contributions: serializeContributions(contributions), sortOrder: item.sortOrder,
    }
    return { snapshotItem, contributions }
  }

  const multiplier = recipeQuantityMultiplier(item.recipeSnapshot, item.quantity)
  const origin: ContributionOrigin = {
    kind: 'recipe-snapshot', recipeId: item.recipeSnapshot.recipe.id,
    snapshotId: item.recipeSnapshot.snapshotId, recipeVersion: item.recipeSnapshot.recipe.revision,
  }
  const provenance = recipeProvenance(item.recipeSnapshot, origin)
  const contributions: Partial<Record<NutrientCode, NutrientContribution>> = {}
  for (const total of item.recipeSnapshot.referenceTotals) {
    if (total.status === 'complete') {
      const exactValue = multiplyFractions(makeFraction(BigInt(required(total.exactNumerator)), BigInt(required(total.exactDenominator))), multiplier)
      const representativeSource = provenance.sources[0]
      if (!representativeSource) throw new NutritionError('JOURNAL_SOURCE_NOT_FOUND', 'La provenance d’un total de recette est absente.')
      contributions[total.code] = { status: 'complete', code: total.code, exactValue, unit: total.unit, source: representativeSource, origin, provenance }
    } else if (total.status === 'partial') {
      const exactKnownSubtotal = multiplyFractions(makeFraction(BigInt(required(total.exactNumerator)), BigInt(required(total.exactDenominator))), multiplier)
      contributions[total.code] = {
        status: 'partial', code: total.code, exactKnownSubtotal, unit: total.unit,
        missing: total.missing, origin, provenance,
      }
    } else {
      const firstMissing = total.missing[0]
      contributions[total.code] = {
        status: 'unknown', code: total.code, unit: total.unit,
        reason: firstMissing?.reason ?? 'nutrient-not-reported', origin, provenance,
        missing: total.missing,
      }
    }
  }
  const snapshotItem: ConfirmedRecipeJournalItem = {
    kind: 'recipe', id: item.id, recipeSnapshot: clonePlain(item.recipeSnapshot), quantity: clonePlain(item.quantity),
    multiplier: { numerator: multiplier.numerator.toString(), denominator: multiplier.denominator.toString() },
    allocationAssumption: item.quantity.kind === 'weight' ? 'homogeneous-preparation' : null,
    contributions: serializeContributions(contributions), sortOrder: item.sortOrder,
  }
  return { snapshotItem, contributions }
}

function recipeQuantityMultiplier(snapshot: ConfirmedRecipeSnapshot, quantity: RecipeJournalQuantity): ExactFraction {
  if (quantity.kind === 'servings') {
    const consumed = positiveDecimal(quantity.amount, 'Le nombre de portions consommées doit être positif.')
    assertFractionAtMost(consumed, MAX_CONSUMED_QUANTITY)
    const baseAmount = snapshot.recipe.servings
    if (!baseAmount) throw new NutritionError('INVALID_RECIPE_ALLOCATION', 'Ce snapshot ne définit pas de nombre de portions de référence.')
    const base = positiveDecimal(baseAmount, 'Le nombre de portions de référence doit être positif.')
    return divideFractions(consumed, base)
  }
  const consumed = positiveDecimal(quantity.amount, 'Le poids consommé doit être positif.')
  assertFractionAtMost(consumed, MAX_CONSUMED_QUANTITY)
  const finalWeight = snapshot.recipe.finalWeight
  if (!finalWeight || finalWeight.weightNature !== 'edible' || finalWeight.unit !== 'g') {
    throw new NutritionError('INVALID_RECIPE_ALLOCATION', 'Le snapshot doit contenir un poids final comestible mesuré en grammes.')
  }
  const final = positiveDecimal(finalWeight.amount, 'Le poids final comestible doit être positif.')
  assertFractionAtMost(final, MAX_CONSUMED_QUANTITY)
  if (compareFractions(consumed, final) > 0) throw new NutritionError('INVALID_RECIPE_ALLOCATION', 'Le poids consommé ne peut dépasser le poids final.')
  return divideFractions(consumed, final)
}

function recipeProvenance(snapshot: ConfirmedRecipeSnapshot, origin: ContributionOrigin): ContributionProvenance {
  const sources = new Map<string, NutrientSource>()
  for (const ingredient of snapshot.ingredients) {
    for (const nutrient of ingredient.sourceNutrients) {
      if (nutrient.status !== 'reported') continue
      const source = nutrient.source
      const key = `${source.sourceType}/${source.sourceName}/${source.sourceReference}/${source.nutrientSourceId}`
      sources.set(key, source)
    }
  }
  return { sources: [...sources.values()], origins: [origin] }
}

function withOrigin(
  contributions: Partial<Record<NutrientCode, NutrientContribution>>,
  origin: ContributionOrigin,
): Partial<Record<NutrientCode, NutrientContribution>> {
  const result: Partial<Record<NutrientCode, NutrientContribution>> = {}
  for (const [rawCode, contribution] of Object.entries(contributions)) {
    if (!contribution) continue
    const code = rawCode as NutrientCode
    if (contribution.status === 'complete') {
      result[code] = { ...contribution, origin, provenance: { sources: [contribution.source], origins: [origin] } }
    } else if (contribution.status === 'partial') {
      result[code] = { ...contribution, origin, provenance: { ...contribution.provenance, origins: [...contribution.provenance.origins, origin] } }
    } else {
      result[code] = { ...contribution, origin }
    }
  }
  return result
}

function positiveDecimal(value: string, message: string): ExactFraction {
  const result = decimalToFraction(parseDecimal(value))
  if (!isPositive(result)) throw new NutritionError('INVALID_JOURNAL', message)
  return result
}

function required(value: string | null): string {
  if (value === null) throw new NutritionError('JOURNAL_SOURCE_NOT_FOUND', 'Le snapshot ne contient pas la fraction exacte requise.')
  return value
}

function updateItem<K extends JournalItemDraft['kind']>(
  state: JournalState,
  dayId: string,
  mealId: string,
  itemId: string,
  kind: K,
  update: (item: Extract<JournalItemDraft, { kind: K }>) => Extract<JournalItemDraft, { kind: K }>,
): JournalState {
  return updateMeal(state, dayId, mealId, (meal) => {
    let found = false
    const items = meal.items.map((item) => {
      if (item.id !== itemId) return item
      if (item.kind !== kind) throw new NutritionError('INVALID_JOURNAL', 'L’opération ne correspond pas au type de l’élément.')
      found = true
      return update(item as Extract<JournalItemDraft, { kind: K }>)
    })
    if (!found) throw new NutritionError('JOURNAL_ITEM_NOT_FOUND', 'Élément de repas introuvable.')
    return { ...meal, items: sortItems(items) }
  })
}

function updateMeal(state: JournalState, dayId: string, mealId: string, update: (meal: MealDraft) => MealDraft): JournalState {
  const day = requireDay(state, dayId)
  const meal = requireMeal(day, mealId)
  const updated = { ...update(meal), revision: meal.revision + 1 }
  return replaceDay(state, { ...day, revision: day.revision + 1, meals: sortMeals(day.meals.map((item) => item.id === mealId ? updated : item)) })
}

function replaceDay(state: JournalState, updated: JournalDayDraft): JournalState {
  return { ...state, days: state.days.map((day) => day.id === updated.id ? updated : day) }
}

function requireDay(state: JournalState, dayId: string): JournalDayDraft {
  const day = state.days.find((item) => item.id === dayId)
  if (!day) throw new NutritionError('JOURNAL_DAY_NOT_FOUND', `Journée introuvable: ${dayId}`)
  return day
}

function requireMeal(day: JournalDayDraft, mealId: string): MealDraft {
  const meal = day.meals.find((item) => item.id === mealId)
  if (!meal) throw new NutritionError('JOURNAL_MEAL_NOT_FOUND', `Repas introuvable: ${mealId}`)
  return meal
}

function findMeal(state: JournalState, mealId: string): MealDraft {
  for (const day of state.days) {
    const meal = day.meals.find((candidate) => candidate.id === mealId)
    if (meal) return meal
  }
  throw new NutritionError('JOURNAL_MEAL_NOT_FOUND', `Repas introuvable: ${mealId}`)
}

function assertNewItemId(state: JournalState, itemId: string): void {
  if (!itemId.trim() || state.days.some((day) => day.meals.some((meal) => meal.items.some((item) => item.id === itemId)))) {
    throw new NutritionError('INVALID_JOURNAL', 'Identifiant d’élément vide ou déjà utilisé.')
  }
}

function hasLogicalMeal(state: JournalState, logicalMealId: string): boolean {
  return state.days.some((day) => day.meals.some((meal) => meal.id === logicalMealId))
    || state.snapshots.some((snapshot) => snapshot.logicalMealId === logicalMealId)
}

function hasDraftMeal(state: JournalState, logicalMealId: string): boolean {
  return state.days.some((day) => day.meals.some((meal) => meal.id === logicalMealId))
}

function activeSnapshotFor(snapshots: readonly ConfirmedMealSnapshot[], logicalMealId: string): ConfirmedMealSnapshot | null {
  const active = selectActiveMealSnapshots(snapshots).filter((snapshot) => snapshot.logicalMealId === logicalMealId)
  if (active.length > 1) throw new NutritionError('JOURNAL_HISTORY_INVALID', 'Plusieurs snapshots actifs pour le même repas logique.')
  return active[0] ?? null
}

function sortMeals(meals: readonly MealDraft[]): readonly MealDraft[] {
  return [...meals].sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
}

function sortItems(items: readonly JournalItemDraft[]): readonly JournalItemDraft[] {
  return [...items].sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
}

function insertAt(items: readonly JournalItemDraft[], item: JournalItemDraft, sortOrder: number): readonly JournalItemDraft[] {
  const ordered = sortItems(items.filter((candidate) => candidate.id !== item.id))
  const index = Math.min(sortOrder, ordered.length)
  const result = [...ordered]
  result.splice(index, 0, { ...item, sortOrder: index })
  return result.map((candidate, position) => ({ ...candidate, sortOrder: position }))
}

function serializeResolvedQuantity(resolved: ResolvedFoodQuantity, equivalenceSnapshot: FoodPortionEquivalence | null): SerializedResolvedFoodQuantity {
  if (resolved.status === 'unknown') return { status: 'unknown', reason: resolved.reason, equivalenceId: resolved.equivalenceId }
  return {
    status: 'resolved', numerator: resolved.exactAmount.numerator.toString(), denominator: resolved.exactAmount.denominator.toString(),
    unit: resolved.unit, weightNature: resolved.weightNature,
    edibleNumerator: resolved.edibleAmount?.numerator.toString() ?? null,
    edibleDenominator: resolved.edibleAmount?.denominator.toString() ?? null,
    equivalenceSnapshot: resolved.equivalenceSnapshot ?? equivalenceSnapshot ?? null,
  }
}

function serializeContributions(contributions: Partial<Record<NutrientCode, NutrientContribution>>): Partial<Record<NutrientCode, SerializedJournalContribution>> {
  const output: Partial<Record<NutrientCode, SerializedJournalContribution>> = {}
  for (const [rawCode, contribution] of Object.entries(contributions)) {
    if (!contribution) continue
    const code = rawCode as NutrientCode
    if (contribution.status === 'complete') {
      const origin = contribution.origin ?? {
        kind: 'food-snapshot' as const,
        foodId: contribution.source.sourceName ?? 'unknown',
        snapshotId: contribution.source.sourceReference ?? 'unknown',
      }
      output[code] = {
        status: 'complete', exactValue: serializeFraction(contribution.exactValue), unit: contribution.unit,
        source: contribution.source, origin,
        ...(contribution.provenance ? { provenance: contribution.provenance } : {}),
      }
    } else if (contribution.status === 'partial') {
      output[code] = {
        status: 'partial', exactKnownSubtotal: serializeFraction(contribution.exactKnownSubtotal), unit: contribution.unit,
        missing: contribution.missing, origin: contribution.origin, provenance: contribution.provenance,
      }
    } else {
      const origin = contribution.origin ?? {
        kind: 'food-snapshot' as const,
        foodId: contribution.source?.sourceName ?? 'unknown',
        snapshotId: contribution.source?.sourceReference ?? 'unknown',
      }
      output[code] = {
        status: 'unknown', reason: contribution.reason, unit: contribution.unit, source: contribution.source ?? null,
        ...(contribution.missing ? { missing: contribution.missing } : {}),
        origin, ...(contribution.provenance ? { provenance: contribution.provenance } : {}),
      }
    }
  }
  return output
}

function hydrateContribution(contribution: SerializedJournalContribution, code: NutrientCode): NutrientContribution {
  if (contribution.status === 'complete') return {
    status: 'complete', code, exactValue: hydrateFraction(contribution.exactValue), unit: contribution.unit,
    source: contribution.source, origin: contribution.origin,
    ...(contribution.provenance ? { provenance: contribution.provenance } : {}),
  }
  if (contribution.status === 'partial') return {
    status: 'partial', code, exactKnownSubtotal: hydrateFraction(contribution.exactKnownSubtotal), unit: contribution.unit,
    missing: contribution.missing, origin: contribution.origin, provenance: contribution.provenance,
  }
  return {
    status: 'unknown', code, reason: contribution.reason, unit: contribution.unit,
    ...(contribution.source ? { source: contribution.source } : {}), origin: contribution.origin,
    ...(contribution.missing ? { missing: contribution.missing } : {}),
    ...(contribution.provenance ? { provenance: contribution.provenance } : {}),
  }
}

function serializeFraction(value: ExactFraction): { readonly numerator: string; readonly denominator: string } {
  return { numerator: value.numerator.toString(), denominator: value.denominator.toString() }
}

function hydrateFraction(value: { readonly numerator: string; readonly denominator: string }): ExactFraction {
  return makeFraction(BigInt(value.numerator), BigInt(value.denominator))
}

function validateLocalDateAndTimeZone(localDate: string, timeZone: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || Number.isNaN(Date.parse(`${localDate}T00:00:00Z`)) || new Date(`${localDate}T00:00:00Z`).toISOString().slice(0, 10) !== localDate) {
    throw new NutritionError('INVALID_JOURNAL', 'La date de journée doit être une date ISO civile valide.')
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(new Date())
  } catch {
    throw new NutritionError('INVALID_JOURNAL', 'Le fuseau horaire IANA est invalide.')
  }
}

function normalizeOccurredAt(value: string | null, localDate: string, timeZone: string): string | null {
  if (value === null) return null
  const instant = normalizeInstant(value)
  const localParts = new Intl.DateTimeFormat('en', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instant))
  const part = (type: string) => localParts.find((candidate) => candidate.type === type)?.value ?? ''
  const eventDate = `${part('year')}-${part('month')}-${part('day')}`
  if (eventDate !== localDate) throw new NutritionError('INVALID_JOURNAL', 'L’instant du repas ne correspond pas à la journée dans son fuseau horaire.')
  return instant
}

function normalizeInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new NutritionError('INVALID_JOURNAL', 'Un instant doit inclure Z ou un décalage horaire explicite.')
  const time = Date.parse(value)
  if (Number.isNaN(time)) throw new NutritionError('INVALID_JOURNAL', 'Instant ISO-8601 invalide.')
  return new Date(time).toISOString()
}

function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => clonePlain(item)) as T
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) result[key] = clonePlain(child)
    return result as T
  }
  return value
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}
