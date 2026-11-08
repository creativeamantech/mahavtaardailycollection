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
    <main className="relative flex min-h-[100svh] items-center justify-center bg-[#f4f5f7] px-4 py-6 text-[#20242b] sm:px-6 sm:py-10">
      <div aria-hidden="true" className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-[#f4c542]/15 blur-3xl" />
      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-[#e4e7ec] bg-white shadow-[0_24px_70px_rgba(24,32,45,0.10)] md:min-h-[600px] md:grid-cols-[1fr_0.92fr]">
        <section className="flex flex-col justify-between bg-[#29271f] px-6 py-7 text-white sm:px-9 sm:py-9 md:px-12 md:py-12">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#f4c542] text-xl font-black text-[#29271f] shadow-sm">M</div>
              <div className="min-w-0">
                <p className="text-sm font-extrabold tracking-wide text-white">Mahavtaar Enterprises</p>
                <p className="mt-0.5 text-xs text-[#d4d0c5]">Operations workspace</p>
              </div>
            </div>

            <p className="mt-8 text-[11px] font-bold uppercase tracking-[0.2em] text-[#f4c542]">Daily operations</p>
            <h1 className="mt-3 max-w-md text-3xl font-black leading-tight tracking-tight sm:text-4xl md:text-5xl">
              Daily Collection
            </h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-[#dedbd3] sm:text-base">
              A clear and reliable workspace for recording and tracking your team's daily collections.
            </p>
          </div>

          <div className="mt-8 rounded-2xl border border-white/15 bg-white/[0.06] p-4 sm:p-5">
            <p className="text-sm font-bold text-white">Your collection desk, in one place.</p>
            <p className="mt-1 text-sm leading-6 text-[#d4d0c5]">
              Sign in with your registered executive name and PIN to continue.
            </p>
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-8 sm:px-9 sm:py-10 md:px-12">
          <form onSubmit={submit} className="w-full max-w-sm space-y-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#9a7410]">Secure sign in</p>
              <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-[#20242b] sm:text-3xl">Welcome back</h2>
              <p className="mt-2 text-sm leading-6 text-[#69717d]">
                Select your executive profile and enter your PIN.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold text-[#343a43]">Executive Name</Label>
              <Select value={executiveName} onValueChange={setExecutiveName} disabled={busy}>
                <SelectTrigger className="h-12 w-full rounded-xl border-[#d9dee6] bg-white px-4 text-base shadow-none focus:ring-2 focus:ring-[#e8b82e]/40">
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
              <Label htmlFor="login-pin" className="text-sm font-semibold text-[#343a43]">PIN</Label>
              <Input
                id="login-pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter your PIN"
                disabled={busy}
                className="h-12 rounded-xl border-[#d9dee6] bg-white px-4 text-base tracking-[0.2em] shadow-none focus-visible:ring-2 focus-visible:ring-[#e8b82e]/40"
              />
            </div>

            <Button
              type="submit"
              className="h-12 w-full rounded-xl bg-[#29271f] text-base font-bold text-white shadow-sm transition hover:bg-[#403b2c] focus-visible:ring-2 focus-visible:ring-[#e8b82e] focus-visible:ring-offset-2"
              disabled={!executiveName || !pin || busy}
            >
              {busy ? "Signing in..." : "Login"}
            </Button>

            <p className="text-center text-xs leading-5 text-[#747b85]">
              Secure access for authorised team members
            </p>
          </form>
        </section>
      </div>
    </main>
  );
}
