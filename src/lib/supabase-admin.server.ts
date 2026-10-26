import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

// Privileged admin client for server-side work only. Import this file with a
// dynamic import inside a server-function handler so it never enters a client
// bundle. Ordinary reads should not use it.
export function createAdminClient(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_SERVICE_ROLE_KEY"]!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
