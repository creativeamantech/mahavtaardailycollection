// Real Supabase browser client, used only by the agent sign-in and OAuth
// consent routes. The shared stub in src/integrations/supabase/client.ts is
// left untouched; this app's pages do not require sign-in, but connecting an
// external assistant does.
import { createClient } from "@supabase/supabase-js";

export const authSupabase = createClient(
  import.meta.env["VITE_SUPABASE_URL"] as string,
  import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string,
  { auth: { persistSession: true, autoRefreshToken: true } },
);
