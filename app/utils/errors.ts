/** Supabase errors are plain objects with a `message`, not Error instances. */
export function errorMessage(e: unknown): string {
  if (typeof e === 'object' && e && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}
