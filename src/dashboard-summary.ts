import { decimalToFraction, fractionToDecimal, parseDecimal } from './domain/nutrition/decimal.ts'
import type { NutrientTotal } from './domain/nutrition/types.ts'

/** Dashboard energy is an integer display value; exact nutrition fractions remain untouched. */
export function formatDashboardEnergy(total: NutrientTotal | undefined, hasMeals: boolean): string {
  if (!total) return hasMeals ? 'Inconnu' : '—'
  if (total.status === 'unknown') return 'Inconnu'
  const exact = total.status === 'complete' ? total.exactValue : total.exactKnownSubtotal
  const serialized = exact
    ? { numerator: BigInt(exact.numerator), denominator: BigInt(exact.denominator) }
    : decimalToFraction(parseDecimal(total.status === 'complete' ? total.value : total.knownSubtotal))
  const value = fractionToDecimal(serialized, 0)
  return total.status === 'partial' ? value + '*' : value
}
