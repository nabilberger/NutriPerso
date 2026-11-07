import { useEffect, useState, type FormEvent } from 'react'
import { requestPrivateJson } from './auth/client'
import MeasurementChart from './MeasurementChart'

type Measure = { id: string; measuredOn: string; waistCm: number }
const numberFormat = new Intl.NumberFormat('fr', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export default function WaistTracking({ today }: { today: string }) {
  const [rows, setRows] = useState<Measure[] | null>(null)
  const [date, setDate] = useState(today)
  const [cm, setCm] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const path = '/api/private/waist-measurements'

  useEffect(() => {
    let live = true
    void requestPrivateJson<{ measurements: Measure[] }>(path)
      .then(result => { if (live) setRows(result.measurements) })
      .catch(() => { if (live) setError('Le suivi du tour de taille est indisponible.') })
    return () => { live = false }
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(''); setStatus('')
    try {
      const { measurement } = await requestPrivateJson<{ measurement: Measure }>(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ measuredOn: date, waistCm: Number(cm) }),
      })
      setRows(previous => [measurement, ...(previous ?? [])].sort((a, b) => b.measuredOn.localeCompare(a.measuredOn)))
      setCm(''); setStatus('Tour de taille enregistré.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Enregistrement impossible.')
    } finally { setBusy(false) }
  }

  async function remove(row: Measure) {
    if (!window.confirm('Supprimer cette mesure de tour de taille ?')) return
    setBusy(true); setError(''); setStatus('')
    try {
      await requestPrivateJson(path + '/' + encodeURIComponent(row.id), { method: 'DELETE' })
      setRows(previous => previous?.filter(item => item.id !== row.id) ?? [])
      setStatus('Mesure de tour de taille supprimée.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Suppression impossible.')
    } finally { setBusy(false) }
  }

  return <section className="data-card weight-history" aria-label="Tour de taille">
    <h2>Tour de taille</h2><p className="data-muted">Les mesures en centimètres sont indépendantes du poids.</p>
    {error && <p role="alert" className="data-error">{error}</p>}
    {status && <p role="status" className="profile-feedback">{status}</p>}
    {rows === null ? !error && <p>Chargement des mesures…</p> : <>
      <form className="measurement-form" onSubmit={event => void save(event)}>
        <label>Date du tour de taille<input required type="date" value={date} onChange={event => setDate(event.target.value)}/></label>
        <label>Tour de taille (cm)<input required type="number" min="30" max="300" step="0.1" value={cm} onChange={event => setCm(event.target.value)}/></label>
        <button disabled={busy}>{busy ? 'Traitement…' : 'Enregistrer le tour de taille'}</button>
      </form>
      {rows.length ? <div className="measurement-list">{rows.map(row => <div key={row.id}>
        <time dateTime={row.measuredOn}>{row.measuredOn}</time><strong>{numberFormat.format(row.waistCm)} cm</strong>
        <button type="button" disabled={busy} onClick={() => void remove(row)} aria-label={'Supprimer le tour de taille du '+row.measuredOn}>Supprimer</button>
      </div>)}</div> : <p className="data-muted">Aucune mesure de tour de taille.</p>}
      {rows.length > 0 && <MeasurementChart items={rows.map(row => ({ ...row, value: row.waistCm }))} target={null} unit="cm" label="Évolution du tour de taille en centimètres"/>}
    </>}
  </section>
}
