import type { NutrientTotal } from './domain/nutrition/types'
import { fractionToDecimal } from './domain/nutrition/decimal'
export function formatTotal(total: NutrientTotal | undefined, unit: string): string {
  if (!total) return 'Inconnu'
  const scale = unit === 'kcal' ? 0 : 1
  if (total.status === 'unknown') return 'Inconnu'
  const fraction = total.status === 'complete' ? total.exactValue : total.exactKnownSubtotal
  const value = fraction
    ? fractionToDecimal({ numerator: BigInt(fraction.numerator), denominator: BigInt(fraction.denominator) }, scale)
    : total.status === 'complete' ? total.value : total.knownSubtotal
  return total.status === 'partial' ? `≥ ${value} ${unit} · partiel` : `${value} ${unit}`
}
