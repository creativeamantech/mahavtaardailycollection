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
  const [showPin, setShowPin] = useState(false);
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
    <main className="min-h-[100svh] bg-[#f4f3f6] px-0 py-0 text-[#211d2b] sm:grid sm:place-items-center sm:px-6 sm:py-8">
      <div className="mx-auto grid min-h-[100svh] w-full max-w-[1120px] overflow-hidden bg-white shadow-none sm:min-h-[690px] sm:grid-cols-[0.94fr_1.06fr] sm:rounded-[28px] sm:shadow-[0_28px_90px_rgba(31,24,48,0.12)]">
        <section className="relative hidden flex-col justify-between overflow-hidden bg-[#211b31] px-11 py-10 text-white sm:flex lg:px-14 lg:py-12">
          <div aria-hidden="true" className="pointer-events-none absolute -right-36 top-1/4 size-[440px] rounded-full border border-white/[0.07]" />
          <div aria-hidden="true" className="pointer-events-none absolute -right-20 top-[34%] size-[310px] rounded-full border border-white/[0.06]" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -left-28 size-[390px] rounded-full bg-[#6b4b9b]/20 blur-3xl" />

          <div className="relative z-10 flex items-center gap-3.5">
            <div className="grid size-[58px] shrink-0 place-items-center rounded-[17px] bg-white p-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
              <img src="/mahavtaar-logo.png" alt="Mahavtaar" className="size-full object-contain" />
            </div>
            <div className="leading-tight">
              <p className="text-[17px] font-extrabold tracking-[0.01em]">MAHAVTAAR</p>
              <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.19em] text-white/55">Daily Collection Portal</p>
            </div>
          </div>

          <div className="relative z-10 -mt-4 max-w-[440px]">
            <div className="mb-5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#d5bd82]">
              <span className="h-px w-7 bg-[#d5bd82]" />
              Focus on what matters
            </div>
            <h1 className="text-[clamp(2.8rem,4.5vw,4.15rem)] font-semibold leading-[1.04] tracking-[-0.06em]">
              Your workday.
              <br />
              <span className="text-[#d8c9f0]">In good order.</span>
            </h1>
            <p className="mt-6 max-w-[350px] text-[13px] leading-7 text-white/60">
              One secure workspace for your team’s daily collection operations, progress and accountability.
            </p>
            <div className="mt-9 flex items-center gap-3">
              <span className="h-1 w-10 rounded-full bg-[#d5bd82]" />
              <span className="h-1 w-5 rounded-full bg-white/25" />
              <span className="h-1 w-5 rounded-full bg-white/25" />
            </div>
          </div>

          <div className="relative z-10 flex items-center justify-between border-t border-white/10 pt-5 text-[9px] font-medium uppercase tracking-[0.15em] text-white/40">
            <span>Mahavtaar Enterprises</span>
            <span className="flex items-center gap-2 normal-case tracking-normal">
              <span className="size-1.5 rounded-full bg-[#86bb91]" />
              Authorised access
            </span>
          </div>
        </section>

        <section className="flex min-h-[100svh] items-center justify-center px-6 py-9 sm:min-h-0 sm:px-10 lg:px-16">
          <div className="w-full max-w-[390px]">
            <div className="mb-12 flex items-center gap-3 sm:hidden">
              <div className="grid size-[48px] place-items-center rounded-[14px] border border-[#ece9f0] bg-white p-2">
                <img src="/mahavtaar-logo.png" alt="Mahavtaar" className="size-full object-contain" />
              </div>
              <div className="leading-tight">
                <p className="text-[15px] font-extrabold tracking-[0.01em] text-[#211b31]">MAHAVTAAR</p>
                <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#96919f]">Daily Collection Portal</p>
              </div>
            </div>

            <div className="mb-8">
              <p className="mb-3 text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#7655a4]">Executive sign in</p>
              <h2 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.055em] text-[#211d2b] sm:text-[38px]">Welcome back.</h2>
              <p className="mt-3 max-w-[330px] text-[13px] leading-6 text-[#827d8b]">
                Sign in with your executive profile to continue to your workspace.
              </p>
            </div>

            <form onSubmit={submit} className="space-y-5">
              <div className="space-y-2.5">
                <Label htmlFor="executive-name" className="text-[11px] font-bold text-[#393443]">Executive name</Label>
                <Select value={executiveName} onValueChange={setExecutiveName} disabled={busy}>
                  <SelectTrigger
                    id="executive-name"
                    className="h-[54px] rounded-[11px] border-[#e4e1e9] bg-white px-4 text-[13px] shadow-none transition hover:border-[#c9bfd7] focus:ring-4 focus:ring-[#7655a4]/10 focus:ring-offset-0"
                  >
                    <SelectValue placeholder="Choose your profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXECUTIVE_NAMES.map((name) => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2.5">
                <Label htmlFor="login-pin" className="text-[11px] font-bold text-[#393443]">Security PIN</Label>
                <div className="relative">
                  <Input
                    id="login-pin"
                    type={showPin ? "text" : "password"}
                    inputMode="numeric"
                    autoComplete="current-password"
                    value={pin}
                    onChange={(event) => setPin(event.target.value)}
                    placeholder="Enter your PIN"
                    disabled={busy}
                    className="h-[54px] rounded-[11px] border-[#e4e1e9] bg-white px-4 pr-16 text-[14px] tracking-[0.18em] shadow-none transition placeholder:tracking-normal hover:border-[#c9bfd7] focus-visible:ring-4 focus-visible:ring-[#7655a4]/10 focus-visible:ring-offset-0"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin((value) => !value)}
                    aria-label={showPin ? "Hide PIN" : "Show PIN"}
                    aria-pressed={showPin}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-3 py-2 text-[9px] font-extrabold tracking-[0.12em] text-[#817b8b] transition hover:bg-[#f5f2f8] hover:text-[#684694] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7655a4]"
                  >
                    {showPin ? "HIDE" : "SHOW"}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-0.5 text-[10px] text-[#96919f]">
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-3.5 text-[#7b9b82]">
                  <rect x="3.5" y="8.5" width="13" height="9" rx="2" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M6.5 8.5V6a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                Your session is protected
              </div>

              <Button
                type="submit"
                disabled={!executiveName || !pin || busy}
                className="group mt-1 h-[54px] w-full rounded-[11px] bg-[#5d4389] text-[12px] font-bold tracking-[0.02em] text-white shadow-[0_8px_18px_rgba(93,67,137,0.17)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#4e3677] hover:shadow-[0_12px_22px_rgba(93,67,137,0.22)] focus-visible:ring-2 focus-visible:ring-[#7655a4] focus-visible:ring-offset-2 disabled:translate-y-0 disabled:bg-[#aaa2b7] disabled:opacity-60"
              >
                {busy ? "Signing in…" : "Sign in"}
                {!busy && <span aria-hidden="true" className="ml-2 text-base transition-transform group-hover:translate-x-1">→</span>}
              </Button>
            </form>

            <div className="mt-9 border-t border-[#efedf2] pt-5 text-center text-[9px] leading-5 text-[#a09ba8]">
              <p>Mahavtaar Enterprises · Daily Collection</p>
              <p>For authorised team members only</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
