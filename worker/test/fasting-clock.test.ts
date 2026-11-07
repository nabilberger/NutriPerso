import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fastingClock } from '../../src/fasting-clock.ts'

const plan = { fastingEnabled: true, fastingStart: '20:00', fastingEnd: '12:00', timeZone: 'Europe/Paris' }
const at = (time: string) => fastingClock(plan, new Date('2026-11-07T'+time+':00Z'))

test('fasting uses the profile time zone and handles the overnight interval', () => {
  assert.deepEqual(at('19:00'), { date: '2026-11-07', fasting: true, due: ['start'] })
  assert.equal(at('23:15')?.date, '2026-11-08')
  assert.equal(at('23:15')?.fasting, true)
  assert.deepEqual(at('10:30')?.due, ['beforeOpening'])
  assert.deepEqual(at('11:00'), { date: '2026-11-07', fasting: false, due: ['opening'] })
  assert.deepEqual(at('18:30')?.due, ['beforeClosing'])
  assert.equal(fastingClock({ ...plan, fastingEnabled: false }, new Date()), null)
})
