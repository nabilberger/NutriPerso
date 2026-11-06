/** Server-only persistence for recipe drafts and immutable recipe snapshots. */
import { createConfirmedRecipeSnapshot, type ConfirmedRecipeSnapshot } from '../../src/domain/nutrition/recipe-snapshot.ts'
import { calculateRecipe, type FoodNutritionSnapshot, type RecipeAllocation, type RecipeDraft } from '../../src/domain/nutrition/recipes.ts'
import { parseDecimal } from '../../src/domain/nutrition/decimal.ts'
import type { SupabaseCatalogEnv } from './supabase-catalog.ts'

export type RecipePersistenceEnv = SupabaseCatalogEnv
/** Construct only from the subject of a Worker-validated Supabase Auth JWT. */
export type RecipeUserScope = { readonly userId: string }

export type PersistedRecipe = {
  readonly draft: RecipeDraft
  readonly snapshots: readonly ConfirmedRecipeSnapshot[]
}

export type RecipePersistenceErrorCode = 'CONFIGURATION' | 'INVALID_RECIPE' | 'REVISION_CONFLICT' | 'REMOTE_ERROR'

export class RecipePersistenceError extends Error {
  readonly code: RecipePersistenceErrorCode

  constructor(code: RecipePersistenceErrorCode, message: string) {
    super(message)
    this.name = 'RecipePersistenceError'
    this.code = code
  }
}

/** expectedRevision is 0 for a new draft; a retry of the same revision is idempotent. */
export async function saveRecipeDraft(
  env: RecipePersistenceEnv,
  scope: RecipeUserScope,
  draft: RecipeDraft,
  expectedRevision: number,
  fetcher: typeof fetch = fetch,
): Promise<RecipeDraft> {
  assertUserId(scope.userId)
  assertDraft(draft)
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || draft.revision !== expectedRevision + 1) {
    throw new RecipePersistenceError('INVALID_RECIPE', 'La révision du brouillon ne correspond pas à la révision attendue.')
  }

  const rows = await callRpc<unknown[]>(env, 'save_recipe_draft', {
    p_user_id: scope.userId,
    p_recipe_id: draft.id,
    p_expected_revision: expectedRevision,
    p_draft: draft,
  }, fetcher)
  if (!Array.isArray(rows) || !isRecord(rows[0]) || rows[0].user_id !== scope.userId) throw new RecipePersistenceError('REMOTE_ERROR', 'Supabase n’a pas retourné le brouillon de cet utilisateur.')
  return parseDraft(rows[0].draft)
}

/** Appends one confirmed snapshot; SQL checks the current revision and predecessor atomically. */
async function appendRecipeSnapshot(
  env: RecipePersistenceEnv,
  scope: RecipeUserScope,
  snapshot: ConfirmedRecipeSnapshot,
  expectedPredecessorSnapshotId: string | null,
  fetcher: typeof fetch = fetch,
): Promise<ConfirmedRecipeSnapshot> {
  assertUserId(scope.userId)
  assertSnapshot(snapshot)
  const rows = await callRpc<unknown[]>(env, 'append_recipe_snapshot', {
    p_user_id: scope.userId,
    p_recipe_id: snapshot.recipe.id,
    p_expected_revision: snapshot.recipe.revision,
    p_expected_predecessor_snapshot_id: expectedPredecessorSnapshotId,
    p_snapshot: snapshot,
  }, fetcher)
  if (!Array.isArray(rows) || !isRecord(rows[0]) || rows[0].user_id !== scope.userId) throw new RecipePersistenceError('REMOTE_ERROR', 'Supabase n’a pas retourné l’instantané de cet utilisateur.')
  const saved = rows[0].snapshot
  assertSnapshot(saved)
  return saved
}

