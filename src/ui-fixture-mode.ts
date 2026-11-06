export function shouldEnableUiFixtures(isDevelopment: boolean, configuredValue: string | undefined): boolean {
  return isDevelopment && configuredValue === '1'
}
export const uiFixtureMode = shouldEnableUiFixtures(import.meta.env?.DEV === true, import.meta.env?.VITE_NUTRIPERSO_UI_FIXTURES)
