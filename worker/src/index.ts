import { Hono } from 'hono'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { importUsdaFood as persistUsdaFood, type SupabaseCatalogEnv, type UsdaFoodDetail } from './supabase-catalog.ts'
import { parseJsonWithExactNumbers } from './exact-json.ts'
import { parseDecimal } from '../../src/domain/nutrition/decimal.ts'
import { validateSupabaseAccessToken, type AuthenticatedUserScope } from './auth.ts'
import { getRecipePersistence, listRecipeDrafts, RecipePersistenceError, saveRecipeDraft } from './supabase-recipes.ts'
import type { RecipeDraft } from '../../src/domain/nutrition/recipes.ts'
import { cancelJournalMeal, confirmJournalMeal, getJournalPersistence, getJournalPersistenceForDate, JournalPersistenceError, saveJournalDayDraft } from './supabase-journal.ts'
import { usdaDetailToFoodSnapshot } from '../../src/domain/nutrition/usda-food-snapshot.ts'
import type { ConfirmedFoodJournalItem, JournalDayDraft } from '../../src/domain/nutrition/journal.ts'
import { getProfile, saveProfile, ProfileError } from './supabase-profile.ts'
import {listMeasurements, addMeasurement, deleteMeasurement} from './supabase-measurements.ts'

type Bindings = { FDC_API_KEY?: string; SUPABASE_PUBLISHABLE_KEY?: string } & SupabaseCatalogEnv
type AppEnv = { Bindings: Bindings; Variables: { userScope: AuthenticatedUserScope } }
type JsonRecord = Record<string, unknown>
type NutrientValue = string
type NutrientBasis = { quantity: 100; unit: 'g' | 'ml'; source: 'fdc_data_type' | 'fdc_branded_standardization' } | null
type FoodNutrient = { id: number | null; name: string; unitName: string; value: NutrientValue; basis: NutrientBasis }
type FdcErrorCode = 'FDC_TIMEOUT' | 'FDC_UNAVAILABLE' | 'FDC_RATE_LIMITED' | 'FDC_REJECTED' | 'FDC_INVALID_RESPONSE' | 'FDC_FOOD_NOT_FOUND'

class FdcError extends Error {
  readonly status: number
  readonly code: FdcErrorCode

