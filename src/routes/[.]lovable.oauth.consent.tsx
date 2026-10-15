import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type Details = {
  client?: { name?: string; client_name?: string; redirect_uri?: string } | null;
  redirect_uri?: string;
  scope?: string;
  redirect_url?: string;
  redirect_to?: string;
};
type Res = { data: Details | null; error: { message: string } | null };
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<Res>;
  approveAuthorization: (id: string) => Promise<Res>;
  denyAuthorization: (id: string) => Promise<Res>;
};
const oauth = () => (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: z.object({ authorization_id: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Connect assistant — Mahavtaar Daily Collection" },
      { name: "description", content: "Approve an AI assistant connection." },
      { property: "og:title", content: "Connect assistant — Mahavtaar Daily Collection" },
      { property: "og:description", content: "Approve an AI assistant connection." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <p className="font-semibold">Could not load this connection request.</p>
      <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
    </main>
  ),
  component: Consent,
});

function Consent() {
  const { authorization_id: id } = Route.useSearch();
  const [details, setDetails] = useState<Details | null>(null);
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!id) return setErr("This connection request is missing or invalid.");
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        const here = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(here);
        return;
      }
      setEmail(u.user.email ?? "");
      const { data, error } = await oauth().getAuthorizationDetails(id);
      if (error) return setErr(error.message || "This request has expired.");
      const r = data?.redirect_url ?? data?.redirect_to;
      if (r && !data?.client) return void (window.location.href = r);
      setDetails(data);
    })();
  }, [id]);

  const act = async (approve: boolean) => {
    if (!id) return;
    setBusy(true);
    const { data, error } = approve
      ? await oauth().approveAuthorization(id)
      : await oauth().denyAuthorization(id);
    setBusy(false);
    if (error) return setErr(error.message || "Something went wrong. Please try again.");
    const r = data?.redirect_url ?? data?.redirect_to;
    if (r) window.location.href = r;
  };

  if (err)
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="font-semibold">{err}</p>
      </main>
    );
  if (!details) return <main className="px-4 py-16 text-center">Loading…</main>;
  const name = details.client?.client_name ?? details.client?.name ?? "An assistant";
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-xl font-bold">Connect {name} to Mahavtaar Daily Collection</h1>
      <p className="mt-3 text-sm">Signed in as {email}.</p>
      <p className="mt-3 text-sm">
        {name} will be able to read collection totals, loan payments and pending receipts as you.
      </p>
      {(details.client?.redirect_uri ?? details.redirect_uri) && (
        <p className="mt-2 break-all text-xs text-muted-foreground">
          Returns to: {details.client?.redirect_uri ?? details.redirect_uri}
        </p>
      )}
      <div className="mt-6 flex gap-2">
        <Button disabled={busy} onClick={() => act(true)} className="h-11 flex-1">
          Approve
        </Button>
        <Button disabled={busy} variant="outline" onClick={() => act(false)} className="h-11 flex-1">
          Cancel connection
        </Button>
      </div>
    </main>
  );
}
