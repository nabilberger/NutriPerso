/**
 * Parses JSON without rounding numeric tokens through IEEE-754 numbers.
 * All JSON numbers are returned as their exact source text. Ordinary string
 * values remain strings, so callers should convert only metadata fields that
 * are intentionally numeric (IDs, scores, etc.).
 */
export function parseJsonWithExactNumbers(text: string): unknown {
  return supportsJsonSourceContext()
    ? parseWithSourceContext(text)
    : parseWithLexicalFallback(text)
}

/** Exported to exercise the fallback even on runtimes with context.source. */
export function parseWithLexicalFallback(text: string): unknown {
  let output = ''
  let index = 0

  while (index < text.length) {
    const character = text[index]!
    if (character === '"') {
      const start = index++
      while (index < text.length) {
        if (text[index] === '\\') {
          index += 2
          continue
        }
        if (text[index] === '"') {
          index += 1
          break
        }
        index += 1
      }
      output += text.slice(start, index)
      continue
    }

    if (character === '-' || isDigit(character)) {
      const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index))
      if (!match) throw new SyntaxError('JSON contient un nombre invalide.')
      const token = match[0]
      const next = text[index + token.length]
      if (next !== undefined && !/[\s,}\]]/.test(next)) {
        throw new SyntaxError('JSON contient un nombre invalide.')
      }
      output += JSON.stringify(token)
      index += token.length
      continue
    }

    output += character
    index += 1
  }

  return JSON.parse(output) as unknown
}

let hasSourceContext: boolean | undefined

function supportsJsonSourceContext(): boolean {
  if (hasSourceContext !== undefined) return hasSourceContext
  try {
    let observed: string | undefined
    JSON.parse('12345678901234567890', (_key, _value, context?: { source?: string }) => {
      observed = context?.source
      return undefined
    })
    hasSourceContext = observed === '12345678901234567890'
  } catch {
    hasSourceContext = false
  }
  return hasSourceContext
}

function parseWithSourceContext(text: string): unknown {
  return JSON.parse(text, (_key, value, context?: { source?: string }) =>
    typeof value === 'number' ? context?.source ?? value : value) as unknown
}

function isDigit(value: string): boolean {
  return value >= '0' && value <= '9'
}
