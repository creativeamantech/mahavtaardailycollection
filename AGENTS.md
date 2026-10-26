<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

- MCP server lives in src/lib/mcp/ (one read-only tool per file, protected by sign-in OAuth; only allow-listed emails can create accounts); tools reuse the existing server functions so report rules (Already Paid exclusion) stay identical.
- All app pages live under src/routes/_authenticated and every server function uses requireSupabaseAuth; MCP tools call plain read* helpers server-side after OAuth verification.

## Authentication architecture
- `src/integrations/supabase/client.ts` and `client.server.ts` are intentional stubs (the app pages use no sign-in). The only real Supabase clients are `src/lib/mcp/auth-client.ts` (browser, OAuth consent/login) and `src/lib/supabase-admin.server.ts` (dynamic-import server admin client for the allow-list check) — do not swap the stubs back app-wide.
- MCP tools are OAuth-protected via `auth.oauth.issuer` in `src/lib/mcp/index.ts`; consent lives at `src/routes/[.]lovable.oauth.consent.tsx` and sign-in at `src/routes/login.tsx` (signup restricted to the `allowed_emails` table).
