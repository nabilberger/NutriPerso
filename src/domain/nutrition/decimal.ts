/** Exact base-10 values and rational arithmetic for nutrition calculations. */

export const MAX_DECIMAL_TEXT_LENGTH = 64
export const MAX_DECIMAL_INTEGER_DIGITS = 24
export const MAX_DECIMAL_SCALE = 18
export const MAX_FRACTION_DIGITS = 4_096
export const MAX_OUTPUT_SCALE = 18

export type ExactDecimal = {
  readonly coefficient: bigint
  readonly scale: number
}

/** A reduced rational. The denominator is always positive. */
export type ExactFraction = {
  readonly numerator: bigint
  readonly denominator: bigint
}

export type DecimalErrorCode =
  | 'INVALID_DECIMAL'
  | 'DECIMAL_LIMIT_EXCEEDED'
  | 'DIVISION_BY_ZERO'
  | 'NUMERIC_LIMIT_EXCEEDED'

export class DecimalError extends Error {
  readonly code: DecimalErrorCode

  constructor(code: DecimalErrorCode, message: string) {
    super(message)
    this.name = 'DecimalError'
    this.code = code
  }
}

const POWERS_OF_TEN: bigint[] = [1n]

function powerOfTen(scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_FRACTION_DIGITS) {
    throw new DecimalError('DECIMAL_LIMIT_EXCEEDED', 'Échelle décimale hors limites.')
  }
  while (POWERS_OF_TEN.length <= scale) {
    POWERS_OF_TEN.push(POWERS_OF_TEN[POWERS_OF_TEN.length - 1]! * 10n)
  }
  return POWERS_OF_TEN[scale]!
}

/** Parses plain or scientific decimal notation without converting through number. */
export function parseDecimal(value: string): ExactDecimal {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_DECIMAL_TEXT_LENGTH) {
    throw new DecimalError('INVALID_DECIMAL', 'La valeur décimale est absente ou trop longue.')
  }
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value)
  if (!match) throw new DecimalError('INVALID_DECIMAL', 'La valeur doit être une décimale valide.')

  const sourceIntegerPart = match[2]!
  const sourceFractionPart = match[3] ?? ''
  const exponentText = match[4] ?? '0'
  if (exponentText.length > 4) throw new DecimalError('DECIMAL_LIMIT_EXCEEDED', 'L’exposant décimal dépasse la limite autorisée.')
  const exponent = Number(exponentText)
  if (!Number.isSafeInteger(exponent)) throw new DecimalError('DECIMAL_LIMIT_EXCEEDED', 'L’exposant décimal dépasse la limite autorisée.')
  if (sourceFractionPart.length - exponent > MAX_DECIMAL_SCALE
    || sourceIntegerPart.length + exponent > MAX_DECIMAL_INTEGER_DIGITS) {
    throw new DecimalError('DECIMAL_LIMIT_EXCEEDED', 'La précision ou l’échelle décimale dépasse la limite autorisée.')
  }

  const digits = `${sourceIntegerPart}${sourceFractionPart}`
  const decimalPosition = sourceIntegerPart.length + exponent
  let integerPart: string
  let fractionPart: string
  if (decimalPosition <= 0) {
    integerPart = '0'
    fractionPart = `${'0'.repeat(-decimalPosition)}${digits}`
  } else if (decimalPosition >= digits.length) {
    integerPart = `${digits}${'0'.repeat(decimalPosition - digits.length)}`
    fractionPart = ''
  } else {
    integerPart = digits.slice(0, decimalPosition)
    fractionPart = digits.slice(decimalPosition)
  }

  if (integerPart.length > MAX_DECIMAL_INTEGER_DIGITS || fractionPart.length > MAX_DECIMAL_SCALE) {
    throw new DecimalError('DECIMAL_LIMIT_EXCEEDED', 'La précision ou l’échelle décimale dépasse la limite autorisée.')
  }
  const unsignedCoefficient = BigInt(`${integerPart}${fractionPart}`)
  return { coefficient: match[1] === '-' ? -unsignedCoefficient : unsignedCoefficient, scale: fractionPart.length }
}