/** Recalculates from Worker-resolved food snapshots, creates the canonical snapshot, then persists it. */
export async function confirmRecipe(
  env: RecipePersistenceEnv,
  scope: RecipeUserScope,
  draft: RecipeDraft,
  foods: ReadonlyMap<string, FoodNutritionSnapshot>,
  allocation: RecipeAllocation,
  engineVersion: string,
  confirmedAt: string,
  expectedPredecessorSnapshotId: string | null,
  fetcher: typeof fetch = fetch,
): Promise<ConfirmedRecipeSnapshot> {
  assertUserId(scope.userId)
  assertDraft(draft)
  const calculation = calculateRecipe(draft, foods, allocation)
  const snapshot = createConfirmedRecipeSnapshot(draft, calculation, engineVersion, confirmedAt)
  return appendRecipeSnapshot(env, scope, snapshot, expectedPredecessorSnapshotId, fetcher)
}

/** Reads the stored draft and historical snapshots verbatim; it never consults the current food catalogue. */
export async function getRecipePersistence(
  env: RecipePersistenceEnv,
  scope: RecipeUserScope,
  recipeId: string,
  fetcher: typeof fetch = fetch,
): Promise<PersistedRecipe | null> {
  assertUserId(scope.userId)
  assertUuid(recipeId)
  const recipeUrl = restUrl(env, 'recipes')
  recipeUrl.searchParams.set('select', 'user_id,draft')
  recipeUrl.searchParams.set('user_id', `eq.${scope.userId}`)
  recipeUrl.searchParams.set('id', `eq.${recipeId}`)
  const recipeRows = await requestJson<unknown[]>(recipeUrl, env, fetcher)
  if (!Array.isArray(recipeRows) || recipeRows.length === 0) return null
  if (!isRecord(recipeRows[0]) || recipeRows[0].user_id !== scope.userId) throw new RecipePersistenceError('REMOTE_ERROR', 'Supabase a retourné une recette invalide ou appartenant à un autre utilisateur.')
  const draft = parseDraft(recipeRows[0].draft)

  const snapshotUrl = restUrl(env, 'recipe_snapshots')
  snapshotUrl.searchParams.set('select', 'user_id,snapshot')
  snapshotUrl.searchParams.set('recipe_id', `eq.${recipeId}`)
  snapshotUrl.searchParams.set('user_id', `eq.${scope.userId}`)
  snapshotUrl.searchParams.set('order', 'recipe_revision.asc')
  const rows = await requestJson<unknown[]>(snapshotUrl, env, fetcher)
  if (!Array.isArray(rows)) throw new RecipePersistenceError('REMOTE_ERROR', 'Supabase a retourné un historique de recette invalide.')
  const snapshots = rows.map((row) => {
    if (!isRecord(row) || row.user_id !== scope.userId) throw new RecipePersistenceError('REMOTE_ERROR', 'Supabase a retourné un instantané invalide ou appartenant à un autre utilisateur.')
    assertSnapshot(row.snapshot)
    return row.snapshot
  })
  return { draft, snapshots }
}

/** Lists draft metadata without loading snapshots or recalculating nutrition. */
export async function listRecipeDrafts(
  env: RecipePersistenceEnv,
  scope: RecipeUserScope,
  limit = 50,
  fetcher: typeof fetch = fetch,
): Promise<RecipeDraft[]> {
  assertUserId(scope.userId)
  const boundedLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 50
  const url = restUrl(env, 'recipes')
  url.searchParams.set('select', 'user_id,draft')
  url.searchParams.set('user_id', `eq.${scope.userId}`)
  url.searchParams.set('order', 'updated_at.desc')
  url.searchParams.set('or', '(draft->>archived.is.null,draft->>archived.eq.false)')
  url.searchParams.set('limit', String(boundedLimit))
  const rows = await requestJson<unknown[]>(url, env, fetcher)
  if (!Array.isArray(rows)) throw new RecipePersistenceError('REMOTE_ERROR', 'Supabase a retourné une liste de recettes invalide.')
  return rows.map((row) => {
    if (!isRecord(row) || row.user_id !== scope.userId) throw new RecipePersistenceError('REMOTE_ERROR', 'Supabase a retourné une recette invalide ou appartenant à un autre utilisateur.')
    return parseDraft(row.draft)
  }).filter(draft => !draft.archived)
}

