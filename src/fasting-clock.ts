export type FastingPlan = {
  fastingEnabled: boolean
  fastingStart: string | null
  fastingEnd: string | null
  timeZone: string
}
export const fastingLabels = {
  start: 'Début du jeûne',
  beforeOpening: 'Fenêtre alimentaire dans 30 minutes',
  opening: 'Ouverture de la fenêtre alimentaire',
  beforeClosing: 'Fermeture de la fenêtre alimentaire dans 30 minutes',
} as const
export type FastingEvent = keyof typeof fastingLabels

function minuteOfDay(time: string | null): number | null {
  if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null
  const [hour, minute] = time.split(':').map(Number)
  return hour! * 60 + minute!
}

export function fastingClock(plan: FastingPlan, now: Date) {
  const start = minuteOfDay(plan.fastingStart)
  const end = minuteOfDay(plan.fastingEnd)
  if (!plan.fastingEnabled || start === null || end === null || start === end) return null
  let local: Intl.DateTimeFormatPart[]
  try {
    local = new Intl.DateTimeFormat('en-CA', {
      timeZone: plan.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now)
  } catch { return null }
  const part = (type: Intl.DateTimeFormatPartTypes) => local.find(p => p.type === type)?.value
  const minute = Number(part('hour')) * 60 + Number(part('minute'))
  const fasting = start < end ? minute >= start && minute < end : minute >= start || minute < end
  const schedule: Record<FastingEvent, number> = {
    start, opening: end, beforeOpening: (end + 1410) % 1440, beforeClosing: (start + 1410) % 1440,
  }
  const due = (Object.keys(schedule) as FastingEvent[]).filter(event => schedule[event] === minute)
  return { date: [part('year'), part('month'), part('day')].join('-'), fasting, due }
}