export function decimalToFraction(value: ExactDecimal): ExactFraction {
  return makeFraction(value.coefficient, powerOfTen(value.scale))
}

export function fractionFromInteger(value: bigint): ExactFraction {
  return { numerator: value, denominator: 1n }
}

export function makeFraction(numerator: bigint, denominator: bigint): ExactFraction {
  if (denominator === 0n) throw new DecimalError('DIVISION_BY_ZERO', 'Division par zéro.')
  const sign = denominator < 0n ? -1n : 1n
  const signedNumerator = numerator * sign
  const positiveDenominator = denominator * sign
  const divisor = greatestCommonDivisor(abs(signedNumerator), positiveDenominator)
  const result = { numerator: signedNumerator / divisor, denominator: positiveDenominator / divisor }
  assertFractionSize(result)
  return result
}

export function addFractions(left: ExactFraction, right: ExactFraction): ExactFraction {
  const commonDivisor = greatestCommonDivisor(left.denominator, right.denominator)
  const leftFactor = right.denominator / commonDivisor
  const rightFactor = left.denominator / commonDivisor
  return makeFraction(left.numerator * leftFactor + right.numerator * rightFactor, left.denominator * leftFactor)
}

export function multiplyFractions(left: ExactFraction, right: ExactFraction): ExactFraction {
  const firstCancellation = greatestCommonDivisor(abs(left.numerator), right.denominator)
  const secondCancellation = greatestCommonDivisor(abs(right.numerator), left.denominator)
  return makeFraction(
    (left.numerator / firstCancellation) * (right.numerator / secondCancellation),
    (left.denominator / secondCancellation) * (right.denominator / firstCancellation),
  )
}

export function divideFractions(left: ExactFraction, right: ExactFraction): ExactFraction {
  if (right.numerator === 0n) throw new DecimalError('DIVISION_BY_ZERO', 'Division par zéro.')
  return multiplyFractions(left, makeFraction(right.denominator, right.numerator))
}

export function compareFractions(left: ExactFraction, right: ExactFraction): -1 | 0 | 1 {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator
  return difference < 0n ? -1 : difference > 0n ? 1 : 0
}

export function assertFractionAtMost(value: ExactFraction, maximum: ExactFraction): void {
  if (compareFractions({ numerator: abs(value.numerator), denominator: value.denominator }, maximum) > 0) {
    throw new DecimalError('NUMERIC_LIMIT_EXCEEDED', 'La valeur numérique dépasse la limite métier autorisée.')
  }
}

/** Quantizes once using round-half-away-from-zero and emits exactly the requested scale. */
export function fractionToDecimal(value: ExactFraction, scale = 6): string {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_OUTPUT_SCALE) {
    throw new DecimalError('DECIMAL_LIMIT_EXCEEDED', 'La précision de sortie est hors limites.')
  }
  const negative = value.numerator < 0n
  const scaledNumerator = abs(value.numerator) * powerOfTen(scale)
  let rounded = scaledNumerator / value.denominator
  if ((scaledNumerator % value.denominator) * 2n >= value.denominator) rounded += 1n
  const digits = rounded.toString().padStart(scale + 1, '0')
  const whole = scale === 0 ? digits : digits.slice(0, -scale)
  const fraction = scale === 0 ? '' : `.${digits.slice(-scale)}`
  return `${negative && rounded !== 0n ? '-' : ''}${whole}${fraction}`
}

export function isPositive(value: ExactFraction): boolean {
  return value.numerator > 0n
}

export function isNegative(value: ExactFraction): boolean {
  return value.numerator < 0n
}

function assertFractionSize(value: ExactFraction): void {
  if (value.numerator.toString().replace('-', '').length > MAX_FRACTION_DIGITS || value.denominator.toString().length > MAX_FRACTION_DIGITS) {
    throw new DecimalError('NUMERIC_LIMIT_EXCEEDED', 'La fraction calculée dépasse la limite de taille.')
  }
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left
  let b = right
  while (b !== 0n) [a, b] = [b, a % b]
  return a === 0n ? 1n : a
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value
}
