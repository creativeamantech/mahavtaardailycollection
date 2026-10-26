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

- MCP server lives in src/lib/mcp/ (one tool per file, protected by sign-in OAuth; only allow-listed emails can create accounts); tools reuse the existing server functions/helpers so report rules (Already Paid exclusion) stay identical.
- All app pages live under src/routes/_authenticated and REQUIRE sign-in (user decision 2026-10-26): the `_authenticated` route gate redirects signed-out visitors to `/login`, and every app server function carries `.middleware([requireAppAuth])` (src/lib/app-auth.server.ts) which verifies the Supabase bearer server-side. The bearer is attached by the client function middleware in src/start.ts; `captureAuthHeader` (src/lib/app-auth-request.server.ts) records the Authorization header into request context. Headerless in-process calls (MCP tool handlers) are exempt — never expose one directly over HTTP.

## Authentication architecture
- `src/integrations/supabase/client.ts` and `client.server.ts` are intentional stubs; the real browser client is `src/lib/mcp/auth-client.ts` (sign-in, OAuth consent, app session, sign-out) and the server admin client is `src/lib/supabase-admin.server.ts` (dynamic-import only) — do not swap the stubs back app-wide.
- MCP tools are OAuth-protected via `auth.oauth.issuer` in `src/lib/mcp/index.ts`; consent lives at `src/routes/[.]lovable.oauth.consent.tsx` and sign-in at `src/routes/login.tsx` (signup restricted to the `allowed_emails` table).
- Settings mutations and portal admin actions verify the shared password server-side against the SETTINGS_PASSWORD secret via src/lib/password-guard.server.ts; never put the password literal back in code.
