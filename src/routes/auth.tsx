import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { oauthReturnPath } from "@/lib/oauth-return-path";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/auth")({
  validateSearch: z.object({ next: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Sign in — Mahavtaar Daily Collection" },
      { name: "description", content: "Sign in to Mahavtaar Daily Collection." },
      { property: "og:title", content: "Sign in — Mahavtaar Daily Collection" },
      { property: "og:description", content: "Sign in to Mahavtaar Daily Collection." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { next: rawNext } = Route.useSearch();
  const next = oauthReturnPath(rawNext);
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const go = () => {
    window.location.href = new URL(next, window.location.origin).href;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (error) return setMsg(error.message);
      go();
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: new URL(next, window.location.origin).href },
      });
      setBusy(false);
      if (error)
        return setMsg(
          /allowed|database error/i.test(error.message)
            ? "This email is not allowed to sign in."
            : error.message,
        );
      setMsg("Check your email to confirm your account, then sign in.");
    }
  };

  const google = async () => {
    sessionStorage.setItem("auth-next", next);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/auth?next=" + encodeURIComponent(next),
    });
    if (result.error) return setMsg("Google sign-in failed or this email is not allowed.");
    if (result.redirected) return;
    go();
  };

  void navigate;
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-bold">Mahavtaar Daily Collection</h1>
      <p className="mt-1 text-muted-foreground">
        {mode === "in" ? "Sign in to continue." : "Create your account."}
      </p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <Input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 text-base" />
        <Input type="password" required minLength={6} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 text-base" />
        <Button type="submit" disabled={busy} className="h-12 w-full text-base">
          {mode === "in" ? "Sign in" : "Create account"}
        </Button>
      </form>
      <Button variant="outline" onClick={google} className="mt-3 h-12 w-full text-base">
        Continue with Google
      </Button>
      {msg && <p className="mt-4 text-sm">{msg}</p>}
      <button
        type="button"
        onClick={() => setMode(mode === "in" ? "up" : "in")}
        className="mt-6 text-sm underline"
      >
        {mode === "in" ? "First time? Create an account" : "Already have an account? Sign in"}
      </button>
    </main>
  );
}
