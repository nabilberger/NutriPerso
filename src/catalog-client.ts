import { uiFixtureMode } from './ui-fixture-mode'
import { fixtureRequest } from './dev-ui-fixtures'

/** Keep synthetic UI catalog requests inside the fixture adapter. */
export async function requestFoodCatalog(path: string): Promise<Response> {
  if (uiFixtureMode) return Response.json(await fixtureRequest(path))
  return fetch(path, { cache: 'no-store' })
}
