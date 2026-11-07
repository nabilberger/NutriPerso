import { uiFixtureMode } from './ui-fixture-mode'

/** Keep synthetic UI catalog requests inside the fixture adapter. */
export async function requestFoodCatalog(path: string): Promise<Response> {
  if (uiFixtureMode && import.meta.env.DEV) {
    const { fixtureRequest } = await import('./dev-ui-fixtures')
    return Response.json(await fixtureRequest(path))
  }
  return fetch(path, { cache: 'no-store' })
}