  constructor(status: number, code: FdcErrorCode, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const FDC_API_BASE = 'https://api.nal.usda.gov/fdc/v1'
const REQUEST_TIMEOUT_MS = 10_000
const DEFAULT_SEARCH_PAGE_SIZE = 25
const MAX_SEARCH_PAGE_SIZE = 25
const KEY_NUTRIENTS = {
  energy: new Set([1008, 2047, 2048]), protein: new Set([1003]),
  carbohydrates: new Set([1005]), fat: new Set([1004]), fiber: new Set([1079]),
} as const

export function createWorkerApp(dependencies: { readonly fetcher?: typeof fetch } = {}) {
const app = new Hono<AppEnv>()
const fetcher = dependencies.fetcher ?? fetch

app.use('/api/private/*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store')
  const result = await validateSupabaseAccessToken(c.req.header('Authorization'), c.env, fetcher)
  if (!result.ok) {
    const message = result.status === 401 ? 'Une session valide est requise.'
      : result.status === 403 ? 'Cette session ne peut pas accéder à cet espace.'
        : 'Le service d’authentification est temporairement indisponible.'
    return c.json({ error: { code: result.code, message } }, result.status)
  }
  c.set('userScope', result.scope)
  await next()
})

app.get('/api/foods/search', async (c) => {
  const query = c.req.query('q')?.trim() ?? ''
  if (!query) return c.json({ error: { code: 'QUERY_REQUIRED', message: 'Le paramètre q est requis.' } }, 400)
  if (query.length > 120) return c.json({ error: { code: 'QUERY_TOO_LONG', message: 'La recherche est trop longue.' } }, 400)
  const page = parsePositiveInteger(c.req.query('page') ?? '1')
  if (page === null) return c.json({ error: { code: 'INVALID_PAGE', message: 'Le paramètre page doit être un entier positif.' } }, 400)
  const requestedPageSize = parsePositiveInteger(c.req.query('pageSize') ?? String(DEFAULT_SEARCH_PAGE_SIZE))
  if (requestedPageSize === null) return c.json({ error: { code: 'INVALID_PAGE_SIZE', message: 'Le paramètre pageSize doit être un entier positif.' } }, 400)
  const pageSize = Math.min(requestedPageSize, MAX_SEARCH_PAGE_SIZE)
  try {
    const payload = await requestFdc('/foods/search', c.env.FDC_API_KEY, { query, pageNumber: String(page), pageSize: String(pageSize) })
    if (!isRecord(payload) || !Array.isArray(payload.foods)) throw new FdcError(502, 'FDC_INVALID_RESPONSE', 'FoodData Central a retourné une réponse invalide.')
    const foods = rankSearchFoods(query, deduplicateSearchFoods(payload.foods.filter(isRecord).map(mapSearchFood).filter((food): food is SearchFood => food !== null)))
    return c.json({ foods, totalHits: finiteNumber(payload.totalHits) ?? foods.length, currentPage: finiteNumber(payload.currentPage) ?? page, totalPages: finiteNumber(payload.totalPages) ?? (foods.length ? page : 0), pageSize })
  } catch (error) { return respondWithError(c, error) }
})

app.get('/api/foods/:fdcId', async (c) => {
  const fdcId = c.req.param('fdcId')
  if (!/^\d+$/.test(fdcId) || Number(fdcId) <= 0) return c.json({ error: { code: 'INVALID_FDC_ID', message: 'L’identifiant fdcId doit être un entier positif.' } }, 400)
  try {
    const payload = await requestFdc('/food/' + fdcId, c.env.FDC_API_KEY)
    if (!isRecord(payload) || finiteNumber(payload.fdcId) === null) throw new FdcError(502, 'FDC_INVALID_RESPONSE', 'FoodData Central a retourné une réponse invalide.')
    const detail = mapDetailFood(payload)
    return c.json({ ...detail, keyNutrients: selectKeyNutrients(detail.nutrients) })
  } catch (error) { return respondWithError(c, error) }
})

app.get('/api/private/measurements', async (c) => {
  try {return c.json({measurements:await listMeasurements(c.env,c.get('userScope').userId,fetcher)})}
  catch(error){return respondProfileError(c,error)}
})
app.post('/api/private/measurements', async (c) => {
  let input:unknown
  try {input=await c.req.json()} catch{return c.json({error:{code:'INVALID_MEASUREMENT',message:'Une mesure JSON est attendue.'}},400)}
  if (containsUserId(input)) return c.json({error:{code:'AUTH_FORBIDDEN',message:'L’identité utilisateur provient exclusivement de la session Auth.'}},403)
  try {return c.json({measurement:await addMeasurement(c.env,c.get('userScope').userId,input,fetcher)},201)}
  catch(error){return respondProfileError(c,error)}
})
app.delete('/api/private/measurements/:id', async (c) => {
  try {await deleteMeasurement(c.env,c.get('userScope').userId,c.req.param('id'),fetcher);return c.body(null,204)}
  catch(error){return respondProfileError(c,error)}
})

app.get('/api/private/profile', async (c) => {
  try { return c.json({ profile: await getProfile(c.env, c.get('userScope').userId, fetcher) }) }
  catch (error) { return respondProfileError(c, error) }
})

app.put('/api/private/profile', async (c) => {
  let payload: unknown
  try { payload = await c.req.json() }
  catch { return c.json({ error: { code: 'INVALID_PROFILE', message: 'Le profil doit être un objet JSON.' } }, 400) }
  if (containsUserId(payload)) return c.json({ error: { code: 'AUTH_FORBIDDEN', message: 'L’identité utilisateur provient exclusivement de la session Auth.' } }, 403)
  try { return c.json({ profile: await saveProfile(c.env, c.get('userScope').userId, payload, fetcher) }) }
  catch (error) { return respondProfileError(c, error) }
})

app.get('/api/private/session', (c) => {
  const { userId, email } = c.get('userScope')
  return c.json({ user: { id: userId, email } })
})

app.get('/api/private/recipes', async (c) => {
  try {
    const limit = c.req.query('limit') === undefined ? 50 : parsePositiveInteger(c.req.query('limit')!)
    if (limit === null) return c.json({ error: { code: 'INVALID_LIMIT', message: 'La limite doit être un entier positif.' } }, 400)
    return c.json({ recipes: await listRecipeDrafts(c.env, c.get('userScope'), limit, fetcher) })
  } catch (error) { return respondPersistenceError(c, error) }
})

app.get('/api/private/recipes/:recipeId', async (c) => {
  try {
    const recipe = await getRecipePersistence(c.env, c.get('userScope'), c.req.param('recipeId'), fetcher)
    return recipe ? c.json(recipe) : c.json({ error: { code: 'NOT_FOUND', message: 'Recette introuvable.' } }, 404)
  } catch (error) { return respondPersistenceError(c, error) }
})

app.put('/api/private/recipes/:recipeId/draft', async (c) => {
  const parsed = await readDraftBody(c)
  if (parsed instanceof Response) return parsed
  if (!isRecord(parsed.draft) || parsed.draft.id !== c.req.param('recipeId')) {
    return c.json({ error: { code: 'INVALID_RECIPE', message: 'L’identifiant du brouillon ne correspond pas à la route.' } }, 400)
  }
  try {
    const saved = await saveRecipeDraft(c.env, c.get('userScope'), parsed.draft as unknown as RecipeDraft, parsed.expectedRevision, fetcher)
    return c.json({ draft: saved })
  } catch (error) { return respondPersistenceError(c, error) }
})

app.get('/api/private/journal', async (c) => {
  const date = c.req.query('date')?.trim() ?? ''
  if (!date) return c.json({ error: { code: 'DATE_REQUIRED', message: 'Le paramètre date est requis.' } }, 400)
  try {
    return c.json({ journal: await getJournalPersistenceForDate(c.env, c.get('userScope'), date, fetcher) })
  } catch (error) { return respondPersistenceError(c, error) }
})

app.get('/api/private/journal/:dayId', async (c) => {
  try {
    const journal = await getJournalPersistence(c.env, c.get('userScope'), c.req.param('dayId'), fetcher)
    return journal ? c.json(journal) : c.json({ error: { code: 'NOT_FOUND', message: 'Journée introuvable.' } }, 404)
  } catch (error) { return respondPersistenceError(c, error) }
})

app.put('/api/private/journal/:dayId/draft', async (c) => {
  const parsed = await readDraftBody(c)
  if (parsed instanceof Response) return parsed
  if (!isRecord(parsed.draft) || parsed.draft.id !== c.req.param('dayId')) {
    return c.json({ error: { code: 'INVALID_JOURNAL', message: 'L’identifiant du brouillon ne correspond pas à la route.' } }, 400)
  }
  try {
    const saved = await saveJournalDayDraft(c.env, c.get('userScope'), parsed.draft as unknown as JournalDayDraft, parsed.expectedRevision, fetcher)
    return c.json({ draft: saved })
  } catch (error) { return respondPersistenceError(c, error) }
})

app.post('/api/private/journal/:dayId/meals/:mealId/confirm', async (c) => {
  const body = await readActionBody(c, ['snapshotId', 'confirmedAt', 'engineVersion'])
  if (body instanceof Response) return body
  if (typeof body.snapshotId !== 'string' || !body.snapshotId.trim()
    || typeof body.confirmedAt !== 'string' || !Number.isFinite(Date.parse(body.confirmedAt))
    || typeof body.engineVersion !== 'string' || !body.engineVersion.trim()) {
    return c.json({ error: { code: 'INVALID_JOURNAL', message: 'Les informations de confirmation sont invalides.' } }, 400)
  }
  const dayId = c.req.param('dayId')
  const mealId = c.req.param('mealId')
  try {
    const persisted = await getJournalPersistence(c.env, c.get('userScope'), dayId, fetcher)
    if (!persisted) return c.json({ error: { code: 'NOT_FOUND', message: 'Journée introuvable.' } }, 404)
    const retry = persisted.snapshots.find((snapshot) => snapshot.snapshotId === body.snapshotId)
    if (retry) {
      if (retry.logicalMealId !== mealId || retry.dayId !== dayId || retry.status !== 'confirmed') {
        return c.json({ error: { code: 'REVISION_CONFLICT', message: 'Cet identifiant de confirmation est déjà utilisé.' } }, 409)
      }
      return c.json({ day: persisted.day, snapshot: retry })
    }
    const meal = persisted.day.meals.find((candidate) => candidate.id === mealId)
    if (!meal) return c.json({ error: { code: 'REVISION_CONFLICT', message: 'Le brouillon de repas a changé ou a déjà été confirmé.' } }, 409)
    const sources = await resolveJournalSources(c.env, c.get('userScope'), persisted, meal, fetcher)
    const result = await confirmJournalMeal(c.env, c.get('userScope'), dayId, mealId, sources, {
      snapshotId: body.snapshotId, confirmedAt: body.confirmedAt, engineVersion: body.engineVersion,
    }, fetcher)
    return c.json(result)
  } catch (error) {
    if (error instanceof FdcError) return respondWithError(c, error)
    if (error instanceof RecipePersistenceError) return respondPersistenceError(c, error)
    return respondPersistenceError(c, error)
  }
})

app.post('/api/private/journal/snapshots/:snapshotId/cancel', async (c) => {
  const body = await readActionBody(c, ['newSnapshotId', 'confirmedAt', 'engineVersion'])
  if (body instanceof Response) return body
  if (typeof body.newSnapshotId !== 'string' || !body.newSnapshotId.trim()
    || typeof body.confirmedAt !== 'string' || !Number.isFinite(Date.parse(body.confirmedAt))
    || typeof body.engineVersion !== 'string' || !body.engineVersion.trim()) {
    return c.json({ error: { code: 'INVALID_JOURNAL', message: 'Les informations d’annulation sont invalides.' } }, 400)
  }
  try {
    const result = await cancelJournalMeal(c.env, c.get('userScope'), c.req.param('snapshotId'), {
      newSnapshotId: body.newSnapshotId, confirmedAt: body.confirmedAt, engineVersion: body.engineVersion,
    }, fetcher)
    return c.json(result)
  } catch (error) { return respondPersistenceError(c, error) }
})

app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route introuvable.' } }, 404))
app.onError((_error, c) => c.json({ error: { code: 'INTERNAL_ERROR', message: 'Une erreur interne est survenue.' } }, 500))
return app
}

