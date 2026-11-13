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

const spectrum =
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
    <main
      className="relative isolate grid min-h-[100svh] place-items-center overflow-x-hidden bg-white px-[17px] py-7 text-[#292536] sm:px-7"
      style={{
        backgroundImage:
          "radial-gradient(ellipse at 10% 8%, #e8d5f3 0, transparent 27%), radial-gradient(ellipse at 93% 12%, #fff0ae 0, transparent 25%)",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-[8%] -top-[70px] h-[160px] w-[116%]"
        style={{
          background: spectrum,
          clipPath: "ellipse(72% 40% at 50% 0)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-[90px] -left-[8%] h-[160px] w-[116%] rotate-180"
        style={{
          background: spectrum,
          clipPath: "ellipse(72% 40% at 50% 0)",
        }}
      />

      <div className="relative z-10 mx-auto grid w-full max-w-[1160px] grid-cols-1 items-center gap-[15px] md:grid-cols-[1.05fr_0.95fr] md:gap-[clamp(35px,7vw,90px)]">
        <section className="relative flex flex-col items-center px-3 py-2 text-center md:px-[26px] md:py-[38px]">
          <img
            src="/mahavtaar-logo.png"
            alt="Mahavtaar Enterprises"
            className="h-[125px] w-[180px] object-contain drop-shadow-[0_9px_15px_rgba(37,20,92,0.09)] sm:h-[180px] sm:w-[230px] md:h-[240px] md:w-[min(310px,70%)]"
          />

          <p
            className="relative z-10 my-[5px] rounded-full border border-[#e8c65a88] px-4 py-[7px] text-[15px] font-bold tracking-[0.025em] text-[#8a5a00] shadow-[0_0_18px_rgba(231,189,73,0.2)] sm:text-[18px]"
            style={{
              background: "linear-gradient(90deg, #fff8d8cc, #fffdf2ee, #fff0b8cc)",
              fontFamily: '"Noto Serif Devanagari", Georgia, serif',
            }}
          >
            ॐ क्रिया बाबाजी नमः ओम्
          </p>

          <h1 className="mt-[3px] font-serif text-[28px] font-bold leading-none tracking-[-0.035em] text-[#28145e] sm:text-[36px] md:text-[48px]">
            Mahavtaar
          </h1>

          <div className="mt-[11px] flex items-center gap-3 text-[9px] font-extrabold tracking-[0.22em] text-[#47414f] sm:mt-[18px] sm:text-[11px]">
            <span className="h-[2px] w-[22px] bg-[#f5cf00] sm:w-[35px]" />
            DAILY COLLECTION WORKSPACE
            <span className="h-[2px] w-[22px] bg-[#f5cf00] sm:w-[35px]" />
          </div>

          <p className="mt-3 hidden max-w-[420px] text-[12px] leading-[1.8] text-[#7d7884] sm:block sm:text-[14px] md:mt-[23px]">
            A connected workspace for daily payment entry, collection tracking and team operations.
          </p>
        </section>

        <section className="flex w-full items-center justify-center">
          <form
            onSubmit={submit}
            className="w-full max-w-[470px] overflow-hidden rounded-[25px] border border-[#eee8f1] bg-white shadow-[0_22px_65px_rgba(50,32,74,0.08)]"
          >
            <div className="h-[5px] w-full" style={{ background: spectrum }} />
            <div className="px-[21px] py-[25px] sm:px-[clamp(25px,4vw,42px)] sm:py-[clamp(25px,4vw,42px)]">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#99518f]">
                Authorised team access
              </p>
              <h2 className="mb-2 mt-3 text-[clamp(28px,3vw,36px)] font-black tracking-[-0.05em] text-[#30263c]">
                Welcome back.
              </h2>
              <p className="mb-5 text-[13px] leading-[1.6] text-[#898291] sm:mb-[27px]">
                Choose your profile and enter your security PIN to continue.
              </p>

              <div className="my-3 space-y-[9px] sm:my-[18px]">
                <Label htmlFor="executive-name" className="text-[11px] font-bold text-[#393443]">
                  Executive name
                </Label>
                <Select value={executiveName} onValueChange={setExecutiveName} disabled={busy}>
                  <SelectTrigger
                    id="executive-name"
                    className="h-[54px] rounded-xl border-[#e5e0e9] bg-white px-[15px] text-[13px] shadow-none focus:ring-4 focus:ring-[#99518f]/10"
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

              <div className="my-3 space-y-[9px] sm:my-[18px]">
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
                    className="h-[54px] rounded-xl border-[#e5e0e9] bg-white px-[15px] pr-[76px] text-[14px] tracking-[0.2em] shadow-none placeholder:tracking-normal focus-visible:ring-4 focus-visible:ring-[#99518f]/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin((value) => !value)}
                    aria-label={showPin ? "Hide PIN" : "Show PIN"}
                    aria-pressed={showPin}
                    className="absolute right-2 top-2 h-[38px] rounded-lg bg-[#f8f4fa] px-[10px] text-[10px] font-extrabold text-[#7e488d] hover:bg-[#f1e8f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#99518f]"
                  >
                    {showPin ? "HIDE" : "SHOW"}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={!executiveName || !pin || busy}
                className="mt-2 h-[54px] w-full rounded-xl border-0 text-[12px] font-extrabold text-white shadow-[0_9px_22px_rgba(137,65,147,0.19)] transition hover:brightness-105 disabled:opacity-50"
                style={{ background: "linear-gradient(100deg, #8126a4, #a832a0 43%, #258db9)" }}
              >
                {busy ? "Signing in…" : <>Sign in to workspace&nbsp; →</>}
              </Button>

              <div className="mt-[23px] text-center text-[10px] leading-[1.7] text-[#a29aa6]">
                <p>Protected sign-in for authorised users</p>
                <p>© Mahavtaar Enterprises · Daily Collection</p>
              </div>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
