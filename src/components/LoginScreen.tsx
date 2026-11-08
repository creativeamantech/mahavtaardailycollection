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
    <main className="min-h-[100svh] bg-[#f6f7f3] px-4 py-6 text-[#20231f] sm:px-6 sm:py-10">
      <div className="mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-6xl flex-col justify-center gap-7 md:min-h-[calc(100svh-5rem)] md:grid md:grid-cols-[minmax(0,1fr)_minmax(390px,480px)] md:items-center md:gap-12 lg:gap-20">
        <section className="flex flex-col justify-between gap-8 md:min-h-[520px] md:py-5">
          <div className="flex items-center gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-[#f4c542] text-xl font-black text-[#29271f] shadow-sm">
              M
            </div>
            <div className="leading-tight">
              <p className="text-sm font-extrabold tracking-tight">Mahavtaar</p>
              <p className="mt-1 text-xs text-[#777d73]">Enterprises</p>
            </div>
          </div>

          <div className="max-w-xl">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.19em] text-[#98751b]">
              Daily Collection Workspace
            </p>
            <h1 className="mt-3 text-[clamp(2.2rem,5vw,4.35rem)] font-black leading-[1.04] tracking-[-0.055em] text-[#20231f]">
              Every collection.
              <br className="hidden md:block" /> In clear focus.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-[#72776e] sm:text-base sm:leading-7">
              A simple, secure workspace for your team’s daily collection operations.
            </p>
          </div>

          <div className="hidden items-center gap-2 text-xs font-medium text-[#687168] md:flex">
            <span className="size-2 rounded-full bg-[#39855f] ring-4 ring-[#39855f]/10" />
            Authorised team access
          </div>
        </section>

        <section className="w-full">
          <form
            onSubmit={submit}
            className="mx-auto w-full max-w-[480px] rounded-[24px] border border-[#e7e9e2] bg-white p-5 shadow-[0_18px_55px_rgba(32,35,31,0.08)] sm:p-8 lg:p-10"
          >
            <header className="mb-7">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#98751b]">
                Welcome back
              </p>
              <h2 className="mt-2 text-[26px] font-extrabold tracking-[-0.04em] text-[#20231f] sm:text-[30px]">
                Sign in
              </h2>
              <p className="mt-2 text-sm leading-6 text-[#72776e]">
                Select your executive profile and enter your PIN to continue.
              </p>
            </header>

            <div className="mb-5 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="executive-name" className="text-[13px] font-bold text-[#343a33]">
                  Executive name
                </Label>
                <span className="text-[11px] text-[#92978e]">Required</span>
              </div>
              <Select value={executiveName} onValueChange={setExecutiveName} disabled={busy}>
                <SelectTrigger
                  id="executive-name"
                  className="h-[54px] rounded-[13px] border-[#dfe2da] bg-white px-4 text-sm shadow-none focus:ring-2 focus:ring-[#f4c542]/40"
                >
                  <SelectValue placeholder="Select executive" />
                </SelectTrigger>
                <SelectContent>
                  {EXECUTIVE_NAMES.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="mb-6 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="login-pin" className="text-[13px] font-bold text-[#343a33]">
                  PIN
                </Label>
                <span className="text-[11px] text-[#92978e]">Required</span>
              </div>
              <div className="relative">
                <Input
                  id="login-pin"
                  type={showPin ? "text" : "password"}
                  inputMode="numeric"
                  autoComplete="current-password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Enter your PIN"
                  disabled={busy}
                  className="h-[54px] rounded-[13px] border-[#dfe2da] bg-white px-4 pr-16 text-base tracking-[0.2em] shadow-none focus-visible:ring-2 focus-visible:ring-[#f4c542]/40"
                />
                <button
                  type="button"
                  onClick={() => setShowPin((current) => !current)}
                  aria-label={showPin ? "Hide PIN" : "Show PIN"}
                  aria-pressed={showPin}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-2 text-xs font-bold text-[#646b61] hover:bg-[#f3f4ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d6a91f]"
                >
                  {showPin ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="h-[54px] w-full rounded-[13px] bg-[#f4c542] text-sm font-extrabold text-[#29271f] shadow-[0_7px_16px_rgba(244,197,66,0.22)] transition hover:bg-[#edbd35] focus-visible:ring-2 focus-visible:ring-[#d6a91f] focus-visible:ring-offset-2"
              disabled={!executiveName || !pin || busy}
            >
              {busy ? "Signing in..." : "Continue"}
              {!busy && <span aria-hidden="true" className="ml-2 text-base">→</span>}
            </Button>

            <p className="mt-5 flex items-center justify-center gap-2 text-center text-[11px] leading-5 text-[#858b81]">
              <span aria-hidden="true" className="grid size-4 place-items-center rounded-[5px] border border-[#aeb5aa] text-[9px]">•</span>
              Secure access for authorised team members
            </p>
          </form>

          <div className="mx-auto mt-4 flex w-full max-w-[480px] flex-wrap justify-between gap-x-3 gap-y-1 px-1 text-[10px] text-[#92978e] sm:text-[11px]">
            <span>Mahavtaar Daily Collection</span>
            <span>Secure team workspace</span>
          </div>
        </section>
      </div>
    </main>
  );
}