async function resolveJournalSources(
  env: Bindings,
  scope: AuthenticatedUserScope,
  persisted: Awaited<ReturnType<typeof getJournalPersistence>> & {},
  meal: import('../../src/domain/nutrition/journal.ts').MealDraft,
  fetcher: typeof fetch,
): Promise<import('../../src/domain/nutrition/journal.ts').JournalCalculationSources> {
  if (!persisted) throw new JournalPersistenceError('INVALID_JOURNAL', 'Brouillon de journée introuvable.')
  const foods = new Map<string, import('../../src/domain/nutrition/recipes.ts').FoodNutritionSnapshot>()
  const predecessor = meal.supersedesSnapshotId
    ? persisted.snapshots.find((snapshot) => snapshot.snapshotId === meal.supersedesSnapshotId)
    : undefined
  for (const item of meal.items) {
    if (item.kind === 'food') {
      if (item.pinnedFoodSnapshot) {
        const historicalItem = predecessor?.status === 'confirmed'
          ? predecessor.items.find((candidate): candidate is ConfirmedFoodJournalItem => candidate.kind === 'food' && candidate.id === item.id)
          : undefined
        if (!historicalItem || !jsonEqual(historicalItem.foodSnapshot, item.pinnedFoodSnapshot)
          || historicalItem.foodId !== item.foodId) {
          throw new JournalPersistenceError('INVALID_JOURNAL', 'Le snapshot alimentaire du brouillon de correction ne correspond pas à son prédécesseur.')
        }
        foods.set(item.foodId, historicalItem.foodSnapshot)
        continue
      }
      const match = /^usda:(\d+)$/.exec(item.foodId)
      if (!match) throw new JournalPersistenceError('INVALID_JOURNAL', 'La source de cet aliment n’est pas prise en charge.')
      const fdcId = Number(match[1])
      const payload = await requestFdc('/food/' + fdcId, env.FDC_API_KEY, {}, fetcher)
      if (!isRecord(payload) || finiteNumber(payload.fdcId) !== fdcId) {
        throw new FdcError(502, 'FDC_INVALID_RESPONSE', 'FoodData Central a retourné une fiche détaillée invalide.')
      }
      const snapshot = usdaDetailToFoodSnapshot(mapDetailFood(payload))
      foods.set(item.foodId, snapshot)
    } else {
      const storedRecipe = await getRecipePersistence(env, scope, item.recipeSnapshot.recipe.id, fetcher)
      const attestedSnapshot = storedRecipe?.snapshots.find((snapshot) => snapshot.snapshotId === item.recipeSnapshot.snapshotId)
      if (!attestedSnapshot || !jsonEqual(attestedSnapshot, item.recipeSnapshot)) {
        throw new JournalPersistenceError('INVALID_JOURNAL', 'Le snapshot de recette ne correspond pas à une recette confirmée de cet utilisateur.')
      }
    }
  }
  return { foods }
}

