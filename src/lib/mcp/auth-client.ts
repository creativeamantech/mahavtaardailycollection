// Real Supabase browser client, used only by the agent sign-in and OAuth
// consent routes. The shared stub in src/integrations/supabase/client.ts is
// left untouched; this app's pages do not require sign-in, but connecting an
// external assistant does.
import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env["VITE_SUPABASE_URL"]) ||
  "https://placeholder-project.supabase.co";

const supabaseAnonKey =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"]) ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder";

export const authSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
