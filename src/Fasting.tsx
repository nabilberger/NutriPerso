import { useEffect, useState } from 'react'
import { fastingClock, fastingLabels, type FastingEvent, type FastingPlan } from './fasting-clock'

const prefix = 'nutrip-fasting-notices-v1:'
function selectedEvents(userId: string): FastingEvent[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(prefix + userId) ?? '[]')
    return Array.isArray(value) ? value.filter((key): key is FastingEvent => typeof key === 'string' && Object.hasOwn(fastingLabels, key)) : []
  } catch { return [] }
}

export function FastingSettings({ userId }: { userId: string }) {
  const [selected, setSelected] = useState(() => selectedEvents(userId))
  const [message, setMessage] = useState('')
  const supported = 'Notification' in window && 'serviceWorker' in navigator

  async function toggle(event: FastingEvent, checked: boolean) {
    if (checked) {
      try {
        if (!supported || await Notification.requestPermission() !== 'granted') {
          setMessage('Notifications désactivées dans le navigateur.')
          return
        }
      } catch { setMessage('Permission de notification indisponible.'); return }
    }
    const current = selectedEvents(userId)
    const next = checked ? [...new Set([...current, event])] : current.filter(item => item !== event)
    try {
      localStorage.setItem(prefix + userId, JSON.stringify(next))
      setSelected(next)
      setMessage(checked ? 'Rappel activé sur cet appareil.' : 'Rappel désactivé.')
    } catch { setMessage('Impossible de conserver ce choix sur cet appareil.') }
  }

  return <section className="fasting-settings">
    <h3>Rappels de jeûne</h3>
    <p>Le début du jeûne ferme la fenêtre alimentaire. Sa fin la rouvre. Les rappels de cet appareil nécessitent que NutriPerso reste ouvert.</p>
    {(Object.keys(fastingLabels) as FastingEvent[]).map(event => <label className="profile-check" key={event}>
      <input type="checkbox" checked={selected.includes(event)} disabled={!supported} onChange={e => void toggle(event, e.target.checked)}/>
      {fastingLabels[event]}
    </label>)}
    {message && <p role="status">{message}</p>}
  </section>
}

export function FastingMonitor({ profile, userId, show }: { profile: FastingPlan | null; userId: string; show: boolean }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!profile?.fastingEnabled) return
    let live = true
    function tick() {
      const time = new Date()
      setNow(time)
      if (!profile || !('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return
      const state = fastingClock(profile, time)
      if (!state?.due.length) return
      void navigator.serviceWorker.getRegistration().then(async registration => {
        if (!registration?.active || !live) return
        for (const event of state.due) {
          if (!selectedEvents(userId).includes(event)) continue
          const key = prefix + userId + ':' + event
          if (localStorage.getItem(key) === state.date) continue
          localStorage.setItem(key, state.date)
          try {
            await registration.showNotification('NutriPerso', { body: fastingLabels[event], tag: key + ':' + state.date })
          } catch { localStorage.removeItem(key) }
        }
      }).catch(() => { /* Settings remain usable when browser notifications are unavailable. */ })
    }
    tick()
    const timer = setInterval(tick, 15_000)
    return () => { live = false; clearInterval(timer) }
  }, [profile, userId])

  const state = profile ? fastingClock(profile, now) : null
  return show && state ? <p className="fasting-indicator">{state.fasting ? 'Jeûne en cours' : 'Fenêtre alimentaire ouverte'}</p> : null
}