function assertDraft(value: unknown): asserts value is RecipeDraft {
  if (!isRecord(value) || !isUuid(value.id) || typeof value.name !== 'string' || !value.name.trim()
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 || !Array.isArray(value.ingredients)
    || !(value.servings === null || typeof value.servings === 'string')
    || !(value.finalWeight === null || (isRecord(value.finalWeight) && typeof value.finalWeight.amount === 'string'
      && value.finalWeight.unit === 'g' && value.finalWeight.weightNature === 'edible'))) {
    throw new RecipePersistenceError('INVALID_RECIPE', 'Le brouillon de recette est invalide.')
  }
  for (const key of ['description', 'instructions'] as const) if (value[key] !== undefined && typeof value[key] !== 'string') throw new RecipePersistenceError('INVALID_RECIPE', 'Description ou préparation invalide.')
  if (value.archived !== undefined && typeof value.archived !== 'boolean') throw new RecipePersistenceError('INVALID_RECIPE', 'État de recette invalide.')
  const ingredientIds = new Set<string>()
  for (const [position, ingredient] of value.ingredients.entries()) {
    if (!isRecord(ingredient) || typeof ingredient.id !== 'string' || !ingredient.id.trim()
      || typeof ingredient.foodId !== 'string' || !ingredient.foodId.trim() || ingredient.position !== position
      || !isRecord(ingredient.quantity) || typeof ingredient.quantity.amount !== 'string') {
      throw new RecipePersistenceError('INVALID_RECIPE', 'Un ingrédient du brouillon est invalide.')
    }
    if (ingredientIds.has(ingredient.id)) throw new RecipePersistenceError('INVALID_RECIPE', 'Les identifiants d’ingrédients doivent être uniques.')
    ingredientIds.add(ingredient.id)
    const quantity = ingredient.quantity
    if (quantity.kind === 'physical') {
      const mass = quantity.unit === 'g' || quantity.unit === 'kg'
      const validNature = mass
        ? ['edible', 'gross', 'unknown'].includes(String(quantity.weightNature))
        : ['ml', 'l'].includes(String(quantity.unit)) && quantity.weightNature === 'not-applicable'
      if (!validNature) throw new RecipePersistenceError('INVALID_RECIPE', 'La quantité physique ou sa nature est invalide.')
    } else if (quantity.kind === 'serving') {
      if (typeof quantity.equivalenceId !== 'string' || !quantity.equivalenceId.trim()
        || !['piece', 'slice', 'teaspoon', 'tablespoon', 'custom'].includes(String(quantity.unit))) {
        throw new RecipePersistenceError('INVALID_RECIPE', 'L’équivalence de portion est invalide.')
      }
    } else {
      throw new RecipePersistenceError('INVALID_RECIPE', 'Le type de quantité est invalide.')
    }
  }
  assertJsonSafe(value)
  assertExactFieldsAreStrings(value)
}

function parseDraft(value: unknown): RecipeDraft {
  assertDraft(value)
  return value
}

function assertSnapshot(value: unknown): asserts value is ConfirmedRecipeSnapshot {
  if (!isRecord(value) || value.schemaVersion !== '1' || typeof value.snapshotId !== 'string' || !value.snapshotId.trim()
    || typeof value.engineVersion !== 'string' || !value.engineVersion.trim()
    || typeof value.confirmedAt !== 'string' || !Number.isFinite(Date.parse(value.confirmedAt))
    || !isRecord(value.recipe) || !isUuid(value.recipe.id) || !Number.isSafeInteger(value.recipe.revision)
    || !Array.isArray(value.ingredients) || !Array.isArray(value.referenceTotals) || !Array.isArray(value.totals)) {
    throw new RecipePersistenceError('INVALID_RECIPE', 'L’instantané confirmé de recette est invalide.')
  }
  assertJsonSafe(value)
  assertExactFieldsAreStrings(value)
}

function assertJsonSafe(value: unknown): void {
  if (typeof value === 'bigint' || typeof value === 'undefined' || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new RecipePersistenceError('INVALID_RECIPE', 'Le document contient une valeur qui ne peut pas être sérialisée en JSON.')
  }
  if (Array.isArray(value)) {
    value.forEach(assertJsonSafe)
  } else if (isRecord(value)) {
    for (const nested of Object.values(value)) assertJsonSafe(nested)
  }
}

