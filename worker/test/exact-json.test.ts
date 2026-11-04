import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseJsonWithExactNumbers, parseWithLexicalFallback } from '../src/exact-json.ts'

const longValue = '0.12345678901234567890123456789'

test('lossless JSON parsing preserves zero, long decimals, exponents and integer source tokens', () => {
  const json = `{"zero":0,"long":${longValue},"exponent":1.2345e-7,"integer":2706091,"text":"1.2345e-7"}`
  const expected = { zero: '0', long: longValue, exponent: '1.2345e-7', integer: '2706091', text: '1.2345e-7' }
  assert.deepEqual(parseJsonWithExactNumbers(json), expected)
  assert.deepEqual(parseWithLexicalFallback(json), expected)
})

test('lossless fallback validates JSON and rejects malformed numeric tokens', () => {
  for (const input of ['{"value":01}', '{"value":1.}', '{"value":1e}', '{"value":NaN}', '{"value":1x}']) {
    assert.throws(() => parseWithLexicalFallback(input), SyntaxError)
  }
})
