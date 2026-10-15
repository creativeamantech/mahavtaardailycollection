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
