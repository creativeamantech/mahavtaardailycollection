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
    <main className="relative flex min-h-[100svh] items-center justify-center overflow-hidden bg-[#f7f6f1] px-4 py-8 text-[#25251f] sm:px-6">
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-[#f5c542]/25 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 -left-24 size-80 rounded-full bg-[#e9dfc7]/55 blur-3xl" />

      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-[#e8e2d4] bg-white shadow-[0_28px_90px_rgba(38,35,25,0.12)] md:min-h-[590px] md:grid-cols-[1.02fr_0.98fr]">
        <section className="relative flex min-h-56 flex-col justify-between overflow-hidden bg-[#f4c542] p-7 sm:p-10 md:min-h-full">
          <div aria-hidden="true" className="absolute -bottom-24 -right-16 size-72 rounded-full border-[36px] border-white/15" />
          <div className="relative">
            <div className="grid size-14 place-items-center rounded-2xl bg-[#29271f] text-2xl font-black text-[#f7ca4c] shadow-lg">M</div>
            <p className="mt-8 text-[11px] font-extrabold uppercase tracking-[0.24em] text-[#5c4712]">Mahavtaar Enterprises</p>
            <h1 className="mt-3 max-w-sm text-4xl font-black leading-[1.05] tracking-tight text-[#282419] sm:text-5xl">Daily<br className="hidden sm:block" /> Collection</h1>
            <p className="mt-4 max-w-sm text-sm leading-6 text-[#55451e] sm:text-base">A clear, reliable workspace for your team's daily collection operations.</p>
          </div>
          <div className="relative mt-8 hidden max-w-sm rounded-2xl border border-black/10 bg-white/35 p-4 md:block">
            <p className="text-sm font-bold text-[#3c3218]">One workspace. Clear daily progress.</p>
            <p className="mt-1 text-xs leading-5 text-[#65552e]">Use your registered executive PIN to securely access the collection desk.</p>
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-9 sm:px-10 sm:py-12">
          <form onSubmit={submit} className="w-full max-w-sm space-y-6">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#a47a12]">Welcome back</p>
              <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-[#25251f] sm:text-3xl">Sign in to continue</h2>
              <p className="mt-2 text-sm leading-6 text-[#77766f]">Choose your name and enter your secure PIN.</p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-bold text-[#38372f]">Executive Name</Label>
              <Select value={executiveName} onValueChange={setExecutiveName} disabled={busy}>
                <SelectTrigger className="h-12 rounded-xl border-[#e5e0d4] bg-[#fcfbf8] px-4 text-base shadow-none focus:ring-2 focus:ring-[#e8b82e]/40">
                  <SelectValue placeholder="Select executive" />
                </SelectTrigger>
                <SelectContent>
                  {EXECUTIVE_NAMES.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="login-pin" className="text-sm font-bold text-[#38372f]">PIN</Label>
              <Input
                id="login-pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter your PIN"
                disabled={busy}
                className="h-12 rounded-xl border-[#e5e0d4] bg-[#fcfbf8] px-4 text-base tracking-[0.22em] shadow-none focus-visible:ring-2 focus-visible:ring-[#e8b82e]/40"
              />
            </div>

            <Button type="submit" className="h-12 w-full rounded-xl bg-[#29271f] text-base font-bold text-white shadow-md transition hover:bg-[#403b2c] focus-visible:ring-2 focus-visible:ring-[#e8b82e] focus-visible:ring-offset-2" disabled={!executiveName || !pin || busy}>
              {busy ? "Signing in..." : "Login"}
            </Button>
            <p className="text-center text-xs leading-5 text-[#929087]">Secure access for authorised team members</p>
          </form>
        </section>
      </div>
    </main>
  );
}
