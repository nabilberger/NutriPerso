type SecureCryptoSource = {
  readonly randomUUID?: () => string
  readonly getRandomValues?: (array: Uint8Array) => Uint8Array
}

function currentCrypto(): SecureCryptoSource | undefined {
  if (typeof globalThis === 'undefined' || typeof globalThis.crypto === 'undefined') return undefined
  return globalThis.crypto as unknown as SecureCryptoSource
}

/** Creates a cryptographically strong RFC 4122 UUID v4 across secure and non-secure browser origins. */
export function createUuidV4(source: SecureCryptoSource | undefined = currentCrypto()): string {
  if (typeof source?.randomUUID === 'function') return source.randomUUID()
  if (typeof source?.getRandomValues === 'function') {
    const bytes = source.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6]! & 0x0f) | 0x40
    bytes[8] = (bytes[8]! & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  throw new Error('Impossible de créer un identifiant sûr : la cryptographie sécurisée est indisponible dans ce navigateur.')
}
