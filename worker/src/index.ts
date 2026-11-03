import { Hono } from 'hono'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

type Bindings = { FDC_API_KEY?: string }
type AppEnv = { Bindings: Bindings }
type JsonRecord = Record<string, unknown>
type NutrientValue = number | string | null
type FoodNutrient = { id: number | null; name: string; unitName: string; value: NutrientValue }
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
const SEARCH_PAGE_SIZE = 25
const KEY_NUTRIENTS = {
  energy: new Set([1008, 2047, 2048]), protein: new Set([1003]),
  carbohydrates: new Set([1005]), fat: new Set([1004]), fiber: new Set([1079]),
} as const

const app = new Hono<AppEnv>()

app.get('/api/foods/search', async (c) => {
  const query = c.req.query('q')?.trim() ?? ''
  if (!query) return c.json({ error: { code: 'QUERY_REQUIRED', message: 'Le paramètre q est requis.' } }, 400)
  if (query.length > 120) return c.json({ error: { code: 'QUERY_TOO_LONG', message: 'La recherche est trop longue.' } }, 400)
  try {
    const payload = await requestFdc('/foods/search', c.env.FDC_API_KEY, { query, pageSize: String(SEARCH_PAGE_SIZE) })
    if (!isRecord(payload) || !Array.isArray(payload.foods)) throw new FdcError(502, 'FDC_INVALID_RESPONSE', 'FoodData Central a retourné une réponse invalide.')
    const foods = payload.foods.filter(isRecord).map(mapSearchFood).filter((food) => food.fdcId !== null)
    return c.json({ foods, totalHits: finiteNumber(payload.totalHits) ?? foods.length, currentPage: finiteNumber(payload.currentPage) ?? 1, totalPages: finiteNumber(payload.totalPages) ?? (foods.length ? 1 : 0) })
  } catch (error) { return respondWithError(c, error) }
})

app.get('/api/foods/:fdcId', async (c) => {
  const fdcId = c.req.param('fdcId')
  if (!/^\d+$/.test(fdcId) || Number(fdcId) <= 0) return c.json({ error: { code: 'INVALID_FDC_ID', message: 'L’identifiant fdcId doit être un entier positif.' } }, 400)
  try {
    const payload = await requestFdc('/food/' + fdcId, c.env.FDC_API_KEY)
    if (!isRecord(payload) || finiteNumber(payload.fdcId) === null) throw new FdcError(502, 'FDC_INVALID_RESPONSE', 'FoodData Central a retourné une réponse invalide.')
    const nutrients = Array.isArray(payload.foodNutrients) ? payload.foodNutrients.filter(isRecord).map(mapDetailNutrient).filter((nutrient): nutrient is FoodNutrient => nutrient !== null) : []
    return c.json({ fdcId: finiteNumber(payload.fdcId), description: stringValue(payload.description), dataType: stringValue(payload.dataType), foodCategory: stringValue(payload.foodCategory), brandOwner: stringValue(payload.brandOwner), nutrients, keyNutrients: selectKeyNutrients(nutrients) })
  } catch (error) { return respondWithError(c, error) }
})

app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route introuvable.' } }, 404))
app.onError((_error, c) => c.json({ error: { code: 'INTERNAL_ERROR', message: 'Une erreur interne est survenue.' } }, 500))

async function requestFdc(path: string, apiKey: string | undefined, params: Record<string, string> = {}): Promise<unknown> {
  const key = apiKey?.trim()
  if (!key) throw new FdcError(503, 'FDC_UNAVAILABLE', 'La source USDA n’est pas configurée.')
  const url = new URL(FDC_API_BASE + path)
  url.searchParams.set('api_key', key)
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal })
    if (!response.ok) {
      if (response.status === 404 && path.startsWith('/food/')) throw new FdcError(404, 'FDC_FOOD_NOT_FOUND', 'Aliment introuvable dans FoodData Central.')
      if (response.status === 429) throw new FdcError(429, 'FDC_RATE_LIMITED', 'La limite de requêtes USDA est atteinte. Réessayez plus tard.')
      throw new FdcError(502, 'FDC_REJECTED', 'FoodData Central n’a pas pu traiter la requête.')
    }
    return await response.json() as unknown
  } catch (error) {
    if (error instanceof FdcError) throw error
    if (controller.signal.aborted) throw new FdcError(504, 'FDC_TIMEOUT', 'FoodData Central ne répond pas dans le délai prévu.')
    throw new FdcError(502, 'FDC_UNAVAILABLE', 'FoodData Central est temporairement inaccessible.')
  } finally { clearTimeout(timeoutId) }
}

function mapSearchFood(food: JsonRecord) {
  const nutrients = Array.isArray(food.foodNutrients) ? food.foodNutrients.filter(isRecord).map(mapSearchNutrient).filter((nutrient): nutrient is FoodNutrient => nutrient !== null) : []
  return { fdcId: finiteNumber(food.fdcId), description: stringValue(food.description), dataType: stringValue(food.dataType), brandOwner: stringValue(food.brandOwner), nutrients }
}
function mapSearchNutrient(raw: JsonRecord): FoodNutrient | null {
  const name = stringValue(raw.nutrientName) ?? stringValue(raw.name)
  if (!name) return null
  return { id: finiteNumber(raw.nutrientId) ?? finiteNumber(raw.id), name, unitName: stringValue(raw.unitName) ?? '', value: nutrientValue(raw.value ?? raw.amount) }
}
function mapDetailNutrient(raw: JsonRecord): FoodNutrient | null {
  const nutrient = isRecord(raw.nutrient) ? raw.nutrient : raw
  const name = stringValue(nutrient.name) ?? stringValue(raw.nutrientName)
  if (!name) return null
  const id = finiteNumber(nutrient.id) ?? finiteNumber(raw.nutrientId) ?? finiteNumber(nutrient.number)
  return { id, name, unitName: stringValue(nutrient.unitName) ?? stringValue(raw.unitName) ?? '', value: nutrientValue(raw.amount ?? raw.value) }
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
function nutrientValue(value: unknown): NutrientValue {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return value
  return null
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

export default app
