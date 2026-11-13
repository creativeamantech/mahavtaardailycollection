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
    <main className="relative isolate flex min-h-[100svh] items-center justify-center overflow-x-hidden bg-white px-4 py-4 text-[#292536] sm:px-6 sm:py-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px]" style={{ background: brandSpectrum }} />
      <div className="mx-auto grid min-h-[calc(100svh-2rem)] w-full max-w-[1180px] grid-cols-1 items-center gap-5 md:min-h-[min(760px,calc(100svh-3rem))] md:grid-cols-[1fr_0.9fr] md:gap-10 lg:gap-16">
        <section className="flex flex-col items-center justify-center text-center md:min-h-[620px] md:rounded-[28px] md:border md:border-[#eeeaf0] md:bg-[#fff] md:px-8 md:py-8">
          <div className="flex flex-col items-center">
            <div className="grid size-[clamp(112px,17vw,210px)] place-items-center rounded-full bg-white">
              <img
                src="/mahavtaar-logo.png"
                alt="Mahavtaar Enterprises logo"
                className="size-[92%] object-contain"
              />
            </div>
            <p className="mt-2 text-[clamp(25px,3.4vw,39px)] font-black tracking-[-0.055em] text-[#30263c]">
              Mahavtaar
            </p>
            <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.22em] text-[#898291]">
              Daily Collection Workspace
            </p>
            <p
              className="mt-5 bg-clip-text px-2 text-[clamp(17px,2vw,23px)] font-bold leading-relaxed text-transparent"
              style={{
                backgroundImage: brandSpectrum,
                fontFamily: '"Noto Serif Devanagari", "Mangal", Georgia, serif',
              }}
            >
              ॐ क्रिया बाबाजी नमः ओम्
            </p>
            <div className="mt-3 h-[2px] w-28 rounded-full" style={{ background: brandSpectrum }} />
            <p className="mt-5 max-w-[360px] text-[12px] leading-6 text-[#85808c] md:text-[13px]">
              One secure workspace for daily collection, team progress and accountability.
            </p>
          </div>
          <div className="mt-7 hidden items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-[#92899a] md:flex">
            <span>Mahavtaar Enterprises</span>
            <span className="text-[#c8c1cd]">·</span>
            <span className="flex items-center gap-2 normal-case tracking-normal">
              <span className="size-1.5 rounded-full bg-[#62ad61]" />
              Authorised team access
            </span>
          </div>
        </section>

        <section className="flex w-full items-center justify-center py-1 md:py-0">
          <div className="w-full max-w-[420px]">
            <div className="mb-5 flex items-center justify-center gap-2 md:hidden">
              <span className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#898291]">
                Secure team sign in
              </span>
            </div>
            <div className="overflow-hidden rounded-[22px] border border-[#ebe6ee] bg-white shadow-[0_18px_55px_rgba(49,36,63,0.075)] sm:rounded-[25px]">
              <div className="h-[5px] w-full" style={{ background: brandSpectrum }} />
              <div className="px-5 pb-6 pt-6 sm:px-8 sm:pb-8 sm:pt-8">
                <div className="mb-6">
                  <p className="mb-2 text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#99518f]">
                    Executive access
                  </p>
                  <h1 className="text-[29px] font-black leading-tight tracking-[-0.055em] text-[#30263c] sm:text-[34px]">
                    Welcome back.
                  </h1>
                  <p className="mt-2 text-[12px] leading-5 text-[#898291]">
                    Sign in to continue to your Mahavtaar collection workspace.
                  </p>
                </div>

                <form onSubmit={submit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="executive-name" className="text-[11px] font-bold text-[#393443]">
                      Executive name
                    </Label>
                    <Select value={executiveName} onValueChange={setExecutiveName} disabled={busy}>
                      <SelectTrigger
                        id="executive-name"
                        className="h-[50px] rounded-[11px] border-[#e5e0e9] bg-white px-4 text-[13px] shadow-none hover:border-[#bda7cb] focus:ring-4 focus:ring-[#9a5ba8]/10 focus:ring-offset-0"
                      >
                        <SelectValue placeholder="Select your profile" />
                      </SelectTrigger>
                      <SelectContent>
                        {EXECUTIVE_NAMES.map((name) => (
                          <SelectItem key={name} value={name}>{name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="login-pin" className="text-[11px] font-bold text-[#393443]">
                      Security PIN
                    </Label>
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
                        className="h-[50px] rounded-[11px] border-[#e5e0e9] bg-white px-4 pr-16 text-[14px] tracking-[0.2em] shadow-none placeholder:tracking-normal hover:border-[#bda7cb] focus-visible:ring-4 focus-visible:ring-[#9a5ba8]/10 focus-visible:ring-offset-0"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPin((value) => !value)}
                        aria-label={showPin ? "Hide PIN" : "Show PIN"}
                        aria-pressed={showPin}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-2 text-[9px] font-extrabold tracking-[0.12em] text-[#82798c] hover:bg-[#f7f1f8] hover:text-[#8c3e91] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#99518f]"
                      >
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

                  <Button
                    type="submit"
                    disabled={!executiveName || !pin || busy}
                    className="group mt-1 h-[52px] w-full rounded-[11px] border-0 text-[12px] font-extrabold tracking-[0.02em] text-white shadow-[0_9px_22px_rgba(137,65,147,0.2)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_13px_26px_rgba(137,65,147,0.24)] focus-visible:ring-2 focus-visible:ring-[#99518f] focus-visible:ring-offset-2 disabled:translate-y-0 disabled:opacity-50"
                    style={{ background: "linear-gradient(100deg, #8126a4 0%, #a832a0 42%, #258db9 100%)" }}
                  >
                    {busy ? "Signing in…" : "Sign in to workspace"}
                    {!busy && <span aria-hidden="true" className="ml-2 text-base transition-transform group-hover:translate-x-1">→</span>}
                  </Button>
                </form>

                <div className="mt-6 border-t border-[#f0ecf1] pt-4 text-center text-[9px] leading-5 text-[#a29aa6]">
                  <p>© Mahavtaar Enterprises · Daily Collection</p>
                  <p>Secure workspace for authorised team members</p>
                </div>
              </div>
            </div>
            <p className="mt-4 text-center text-[9px] text-[#aaa3ae] md:hidden">
              © Mahavtaar Enterprises
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
