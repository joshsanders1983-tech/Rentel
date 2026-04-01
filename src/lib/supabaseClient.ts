/**
 * Supabase dashboard → Project Settings → API:
 * - Project URL → SUPABASE_URL
 * - anon / public key → SUPABASE_ANON_KEY
 *
 * Rentel loads app data through Prisma + DATABASE_URL (Postgres). `GET /health` reports
 * whether these vars are set. When you add Supabase Auth, Storage, or Realtime, use
 * `createClient` from `@supabase/supabase-js` in the route or module that needs it.
 */
export function isSupabaseJsConfigured(): boolean {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_ANON_KEY?.trim();
  return Boolean(url && key);
}