async function readActionBody(c: Context<AppEnv>, allowedKeys: readonly string[]): Promise<JsonRecord | Response> {
  let value: unknown
  try { value = await c.req.json() } catch { return c.json({ error: { code: 'INVALID_BODY', message: 'Le corps JSON est invalide.' } }, 400) }
  if (!isRecord(value)) return c.json({ error: { code: 'INVALID_BODY', message: 'Un objet JSON est requis.' } }, 400)
  if (containsUserId(value)) return c.json({ error: { code: 'AUTH_FORBIDDEN', message: 'L’identité utilisateur provient exclusivement de la session Auth.' } }, 403)
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    return c.json({ error: { code: 'INVALID_BODY', message: 'Le corps contient des champs non autorisés.' } }, 400)
  }
  return value
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => jsonEqual(value, right[index]))
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(left[key], right[key]))
  }
  return false
}

async function readDraftBody(c: Context<AppEnv>): Promise<{ draft: unknown; expectedRevision: number } | Response> {
  let value: unknown
  try { value = await c.req.json() } catch { return c.json({ error: { code: 'INVALID_BODY', message: 'Le corps JSON est invalide.' } }, 400) }
  if (!isRecord(value)) return c.json({ error: { code: 'INVALID_BODY', message: 'Un brouillon JSON est requis.' } }, 400)
  if (containsUserId(value)) return c.json({ error: { code: 'AUTH_FORBIDDEN', message: 'L’identité utilisateur provient exclusivement de la session Auth.' } }, 403)
  if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0 || !('draft' in value)) {
    return c.json({ error: { code: 'INVALID_BODY', message: 'draft et expectedRevision sont requis.' } }, 400)
  }
  return { draft: value.draft, expectedRevision: value.expectedRevision as number }
}

