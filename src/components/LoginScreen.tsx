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
  "Aarti", "Admin", "Ankita", "Bharti", "Julee",
  "Pooja", "Shikha", "Sona", "Sunanda", "Vinita",
] as const;

const brandSpectrum =
  "linear-gradient(100deg, #8126a4 0%, #c42c91 23%, #159bd0 48%, #59b64b 68%, #f3c52e 82%, #ef572f 100%)";

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
    <main className="relative isolate min-h-[100svh] overflow-hidden bg-[#fbfaf8] px-4 py-5 text-[#292536] sm:px-7 sm:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute -left-40 -top-48 -z-10 size-[560px] rounded-full bg-[#e9dcf2]/55 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-64 -right-44 -z-10 size-[620px] rounded-full bg-[#d9edf1]/65 blur-3xl" />

      <div className="mx-auto grid min-h-[calc(100svh-2.5rem)] w-full max-w-[1260px] grid-cols-1 items-center gap-8 md:min-h-[calc(100svh-4rem)] md:grid-cols-[1.05fr_0.95fr] md:gap-12 lg:gap-20">
        <section className="relative flex flex-col justify-between overflow-hidden rounded-[28px] border border-white/70 bg-white/55 px-6 py-7 shadow-[0_18px_65px_rgba(53,38,72,0.055)] backdrop-blur-sm sm:px-10 sm:py-9 md:min-h-[650px] md:px-12 md:py-11">
          <div aria-hidden="true" className="pointer-events-none absolute -right-24 top-16 size-[360px] rounded-full border border-[#bfa5d5]/20" />
          <div aria-hidden="true" className="pointer-events-none absolute -right-12 top-28 size-[265px] rounded-full border border-[#80c5d5]/20" />
          <div className="relative z-10 flex items-center gap-3">
            <div className="grid size-[54px] shrink-0 place-items-center rounded-2xl bg-white p-1.5 shadow-[0_5px_20px_rgba(44,32,60,0.08)] ring-1 ring-black/[0.035]">
              <img src="/mahavtaar-logo.png" alt="Mahavtaar logo" className="size-full object-contain" />
            </div>
            <div className="leading-tight">
              <p className="text-[18px] font-black tracking-[-0.045em] text-[#30263c]">Mahavtaar</p>
              <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.19em] text-[#8c8297]">Daily Collection Workspace</p>
            </div>
          </div>

          <div className="relative z-10 flex flex-col items-start py-7 md:py-0">
            <div className="relative mb-7 grid size-[clamp(170px,21vw,258px)] place-items-center">
              <div aria-hidden="true" className="absolute inset-0 rounded-full bg-[conic-gradient(from_210deg,rgba(129,38,164,.12),rgba(196,44,145,.12),rgba(21,155,208,.12),rgba(89,182,75,.12),rgba(243,197,46,.12),rgba(239,87,47,.12),rgba(129,38,164,.12))] blur-2xl" />
              <div className="relative grid size-[88%] place-items-center rounded-full border border-white/90 bg-white/75 shadow-[0_15px_55px_rgba(60,42,80,0.07)]">
                <img src="/mahavtaar-logo.png" alt="" aria-hidden="true" className="size-[82%] object-contain drop-shadow-[0_7px_12px_rgba(48,38,60,0.08)]" />
              </div>
            </div>
            <p className="mb-3 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#81509a]">
              <span className="h-[2px] w-7 rounded-full" style={{ background: brandSpectrum }} />
              One team. One workspace.
            </p>
            <h1 className="max-w-[560px] text-[clamp(2.35rem,4.4vw,4.1rem)] font-black leading-[1.02] tracking-[-0.065em] text-[#30263c]">
              Bring every
              <br />
              collection <span className="bg-clip-text text-transparent" style={{ backgroundImage: brandSpectrum }}>into focus.</span>
            </h1>
            <p className="mt-5 max-w-[420px] text-[13px] leading-7 text-[#7f7788] sm:text-[14px]">
              A clear, connected space for daily collection work, team progress and accountability.
            </p>
          </div>

          <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-t border-[#e9e3ed] pt-5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#92899a]">
            <span>Mahavtaar Enterprises</span>
            <span className="flex items-center gap-2 normal-case tracking-normal text-[#817b89]">
              <span className="size-1.5 rounded-full bg-[#62ad61]" />
              Authorised team access
            </span>
          </div>
        </section>

        <section className="flex w-full items-center justify-center py-3 sm:py-8 md:py-0">
          <div className="w-full max-w-[420px]">
            <div className="mb-8 flex items-center gap-3 md:hidden">
              <div className="grid size-[50px] place-items-center rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-[#e9e3ed]">
                <img src="/mahavtaar-logo.png" alt="Mahavtaar logo" className="size-full object-contain" />
              </div>
              <div className="leading-tight">
                <p className="text-[17px] font-black tracking-[-0.04em] text-[#30263c]">Mahavtaar</p>
                <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.16em] text-[#8c8297]">Daily Collection Workspace</p>
              </div>
            </div>

            <div className="overflow-hidden rounded-[25px] border border-[#ebe6ee] bg-white shadow-[0_22px_75px_rgba(49,36,63,0.09)]">
              <div className="h-[5px] w-full" style={{ background: brandSpectrum }} />
              <div className="px-6 pb-7 pt-8 sm:px-9 sm:pb-9 sm:pt-10">
                <div className="mb-7">
                  <p className="mb-3 text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#99518f]">Executive access</p>
                  <h2 className="text-[31px] font-black leading-tight tracking-[-0.055em] text-[#30263c] sm:text-[35px]">Welcome back.</h2>
                  <p className="mt-3 max-w-[330px] text-[13px] leading-6 text-[#898291]">
                    Sign in to continue to your Mahavtaar collection workspace.
                  </p>
                </div>

                <form onSubmit={submit} className="space-y-5">
                  <div className="space-y-2.5">
                    <Label htmlFor="executive-name" className="text-[11px] font-bold text-[#393443]">Executive name</Label>
                    <Select value={executiveName} onValueChange={setExecutiveName} disabled={busy}>
                      <SelectTrigger id="executive-name" className="h-[54px] rounded-[12px] border-[#e5e0e9] bg-[#fff] px-4 text-[13px] shadow-none transition hover:border-[#bda7cb] focus:ring-4 focus:ring-[#9a5ba8]/10 focus:ring-offset-0">
                        <SelectValue placeholder="Select your profile" />
                      </SelectTrigger>
                      <SelectContent>
                        {EXECUTIVE_NAMES.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
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
                        className="h-[54px] rounded-[12px] border-[#e5e0e9] bg-white px-4 pr-16 text-[14px] tracking-[0.2em] shadow-none transition placeholder:tracking-normal hover:border-[#bda7cb] focus-visible:ring-4 focus-visible:ring-[#9a5ba8]/10 focus-visible:ring-offset-0"
                      />
                      <button type="button" onClick={() => setShowPin((value) => !value)} aria-label={showPin ? "Hide PIN" : "Show PIN"} aria-pressed={showPin} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-2 text-[9px] font-extrabold tracking-[0.12em] text-[#82798c] transition hover:bg-[#f7f1f8] hover:text-[#8c3e91] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#99518f]">
                        {showPin ? "HIDE" : "SHOW"}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-0.5 text-[10px] text-[#958d9b]">
                    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-3.5 text-[#63a46a]">
                      <rect x="3.5" y="8.5" width="13" height="9" rx="2" stroke="currentColor" strokeWidth="1.4" />
                      <path d="M6.5 8.5V6a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                    Protected sign-in for authorised users
                  </div>

                  <Button type="submit" disabled={!executiveName || !pin || busy} className="group mt-1 h-[55px] w-full rounded-[12px] border-0 text-[12px] font-extrabold tracking-[0.02em] text-white shadow-[0_9px_22px_rgba(137,65,147,0.2)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_13px_26px_rgba(137,65,147,0.24)] focus-visible:ring-2 focus-visible:ring-[#99518f] focus-visible:ring-offset-2 disabled:translate-y-0 disabled:opacity-50" style={{ background: "linear-gradient(100deg, #8126a4 0%, #a832a0 42%, #258db9 100%)" }}>
                    {busy ? "Signing in…" : "Sign in to workspace"}
                    {!busy && <span aria-hidden="true" className="ml-2 text-base transition-transform group-hover:translate-x-1">→</span>}
                  </Button>
                </form>
                <div className="mt-7 border-t border-[#f0ecf1] pt-5 text-center text-[9px] leading-5 text-[#a29aa6]">
                  <p>© Mahavtaar Enterprises · Daily Collection</p>
                  <p>Secure workspace for authorised team members</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
