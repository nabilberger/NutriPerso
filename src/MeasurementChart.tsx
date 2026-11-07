import { useMemo, useState } from 'react'
type ChartMeasure = { id: string; measuredOn: string; value: number; note?: string }
const dayMs = 86_400_000
const dayTime = (date: string) => Date.parse(date + 'T00:00:00Z')
const shortDate = new Intl.DateTimeFormat('fr', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const measurementNumber = new Intl.NumberFormat('fr', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export default function MeasurementChart({ items, target, unit, label }: {
  items: readonly ChartMeasure[]; target: number | null; unit: 'kg' | 'cm'; label: string
}) {
  const [period, setPeriod] = useState<'week' | 'month' | 'custom'>('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const all = useMemo(() => [...items].sort((a, b) => a.measuredOn.localeCompare(b.measuredOn)), [items])
  const latest = all.at(-1)?.measuredOn
  const invalid = period === 'custom' && !!from && !!to && from > to
  const minimum = period === 'custom' ? (from ? dayTime(from) : -Infinity) : latest ? dayTime(latest) - (period === 'week' ? 6 : 29) * dayMs : -Infinity
  const maximum = period === 'custom' ? (to ? dayTime(to) : Infinity) : latest ? dayTime(latest) : Infinity
  const rows = invalid ? [] : all.filter(item => dayTime(item.measuredOn) >= minimum && dayTime(item.measuredOn) <= maximum)
  const first = rows[0], last = rows.at(-1)
  const current = rows.find(row => row.id === selected) ?? last
  const start = first ? dayTime(first.measuredOn) : 0
  const span = last ? dayTime(last.measuredOn) - start : 0
  const values = rows.map(row => row.value)
  if (target !== null) values.push(target)
  const low = Math.floor(Math.min(...values)) - 1
  const high = Math.ceil(Math.max(...values)) + 1
  const x = (row: ChartMeasure) => span ? 44 + 286 * (dayTime(row.measuredOn) - start) / span : 187
  const y = (value: number) => 145 - 116 * (value - low) / (high - low)
  const points = rows.map(row => x(row) + ',' + y(row.value)).join(' ')
  return <div className="weight-chart">
    <fieldset className="weight-period"><legend>Période</legend>
      {([['week', 'Semaine'], ['month', 'Mois'], ['custom', 'Personnalisée']] as const).map(([value, label]) =>
        <button key={value} type="button" aria-pressed={period === value} onClick={() => { setPeriod(value); setSelected(null) }}>{label}</button>)}
    </fieldset>
    {period === 'custom' && <div className="weight-dates">
      <label>Du <input type="date" value={from} onChange={event => setFrom(event.target.value)}/></label>
      <label>Au <input type="date" value={to} onChange={event => setTo(event.target.value)}/></label>
    </div>}
    {invalid ? <p role="alert">La date de début doit précéder la date de fin.</p>
      : !first || !last || !current ? <p className="data-empty">Aucune mesure sur cette période.</p>
      : <>
        <svg viewBox="0 0 360 177" role="group" aria-label={label}>
          {[0, 1, 2, 3].map(i => {
            const value = high - (high - low) * i / 3
            return <g key={i} className="weight-grid"><line x1="44" x2="330" y1={y(value)} y2={y(value)}/><text x="37" y={y(value)+3} textAnchor="end">{measurementNumber.format(value)}</text></g>
          })}
          {span > 0 && <polygon className="weight-area" points={x(first)+',145 '+points+' '+x(last)+',145'}/>}
          {target !== null && <line className="weight-target" x1="44" x2="330" y1={y(target)} y2={y(target)}><title>Cible {target} {unit}</title></line>}
          <polyline className="weight-line" points={points}/>
          {rows.map(row => <g key={row.id} role="button" tabIndex={0} aria-pressed={row.id === current.id}
            aria-label={row.measuredOn + ' · ' + measurementNumber.format(row.value) + ' ' + unit}
            onFocus={() => setSelected(row.id)} onPointerEnter={() => setSelected(row.id)} onClick={() => setSelected(row.id)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(row.id) } }}>
            <circle cx={x(row)} cy={y(row.value)} r="13" fill="transparent"/>
            <circle className="weight-point" cx={x(row)} cy={y(row.value)} r={row.id === current.id ? 5 : 3.5}/>
          </g>)}
          <text className="weight-axis-date" x="44" y="166">{shortDate.format(start)}</text>
          {span > 0 && <text className="weight-axis-date" x="330" y="166" textAnchor="end">{shortDate.format(dayTime(last.measuredOn))}</text>}
        </svg>
        <p className="weight-detail" role="status"><time dateTime={current.measuredOn}>{current.measuredOn}</time> · <strong>{measurementNumber.format(current.value)} {unit}</strong>{current.note && ' · '+current.note}</p>
      </>}
  </div>
}