function containsUserId(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsUserId)
  if (!isRecord(value)) return false
  return Object.entries(value).some(([key, nested]) => key.replace(/[_-]/g, '').toLowerCase() === 'userid' || containsUserId(nested))
}

function respondProfileError(c: Context<AppEnv>, error: unknown) {
  if (error instanceof ProfileError) return c.json({ error: { code: 'PROFILE_ERROR', message: error.message } }, error.status as ContentfulStatusCode)
  return c.json({ error: { code: 'PROFILE_ERROR', message: 'Le profil est momentanément indisponible.' } }, 502)
}

function respondPersistenceError(c: Context<AppEnv>, error: unknown) {
  if (error instanceof RecipePersistenceError || error instanceof JournalPersistenceError) {
    const status = error.code === 'INVALID_RECIPE' || error.code === 'INVALID_JOURNAL' ? 400
      : error.code === 'REVISION_CONFLICT' ? 409
        : error.code === 'CONFIGURATION' ? 503 : 502
    return c.json({ error: { code: error.code, message: error.message } }, status)
  }
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Une erreur interne est survenue.' } }, 500)
}

/** Server-only import entry point: fetches the full FDC detail by ID before persisting it. */
export async function importUsdaFoodByFdcId(
  bindings: Bindings,
  fdcId: number,
  usdaFetcher: typeof fetch = fetch,
  supabaseFetcher: typeof fetch = fetch,
) {
  if (!Number.isSafeInteger(fdcId) || fdcId <= 0) throw new FdcError(400, 'FDC_INVALID_RESPONSE', 'L’identifiant fdcId doit être un entier positif.')
  const payload = await requestFdc(`/food/${fdcId}`, bindings.FDC_API_KEY, {}, usdaFetcher)
  if (!isRecord(payload) || finiteNumber(payload.fdcId) !== fdcId) {
    throw new FdcError(502, 'FDC_INVALID_RESPONSE', 'FoodData Central a retourné une fiche détaillée invalide.')
  }
  const detail: UsdaFoodDetail = mapDetailFood(payload)
  return persistUsdaFood(bindings, detail, supabaseFetcher)
}

