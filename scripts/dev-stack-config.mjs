export const requiredWorkerVars = Object.freeze([
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'FDC_API_KEY',
])
export function missingWorkerVars(contents) {
  return requiredWorkerVars.filter((name) => !new RegExp('^\\s*' + name + '\\s*=', 'm').test(contents))
}
