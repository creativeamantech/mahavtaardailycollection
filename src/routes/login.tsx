import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { authSupabase } from "@/lib/mcp/auth-client";
import { oauthReturnPath } from "@/lib/oauth-return-path";
import { checkEmailAllowed } from "@/lib/auth-allowlist.functions";

export const Route = createFileRoute("/login")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s["next"] === "string" ? s["next"] : "",
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Mahavtaar Daily Collection" },
      { name: "description", content: "Sign in to approve agent connections." },
    ],
  }),
  // Already signed in with a return path: continue the flow immediately.
  beforeLoad: async ({ search }) => {
    if (!search.next) return;
    const { data } = await authSupabase.auth.getSession();
    if (data.session) throw redirect({ href: oauthReturnPath(search.next) });
  },
  component: Login,
});

function Login() {
  const { next } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function returnTarget(): string {
    const path = oauthReturnPath(next);
    return path === "/" ? window.location.origin : new URL(path, window.location.origin).href;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const mail = email.trim().toLowerCase();
    const pass = password;
    if (!mail || pass.length < 6) {
      setError("Enter your email and a password of at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error: err } = await authSupabase.auth.signInWithPassword({
          email: mail,
          password: pass,
        });
        if (err) {
          setError(
            err.message === "Invalid login credentials"
              ? "Incorrect email or password."
              : err.message,
          );
          setBusy(false);
          return;
        }
        window.location.href = returnTarget();
      } else {
        const check = await checkEmailAllowed({ data: { email: mail } });
        if (!check.allowed) {
          setError("This email is not on the approved list. Ask the owner to approve it first.");
          setBusy(false);
          return;
        }
        const { data, error: err } = await authSupabase.auth.signUp({
          email: mail,
          password: pass,
          options: { emailRedirectTo: returnTarget() },
        });
        if (err) {
          setError(err.message);
          setBusy(false);
          return;
        }
        if (data.session) {
          window.location.href = returnTarget();
          return;
        }
        setInfo("Account created. Please confirm it via the email link, then sign in.");
        setMode("signin");
        setBusy(false);
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5">
      <div>
        <h1 className="text-2xl font-semibold">
          {mode === "signin" ? "Sign in" : "Create account"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Only needed to connect an assistant to your collection data. Accounts are limited to
          approved emails.
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 rounded-md border bg-background px-3 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Password
          <input
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 rounded-md border bg-background px-3 text-base"
          />
        </label>
        {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        {info && <p className="text-sm font-medium text-primary">{info}</p>}
        <button
          type="submit"
          disabled={busy}
          className="h-11 rounded-md bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
      <button
        type="button"
        className="text-sm font-medium text-primary underline"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
          setInfo(null);
        }}
      >
        {mode === "signin" ? "Need an account? Create one" : "Already have an account? Sign in"}
      </button>
    </main>
  );
}