function assertExactFieldsAreStrings(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertExactFieldsAreStrings)
    return
  }
  if (!isRecord(value)) return
  for (const [key, nested] of Object.entries(value)) {
    if (/^(?:exact|edible)?(?:numerator|denominator)$/i.test(key) && nested !== null) {
      if (typeof nested !== 'string' || !/^-?(?:0|[1-9]\d*)$/.test(nested)) {
        throw new RecipePersistenceError('INVALID_RECIPE', 'Les fractions exactes doivent être sérialisées en chaînes entières.')
      }
      if (/denominator$/i.test(key) && BigInt(nested) <= 0n) {
        throw new RecipePersistenceError('INVALID_RECIPE', 'Le dénominateur d’une fraction doit être positif.')
      }
    }
    if (['sourceValue', 'amount', 'servings', 'equivalentAmount', 'displayedValue', 'knownSubtotal'].includes(key) && nested !== null) {
      if (typeof nested !== 'string') throw new RecipePersistenceError('INVALID_RECIPE', `Le champ décimal ${key} doit être une chaîne.`)
      try { parseDecimal(nested) } catch {
        throw new RecipePersistenceError('INVALID_RECIPE', `Le champ décimal ${key} est invalide ou hors limites.`)
      }
    }
    assertExactFieldsAreStrings(nested)
  }
}

async function callRpc<T>(env: RecipePersistenceEnv, name: string, body: Record<string, unknown>, fetcher: typeof fetch): Promise<T> {
  const url = restUrl(env, `rpc/${name}`)
  return requestJson<T>(url, env, fetcher, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body),
  })
}

async function requestJson<T>(url: URL, env: RecipePersistenceEnv, fetcher: typeof fetch, init: RequestInit = {}): Promise<T> {
  const secret = env.SUPABASE_SECRET_KEY?.trim()
  if (!secret) throw new RecipePersistenceError('CONFIGURATION', 'La configuration Supabase du Worker est absente.')
  let response: Response
  try {
    response = await fetcher(url, {
      ...init,
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new RecipePersistenceError('REMOTE_ERROR', 'Supabase est temporairement inaccessible.')
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (response.status === 409 || /RECIPE_REVISION_CONFLICT|RECIPE_SNAPSHOT_ID_CONFLICT/.test(detail)) {
      throw new RecipePersistenceError('REVISION_CONFLICT', 'La recette a changé depuis sa dernière lecture; rechargez-la avant de réessayer.')
    }
    throw new RecipePersistenceError('REMOTE_ERROR', `Supabase a refusé la requête (HTTP ${response.status}).`)
  }
  try {
    return await response.json() as T
  } catch {
    throw new RecipePersistenceError('REMOTE_ERROR', 'Supabase a retourné une réponse invalide.')
  }
}

function restUrl(env: RecipePersistenceEnv, path: string): URL {
  const base = env.SUPABASE_URL?.trim()
  if (!base || !env.SUPABASE_SECRET_KEY?.trim()) {
    throw new RecipePersistenceError('CONFIGURATION', 'La configuration Supabase du Worker est absente.')
  }
  let url: URL
  try { url = new URL(base) } catch { throw new RecipePersistenceError('CONFIGURATION', 'SUPABASE_URL est invalide.') }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new RecipePersistenceError('CONFIGURATION', 'SUPABASE_URL doit utiliser HTTPS.')
  }
  url.pathname = `${url.pathname.replace(/\/$/, '')}/rest/v1/${path}`
  return url
}

function assertUuid(value: string): void {
  if (!isUuid(value)) throw new RecipePersistenceError('INVALID_RECIPE', 'L’identifiant de recette doit être un UUID.')
}

function assertUserId(value: string): void {
  if (!isUuid(value)) throw new RecipePersistenceError('INVALID_RECIPE', 'L’utilisateur authentifié est requis.')
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
