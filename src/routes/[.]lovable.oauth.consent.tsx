import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { authSupabase } from "@/lib/mcp/auth-client";
import { oauthReturnPath } from "@/lib/oauth-return-path";

export const Route = createFileRoute("/.lovable/oauth/consent")({
  // SSR has no localStorage session and would redirect signed-in users.
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await authSupabase.auth.getSession();
    const next = location.pathname + location.searchStr;
    if (!data.session) throw redirect({ to: "/login", search: { next } });
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await authSupabase.auth.oauth.getAuthorizationDetails(authorizationId);
    if (error) throw error;
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: oauthReturnPath(immediate) });
    return data;
  },
  head: () => ({
    meta: [
      { title: "Approve connection — Mahavtaar Daily Collection" },
      { name: "description", content: "Approve or deny an assistant connection." },
    ],
  }),
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-3 px-5">
      <h1 className="text-xl font-semibold">Could not load this connection request</h1>
      <p className="text-sm text-muted-foreground">
        {error instanceof Error ? error.message : String(error)}
      </p>
    </main>
  ),
});

type ConsentDetails = {
  client?: { name?: string } | null;
} & Record<string, unknown>;

function Consent() {
  const details = Route.useLoaderData() as ConsentDetails | null;
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientName = details?.client?.name ?? "an assistant";

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error: err } = approve
      ? await authSupabase.auth.oauth.approveAuthorization(authorization_id)
      : await authSupabase.auth.oauth.denyAuthorization(authorization_id);
    if (err) {
      setBusy(false);
      setError(err.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect was returned for this request. Close this page and reconnect.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5">
      <div>
        <h1 className="text-2xl font-semibold">Connect {clientName}?</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This lets {clientName} read your collection data as you, using the agent tools. It can
          only read — it cannot change any records.
        </p>
      </div>
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      <div className="flex flex-col gap-3">
        <button
          disabled={busy}
          onClick={() => decide(true)}
          className="h-11 rounded-md bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Please wait…" : "Approve"}
        </button>
        <button
          disabled={busy}
          onClick={() => decide(false)}
          className="h-11 rounded-md border px-4 text-base font-semibold disabled:opacity-60"
        >
          Deny
        </button>
      </div>
    </main>
  );
}
