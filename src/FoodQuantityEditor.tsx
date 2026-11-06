import { useEffect, useState } from 'react'
import { decimalToFraction, parseDecimal } from './domain/nutrition/decimal'
import { resolveFoodQuantity, type FoodQuantityInput } from './domain/nutrition/portions'
import type { FoodNutritionSnapshot } from './domain/nutrition/recipes'
export default function FoodQuantityEditor({ food, quantity, onChange, raw = false, amountLabel = 'Quantité consommée', unitLabel = 'Unité', weightLabel = 'Poids' }: {
  food?: FoodNutritionSnapshot; quantity: FoodQuantityInput; onChange: (q: FoodQuantityInput) => void; raw?: boolean; amountLabel?: string; unitLabel?: string; weightLabel?: string
}) {
  const [amount, setAmount] = useState(quantity.amount)
  useEffect(() => setAmount(quantity.amount), [quantity.amount])
  const portions = food?.portionEquivalences ?? []
  const selected = quantity.kind === 'serving' ? 'portion:' + quantity.equivalenceId : quantity.unit
  function change(q: FoodQuantityInput) {
    if (raw) { onChange(q); return }
    try { if (decimalToFraction(parseDecimal(q.amount)).numerator <= 0n) return; resolveFoodQuantity(food?.foodId ?? 'unknown', q, portions); onChange(q) } catch { /* Incomplete text stays local until blur. */ }
  }
  const selectedPortion=quantity.kind==='serving'?portions.find(p=>p.id===quantity.equivalenceId):undefined
  return <div className="journal-quantity recipe-fields"><label>Quantité<input aria-label={amountLabel} inputMode="decimal" value={amount} onChange={e => { const value=e.target.value.replace(',', '.');setAmount(value);change({...quantity,amount:value}) }} onBlur={() => { if(!raw)setAmount(quantity.amount) }}/></label>
    <label>{unitLabel}<select aria-label={unitLabel} value={selected} onChange={e => {
      const value=e.target.value, portion=portions.find(p=>'portion:'+p.id===value)
      if(portion)change({kind:'serving',amount:quantity.kind==='serving'?quantity.amount:'1',unit:portion.unit,equivalenceId:portion.id})
      else if(value==='g'||value==='kg')change({kind:'physical',amount:quantity.amount,unit:value,weightNature:'edible'})
      else if(value==='ml'||value==='l')change({kind:'physical',amount:quantity.amount,unit:value,weightNature:'not-applicable'})
    }}><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option>{portions.map(p=><option value={'portion:'+p.id} key={p.id}>{p.label}{p.status==='unknown'?' (équivalence inconnue)':''}</option>)}{quantity.kind==='serving'&&!portions.some(p=>p.id===quantity.equivalenceId)&&<option value={selected}>Portion indisponible</option>}</select></label>
    {quantity.kind==='physical'&&(quantity.unit==='g'||quantity.unit==='kg')&&<label>{weightLabel}<select aria-label={weightLabel} value={quantity.weightNature} onChange={e=>{const q=quantity;if(q.unit==='g'||q.unit==='kg')change({...q,weightNature:e.target.value as 'edible'|'gross'|'unknown'})}}><option value="edible">Comestible</option><option value="gross">Brut</option><option value="unknown">Inconnu</option></select></label>}
    {selectedPortion&&<small>{selectedPortion.status==='validated'?`1 ${selectedPortion.label} = ${selectedPortion.equivalentAmount} ${selectedPortion.equivalentUnit}`:'Équivalence non mesurée : apports inconnus.'}</small>}
  </div>
}
