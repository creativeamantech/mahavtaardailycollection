import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

// Privileged admin client for server-side work only. Import this file with a
// dynamic import inside a server-function handler so it never enters a client
// bundle. Ordinary reads should not use it.
export function createAdminClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env["SUPABASE_URL"] || "https://placeholder-project.supabase.co";
  const key =
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder";

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
