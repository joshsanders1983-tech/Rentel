import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase dashboard → Project Settings → API:
 * - Project URL → SUPABASE_URL
 * - anon / public key → SUPABASE_ANON_KEY
 *
 * Rentel still loads all app data through Prisma + DATABASE_URL (Postgres).
 * Use this client when you add Supabase Auth, Storage, Realtime, or REST/RPC calls.
 */
let cached: SupabaseClient | null = null;

export function isSupabaseJsConfigured(): boolean {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_ANON_KEY?.trim();
  return Boolean(url && key);
}

/** Server-side client (Express). Session is not persisted to disk. */
export function getSupabaseClient(): SupabaseClient {
  if (!isSupabaseJsConfigured()) {
    throw new Error(
      "Set SUPABASE_URL and SUPABASE_ANON_KEY in rental-backend/.env (Supabase → Project Settings → API).",
    );
  }
  if (!cached) {
    cached = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
  }
  return cached;
}
