import { coachSkills, type CoachAnswer, type CoachSkill } from '../../src/coach-contract.ts'
import { calculateJournalDay, selectActiveMealSnapshots } from '../../src/domain/nutrition/journal.ts'
import { coachPrompt } from './coach-prompt.ts'
import { photoRpc, type PhotoEnv } from './photo-service.ts'
import { getActiveJournalSnapshots, getJournalPersistenceForDate } from './supabase-journal.ts'
import { listMeasurements } from './supabase-measurements.ts'
import { getProfile } from './supabase-profile.ts'

export type CoachEnv = PhotoEnv & { COACH_ENABLED?: string }
export class CoachInputError extends Error {}

const fields = ['recorded', 'suggestions', 'uncertainty'] as const
const schema = {
  type: 'object', required: fields, additionalProperties: false,
  properties: Object.fromEntries(fields.map(key => [key, { type: 'string' }])),
}
const boundedText = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= limit

export async function readCoachJson(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<unknown> {
  if (!stream) throw new CoachInputError()
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) { await reader.cancel(); throw new CoachInputError() }
    text += decoder.decode(value, { stream: true })
  }
  try { return JSON.parse(text + decoder.decode()) }
  catch { throw new CoachInputError() }
}

function readInput(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CoachInputError()
  const { skill, question, prior = [] } = input as Record<string, unknown>
  if (typeof skill !== 'string' || !Object.hasOwn(coachSkills, skill) || !boundedText(question, 800)
    || !Array.isArray(prior) || prior.length > 4 || !prior.every(line => boundedText(line, 1200))) throw new CoachInputError()
  return { skill: skill as CoachSkill, question: question.trim(), prior: prior as string[] }
}

async function buildContext(env: CoachEnv, userId: string, skill: CoachSkill, fetcher: typeof fetch) {
  const profile = await getProfile(env, userId, fetcher)
  const { goal, targetWeightKg, dietaryPattern, mealsPerDay, avoidAddedSalt, avoidAddedSugar, timeZone } = profile
  const preferences = { dietaryPattern, avoidAddedSalt, avoidAddedSugar }
  if (skill === 'weight') {
    const measurements = await listMeasurements(env, userId, fetcher)
    return { goal, targetWeightKg, measurements: measurements.slice(0, 20).map(({ measuredOn, weightKg }) => ({ measuredOn, weightKg })) }
  }
  if (skill === 'recipe' || skill === 'cooking') return preferences
  if (skill === 'history') {
    const meals = await getActiveJournalSnapshots(env, { userId }, fetcher)
    return { meals: [...meals].sort((a, b) => b.localDate.localeCompare(a.localDate))
      .slice(0, 14).map(meal => ({ date: meal.localDate, kind: meal.mealKind, totals: meal.status === 'confirmed' ? meal.totals : null,
        foods: meal.items.slice(0, 12).map(item => (item.kind === 'food' ? item.foodSnapshot.description : item.recipeSnapshot.recipe.name).slice(0, 120)) })) }
  }
  const date = new Intl.DateTimeFormat('fr-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const journal = await getJournalPersistenceForDate(env, { userId }, date, fetcher)
  const today = { date, confirmedMeals: journal ? selectActiveMealSnapshots(journal.snapshots).length : 0,
    totals: journal ? calculateJournalDay({ days: [journal.day], snapshots: journal.snapshots }, journal.day.id) : null }
  return skill === 'meals' ? { ...preferences, goal, targetWeightKg, mealsPerDay, today } : today
}

export async function askCoach(env: CoachEnv, userId: string, payload: unknown, fetcher: typeof fetch): Promise<CoachAnswer> {
  const input = readInput(payload)
  const model = env.GEMINI_MODEL
  const cost = Number(env.AI_REQUEST_MAX_DH)
  if (!env.GEMINI_API_KEY || !model || !/^[a-zA-Z0-9.-]{1,100}$/.test(model) || !(cost > 0 && cost <= 0.10)) throw new Error()
  const context = await buildContext(env, userId, input.skill, fetcher)
  const data = JSON.stringify({ question: input.question, prior: input.prior, context })
  if (new TextEncoder().encode(data).length > 24_000) throw new Error()

  const id = crypto.randomUUID()
  await photoRpc(env, 'reserve_photo_analysis', { p_user: userId, p_id: id, p_cost: cost, p_model: model }, fetcher)
  const response = await fetcher('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'POST', signal: AbortSignal.timeout(25_000),
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: coachPrompt(input.skill) }] },
      contents: [{ parts: [{ text: data }] }],
      generationConfig: { maxOutputTokens: 1200, responseMimeType: 'application/json', responseJsonSchema: schema },
    }),
  })
  if (!response.ok) throw new Error()
  const raw = await readCoachJson(response.body, 48_000).catch(() => { throw new Error() }) as {
    candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[]
    usageMetadata?: { totalTokenCount?: number }
  }
  const candidate = raw.candidates?.[0]
  if (raw.candidates?.length !== 1 || candidate?.finishReason !== 'STOP') throw new Error()
  const answer = JSON.parse(candidate.content?.parts?.map(part => part.text ?? '').join('') ?? '') as CoachAnswer
  if (!answer || !fields.every(key => boundedText(answer[key], 3000))) throw new Error()
  const tokens = raw.usageMetadata?.totalTokenCount
  await photoRpc(env, 'finish_photo_analysis', { p_user: userId, p_id: id, p_tokens: Number.isSafeInteger(tokens) && tokens! >= 0 ? tokens : 0 }, fetcher)
  return { recorded: answer.recorded, suggestions: answer.suggestions, uncertainty: answer.uncertainty }
}
