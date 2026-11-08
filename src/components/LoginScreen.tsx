import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { loginWithPin } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

// Keep the login dropdown independent of Google Sheets API reads.
const EXECUTIVE_NAMES = [
  "Aarti",
  "Admin",
  "Ankita",
  "Bharti",
  "Julee",
  "Pooja",
  "Shikha",
  "Sona",
  "Sunanda",
  "Vinita",
] as const;

export function LoginScreen() {
  const [executiveName, setExecutiveName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const login = useServerFn(loginWithPin);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!executiveName || !pin || busy) return;
    setBusy(true);
    try {
      await login({ data: { executiveName, pin } });
      setPin("");
      await qc.invalidateQueries();
      toast.success("Login successful");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#fffdf7] px-4 py-10 text-[#28251d]">
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#ffdf75]/45 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 -left-24 h-72 w-72 rounded-full bg-[#ffe9ad]/55 blur-3xl" />
      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-[#f1e4bd] bg-white shadow-[0_24px_80px_rgba(90,67,15,0.12)] md:grid-cols-[1.05fr_0.95fr]">
        <section className="flex min-h-52 flex-col justify-between bg-[#f6c944] p-7 sm:p-10 md:min-h-[540px]">
          <div>
            <div className="grid size-14 place-items-center rounded-2xl border border-black/10 bg-white/75 text-xl font-black text-[#33270b]">M</div>
            <p className="mt-7 text-xs font-bold uppercase tracking-[0.22em] text-[#60480d]">Mahavtaar Enterprises</p>
            <h1 className="mt-3 max-w-sm text-3xl font-black leading-tight tracking-tight text-[#28210f] sm:text-4xl">Daily Collection</h1>
            <p className="mt-3 max-w-sm text-sm leading-6 text-[#5d4b22]">A simple, secure workspace for your team's daily collection operations.</p>
          </div>
          <div className="mt-8 hidden rounded-2xl border border-black/10 bg-white/35 p-4 text-sm text-[#554318] md:block">
            <p className="font-bold">One workspace. Clear daily progress.</p>
            <p className="mt-1 text-xs">Sign in with your registered executive PIN to continue.</p>
          </div>
        </section>
        <section className="flex items-center justify-center p-6 sm:p-10">
          <form onSubmit={submit} className="w-full max-w-sm space-y-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#a5790c]">Welcome back</p>
              <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-[#28251d]">Sign in to continue</h2>
              <p className="mt-2 text-sm text-[#777267]">Select your name and enter your PIN.</p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-[#39352c]">Executive Name</Label>
              <Select value={executiveName} onValueChange={setExecutiveName} disabled={busy}>
                <SelectTrigger className="h-12 rounded-xl border-[#e9dfc8] bg-white text-base focus:ring-[#e8b82e]">
                  <SelectValue placeholder="Select executive" />
                </SelectTrigger>
                <SelectContent>
                  {EXECUTIVE_NAMES.map((name) => (
                    <SelectItem key={name} value={name}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-pin" className="text-sm font-semibold text-[#39352c]">PIN</Label>
              <Input
                id="login-pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter your PIN"
                className="h-12 rounded-xl border-[#e9dfc8] bg-white text-base tracking-[0.2em] focus-visible:ring-[#e8b82e]"
              />
            </div>
            <Button type="submit" className="h-12 w-full rounded-xl bg-[#f2bd2e] text-base font-bold text-[#2c230d] shadow-sm hover:bg-[#e6ad17] focus-visible:ring-[#d79e0b]" disabled={!executiveName || !pin || busy}>
              {busy ? "Signing in..." : "Login"}
            </Button>
            <p className="text-center text-xs text-[#918b7d]">Secure access for authorized team members</p>
          </form>
        </section>
      </div>
    </main>
  );
}
