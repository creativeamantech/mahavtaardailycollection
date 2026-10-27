import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { sheetLoginAction, sheetGetLoginOptions } from "@/lib/sheet-auth.functions";
import { useSheetAuth, saveSheetSession, getStoredSheetToken } from "@/hooks/useSheetAuth";
import { oauthReturnPath } from "@/lib/oauth-return-path";
import { Eye, EyeOff, KeyRound, Lock, ShieldCheck, UserCheck, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/login")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s["next"] === "string" ? s["next"] : "",
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Mahavtaar Daily Collection" },
      {
        name: "description",
        content: "Secure Google Sheet authentication for Mahavtaar Daily Collection.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const { user, refreshUser } = useSheetAuth();

  const [identifier, setIdentifier] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const getLoginOptionsFn = useServerFn(sheetGetLoginOptions);
  const loginFn = useServerFn(sheetLoginAction);

  const { data: optionsData } = useQuery({
    queryKey: ["sheet-login-options"],
    queryFn: () => getLoginOptionsFn(),
    staleTime: 5 * 60 * 1000,
  });

  const executivesList = optionsData?.executives || [
    { executiveName: "Aman", role: "Admin", email: "aman@mahavtaar.in" },
    { executiveName: "Aarti", role: "Executive", email: "aarti@mahavtaar.in" },
    { executiveName: "Ankita", role: "Executive", email: "ankita@mahavtaar.in" },
    { executiveName: "Bharti", role: "Executive", email: "bharti@mahavtaar.in" },
    { executiveName: "Julee", role: "Executive", email: "julee@mahavtaar.in" },
    { executiveName: "Pooja", role: "Executive", email: "pooja@mahavtaar.in" },
    { executiveName: "Sunanda", role: "Executive", email: "sunanda@mahavtaar.in" },
    { executiveName: "Vinita", role: "Executive", email: "vinita@mahavtaar.in" },
  ];

  // If already logged in, redirect to destination
  useEffect(() => {
    const token = getStoredSheetToken();
    if (token && user) {
      const destination = next ? oauthReturnPath(next) : "/";
      navigate({ to: destination });
    }
  }, [user, next, navigate]);

  function handleSelectExecutive(name: string) {
    setIdentifier(name);
    setErrorMessage(null);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    const id = identifier.trim();
    const p = pin.trim();

    if (!id) {
      setErrorMessage("Please select or enter your Executive Name or Email.");
      return;
    }
    if (!p) {
      setErrorMessage("Please enter your PIN.");
      return;
    }

    setBusy(true);
    try {
      const res = await loginFn({ data: { identifier: id, pin: p } });
      if (!res.success || !res.token || !res.user) {
        setErrorMessage(res.error || "Authentication failed. Please check credentials.");
        setBusy(false);
        return;
      }

      saveSheetSession(res.token, res.user);
      await refreshUser();

      const destination = next ? oauthReturnPath(next) : "/";
      window.location.href = destination;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication error occurred.";
      setErrorMessage(msg);
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-card border rounded-2xl shadow-xl overflow-hidden">
        {/* Header Banner */}
        <div className="bg-primary px-6 py-8 text-primary-foreground text-center relative overflow-hidden">
          <div className="relative z-10 flex flex-col items-center">
            <div className="h-14 w-14 rounded-2xl bg-primary-foreground/15 flex items-center justify-center mb-3 shadow-inner">
              <ShieldCheck className="h-8 w-8 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Mahavtaar Daily Collection</h1>
            <p className="text-sm text-primary-foreground/80 mt-1">
              Google Sheet Secure Authentication
            </p>
          </div>
        </div>

        {/* Form Container */}
        <div className="p-6 sm:p-8 space-y-6">
          {/* Quick Select Executive Grid */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Select Your Name
              </span>
              <span className="text-xs text-muted-foreground">or type below</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {executivesList.map((exec) => {
                const isSelected = identifier.toLowerCase() === exec.executiveName.toLowerCase();
                const isAdmin = exec.role === "Admin";
                return (
                  <button
                    key={exec.executiveName}
                    type="button"
                    onClick={() => handleSelectExecutive(exec.executiveName)}
                    className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-sm font-medium transition-all ${
                      isSelected
                        ? "border-primary bg-primary/10 text-primary font-semibold ring-2 ring-primary/20"
                        : "border-border hover:border-primary/50 hover:bg-muted/50 text-foreground"
                    }`}
                  >
                    <span className="truncate w-full text-center">{exec.executiveName}</span>
                    {isAdmin && (
                      <span className="text-[10px] uppercase font-bold text-amber-600 dark:text-amber-400">
                        Admin
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Login Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier" className="text-sm font-medium">
                Executive Name or Email
              </Label>
              <div className="relative">
                <Input
                  id="identifier"
                  type="text"
                  placeholder="e.g. Aarti or aarti@mahavtaar.in"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="h-11 pl-10 pr-3 text-base"
                  required
                  autoComplete="username"
                />
                <UserCheck className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="pin" className="text-sm font-medium">
                  Security PIN
                </Label>
                <span className="text-xs text-muted-foreground">4–6 digits</span>
              </div>
              <div className="relative">
                <Input
                  id="pin"
                  type={showPin ? "text" : "password"}
                  placeholder="Enter your PIN"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  maxLength={10}
                  className="h-11 pl-10 pr-10 text-base tracking-widest font-mono"
                  required
                  autoComplete="current-password"
                />
                <KeyRound className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-3 top-3 text-muted-foreground hover:text-foreground p-0.5"
                  aria-label={showPin ? "Hide PIN" : "Show PIN"}
                >
                  {showPin ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {errorMessage && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg flex items-start gap-2">
                <Lock className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={busy}
              className="w-full h-11 text-base font-semibold transition-all mt-2"
            >
              {busy ? "Verifying with Google Sheet..." : "Sign In to Collection"}
            </Button>
          </form>

          {/* Security Notice */}
          <div className="pt-2 border-t text-center space-y-1">
            <p className="text-xs text-muted-foreground">
              Credentials and roles are securely verified against the <strong>Users</strong> tab in
              Google Sheet.
            </p>
            <p className="text-[11px] text-muted-foreground/80">
              Only active accounts with verified hashed PINs are granted access.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
