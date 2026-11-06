/** Decode the Worker API contract, including successful DELETE responses without a body. */
export async function readPrivateJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const message = isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string'
      ? body.error.message : `La requête a échoué (HTTP ${response.status}).`
    throw new Error(message)
  }
  if (response.status === 204 || response.status === 205) return undefined as T
  return await response.json() as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