async function requestFdc(path: string, apiKey: string | undefined, params: Record<string, string> = {}, fetcher: typeof fetch = fetch): Promise<unknown> {
  const key = apiKey?.trim()
  if (!key) throw new FdcError(503, 'FDC_UNAVAILABLE', 'La source USDA n’est pas configurée.')
  const url = new URL(FDC_API_BASE + path)
  url.searchParams.set('api_key', key)
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetcher(url, { headers: { accept: 'application/json' }, signal: controller.signal })
    if (!response.ok) {
      if (response.status === 404 && path.startsWith('/food/')) throw new FdcError(404, 'FDC_FOOD_NOT_FOUND', 'Aliment introuvable dans FoodData Central.')
      if (response.status === 429) throw new FdcError(429, 'FDC_RATE_LIMITED', 'La limite de requêtes USDA est atteinte. Réessayez plus tard.')
      throw new FdcError(502, 'FDC_REJECTED', 'FoodData Central n’a pas pu traiter la requête.')
    }
    return parseJsonWithExactNumbers(await response.text())
  } catch (error) {
    if (error instanceof FdcError) throw error
    if (controller.signal.aborted) throw new FdcError(504, 'FDC_TIMEOUT', 'FoodData Central ne répond pas dans le délai prévu.')
    throw new FdcError(502, 'FDC_UNAVAILABLE', 'FoodData Central est temporairement inaccessible.')
  } finally { clearTimeout(timeoutId) }
}

type SearchFood = {
  fdcId: number
  description: string
  dataType: string | null
  brandOwner: string | null
  score?: number
  foodCategory: 'generic' | 'branded'
  searchOrder: number
}

type SearchFoodResponse = Omit<SearchFood, 'searchOrder'>

