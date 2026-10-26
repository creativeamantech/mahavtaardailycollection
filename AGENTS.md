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
- The Daily Collection UI is accessible without a general app login. Keep MCP OAuth authentication and the allow-listed account flow protected; do not remove or weaken them.
- App server functions retain input validation and server-side password checks for privileged Settings and portal actions. Headerless in-process calls from OAuth-verified MCP handlers are supported; never expose an internal MCP handler directly over HTTP.

## Authentication architecture
- `src/integrations/supabase/client.ts` and `client.server.ts` are intentional stubs.
- `src/lib/mcp/auth-client.ts` is reserved for MCP sign-in and OAuth consent routes, and `src/lib/supabase-admin.server.ts` is used only by the MCP authentication flow.
- MCP tools are OAuth-protected via `auth.oauth.issuer` in `src/lib/mcp/index.ts`; consent lives at `src/routes/[.]lovable.oauth.consent.tsx` and sign-in at `src/routes/login.tsx` (signup restricted to the `allowed_emails` table).
- Settings mutations and portal admin actions verify the shared password server-side against the SETTINGS_PASSWORD secret via src/lib/password-guard.server.ts; never put the password literal back in code.