function mapSearchFood(food: JsonRecord): SearchFood | null {
  const fdcId = finiteNumber(food.fdcId)
  const description = stringValue(food.description)?.trim()
  if (fdcId === null || !Number.isSafeInteger(fdcId) || fdcId <= 0 || !description) return null

  const dataType = stringValue(food.dataType)
  const score = finiteNumber(food.score)
  return {
    fdcId,
    description,
    dataType,
    brandOwner: stringValue(food.brandOwner),
    ...(score !== null ? { score } : {}),
    foodCategory: dataType === 'Branded' ? 'branded' : 'generic',
    searchOrder: 0,
  }
}
function mapDetailFood(payload: JsonRecord) {
  const dataType = stringValue(payload.dataType)
  const servingSize = finiteNumber(payload.servingSize)
  const servingSizeUnit = stringValue(payload.servingSizeUnit)
  const nutrients = Array.isArray(payload.foodNutrients)
    ? payload.foodNutrients.filter(isRecord).flatMap((raw) => {
      const nutrient = mapDetailNutrient(raw)
      if (!nutrient) return []
      return [{
        ...nutrient,
        basis: resolveNutrientBasis(dataType, servingSizeUnit, nutrient.unitName, hasFdcDerivation(raw.foodNutrientDerivation)),
      }]
    })
    : []
  return {
    fdcId: finiteNumber(payload.fdcId) ?? 0,
    description: stringValue(payload.description),
    dataType,
    foodCategory: stringValue(payload.foodCategory),
    brandOwner: stringValue(payload.brandOwner),
    servingSize,
    servingSizeUnit,
    nutrients,
  }
}
function mapDetailNutrient(raw: JsonRecord): FoodNutrient | null {
  const nutrient = isRecord(raw.nutrient) ? raw.nutrient : raw
  const name = stringValue(nutrient.name) ?? stringValue(raw.nutrientName)
  if (!name) return null
  const value = nutrientValue(raw.amount ?? raw.value)
  if (value === null) return null
  const id = finiteNumber(nutrient.id) ?? finiteNumber(raw.nutrientId) ?? finiteNumber(nutrient.number)
  return { id, name, unitName: stringValue(nutrient.unitName) ?? stringValue(raw.unitName) ?? '', value, basis: null }
}
export function resolveNutrientBasis(dataType: string | null, servingSizeUnit: string | null, nutrientUnit: string, hasDerivation = false): NutrientBasis {
  const normalizedNutrientUnit = nutrientUnit.trim().toLowerCase()
  if (normalizedNutrientUnit.includes('%') || normalizedNutrientUnit.includes('percent')) return null

  if (dataType === 'Branded') {
    if (!hasDerivation) return null
    const unit = normalizeBasisUnit(servingSizeUnit)
    return unit ? { quantity: 100, unit, source: 'fdc_branded_standardization' } : null
  }

  if (dataType === 'Foundation' || dataType === 'SR Legacy' || dataType === 'Survey (FNDDS)') {
    return { quantity: 100, unit: 'g', source: 'fdc_data_type' }
  }

  return null
}
function hasFdcDerivation(value: unknown): boolean {
  if (!isRecord(value)) return false
  return finiteNumber(value.id) !== null || (typeof value.code === 'string' && value.code.trim() !== '')
}
function normalizeBasisUnit(value: string | null): 'g' | 'ml' | null {
  const unit = value?.trim().toLowerCase()
  if (unit === 'g') return 'g'
  if (unit === 'ml') return 'ml'
  return null
}
function selectKeyNutrients(nutrients: FoodNutrient[]) {
  return {
    energy: findNutrient(nutrients, KEY_NUTRIENTS.energy, ['energy', 'calories']),
    protein: findNutrient(nutrients, KEY_NUTRIENTS.protein, ['protein']),
    carbohydrates: findNutrient(nutrients, KEY_NUTRIENTS.carbohydrates, ['carbohydrate']),
    fat: findNutrient(nutrients, KEY_NUTRIENTS.fat, ['total lipid', 'total fat', 'lipid']),
    fiber: findNutrient(nutrients, KEY_NUTRIENTS.fiber, ['fiber', 'fibre']),
  }
}
function findNutrient(nutrients: FoodNutrient[], ids: ReadonlySet<number>, labels: string[]): FoodNutrient | null {
  return nutrients.find((item) => item.id !== null && ids.has(item.id)) ?? nutrients.find((item) => labels.some((label) => item.name.toLowerCase().includes(label))) ?? null
}
function parsePositiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}
function deduplicateSearchFoods(foods: SearchFood[]): SearchFood[] {
  const byFdcId = new Map<number, SearchFood>()
  for (const [searchOrder, food] of foods.entries()) {
    const candidate = { ...food, searchOrder }
    const existing = byFdcId.get(food.fdcId)
    if (!existing || (candidate.score ?? Number.NEGATIVE_INFINITY) > (existing.score ?? Number.NEGATIVE_INFINITY)) {
      byFdcId.set(food.fdcId, candidate)
    }
  }
  return [...byFdcId.values()]
}
function rankSearchFoods(query: string, foods: SearchFood[]): SearchFoodResponse[] {
  const normalizedQuery = normalizeSearchText(query)
  const sourcePriority: Record<string, number> = {
    Foundation: 0,
    'SR Legacy': 1,
    'Survey (FNDDS)': 2,
    Branded: 3,
  }

  return foods.sort((left, right) => {
    const leftExact = normalizeSearchText(left.description) === normalizedQuery
    const rightExact = normalizeSearchText(right.description) === normalizedQuery
    if (leftExact !== rightExact) return leftExact ? -1 : 1

    // Scores are the primary relevance signal; source priority breaks equal scores or absent scores.
    const leftScore = left.score ?? Number.NEGATIVE_INFINITY
    const rightScore = right.score ?? Number.NEGATIVE_INFINITY
    if (leftScore !== rightScore) return leftScore > rightScore ? -1 : 1

    const sourceOrder = (sourcePriority[left.dataType ?? ''] ?? 4) - (sourcePriority[right.dataType ?? ''] ?? 4)
    if (sourceOrder !== 0) return sourceOrder
    return left.searchOrder - right.searchOrder
  }).map((food): SearchFoodResponse => ({
    fdcId: food.fdcId,
    description: food.description,
    dataType: food.dataType,
    brandOwner: food.brandOwner,
    ...(food.score !== undefined ? { score: food.score } : {}),
    foodCategory: food.foodCategory,
  }))
}
function normalizeSearchText(value: string): string {
  return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim()
}
function nutrientValue(value: unknown): NutrientValue | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    parseDecimal(value)
    return value
  } catch {
    return null
  }
}
function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null }
  return null
}
function stringValue(value: unknown): string | null { return typeof value === 'string' ? value : null }
function isRecord(value: unknown): value is JsonRecord { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function respondWithError(c: Context<AppEnv>, error: unknown) {
  if (error instanceof FdcError) return c.json({ error: { code: error.code, message: error.message } }, error.status as ContentfulStatusCode)
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Une erreur interne est survenue.' } }, 500)
}

const app = createWorkerApp()
export default app
