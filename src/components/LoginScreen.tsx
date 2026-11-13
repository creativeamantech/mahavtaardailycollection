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

const brandGradient =
  "linear-gradient(105deg, #8626a5 0%, #c52c91 27%, #159bd2 58%, #55b44d 100%)";

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
    <main className="relative isolate min-h-[100svh] overflow-hidden bg-[#fbfbfe] px-4 py-6 text-[#202236] sm:px-6 sm:py-9">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 -top-56 -z-10 size-[560px] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(34,184,210,0.16), rgba(21,155,210,0) 68%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-64 -left-48 -z-10 size-[600px] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(208,42,145,0.13), rgba(141,40,168,0) 68%)",
        }}
      />

      <div className="mx-auto grid min-h-[calc(100svh-3rem)] w-full max-w-[1320px] grid-cols-1 items-center gap-8 md:min-h-[calc(100svh-4.5rem)] md:grid-cols-[1.08fr_0.92fr] md:gap-10 lg:gap-16">
        <section className="flex min-h-0 flex-col justify-between py-1 md:min-h-[650px] md:py-3">
          <div className="flex items-center gap-3">
            <img
              src="/mahavtaar-logo.png"
              alt="Mahavtaar logo"
              className="size-12 shrink-0 object-contain sm:size-14"
            />
            <div className="leading-tight">
              <p className="text-[18px] font-black tracking-[-0.04em] text-[#25243a]">
                Mahavtaar
              </p>
              <p className="mt-1 text-[10px] font-bold tracking-[0.14em] text-[#85889a]">
                DAILY COLLECTION WORKSPACE
              </p>
            </div>
          </div>

          <div className="my-7 max-w-[620px] md:my-12">
            <p className="inline-flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#922b9e] sm:text-[11px]">
              <span
                className="h-[2px] w-7 rounded-full"
                style={{ background: brandGradient }}
              />
              A smarter way to work
            </p>
            <h1 className="mt-4 text-[clamp(2.5rem,5.2vw,4.7rem)] font-black leading-[1.02] tracking-[-0.065em] text-[#222238]">
              Every collection.
              <br />
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(100deg, #8626a5 0%, #168fc8 38%, #55ad53 68%, #ed8926 100%)",
                }}
              >
                In clear focus.
              </span>
            </h1>
            <p className="mt-5 max-w-[490px] text-[13px] leading-7 text-[#777b8d] sm:text-[15px] sm:leading-8">
              Your team’s daily collection operations, organised in one focused
              workspace. Sign in to continue your work with clarity and confidence.
            </p>

            <div className="mt-7 flex w-[190px] gap-1.5" aria-hidden="true">
              {[
                "#9226a5",
                "#cf2991",
                "#169ed0",
                "#55b44d",
                "#f2c62d",
                "#f28a27",
                "#e8493d",
              ].map((color) => (
                <span
                  key={color}
                  className="h-[5px] flex-1 rounded-full"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          <div className="hidden items-center gap-2 text-[11px] font-medium text-[#85899a] md:flex">
            <span className="size-2 rounded-full bg-[#65b64c] ring-4 ring-[#65b64c]/15" />
            Authorised team access
          </div>
        </section>

        <section className="flex w-full items-center justify-center">
          <div className="w-full max-w-[460px]">
            <form
              onSubmit={submit}
              className="relative overflow-hidden rounded-[24px] border border-[#e8e8f0] bg-white/95 px-5 pb-7 pt-8 shadow-[0_25px_80px_rgba(39,34,70,0.09)] backdrop-blur-xl sm:rounded-[27px] sm:px-9 sm:pb-9 sm:pt-10"
            >
              <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-1"
                style={{
                  background:
                    "linear-gradient(90deg, #8626a5, #cf2991, #169ed0, #55b44d, #f2c62d, #f28a27, #e8493d)",
                }}
              />

              <div className="mb-7 flex items-center gap-3 md:hidden">
                <img
                  src="/mahavtaar-logo.png"
                  alt="Mahavtaar logo"
                  className="size-11 object-contain"
                />
                <div className="leading-tight">
                  <p className="text-base font-black tracking-tight text-[#25243a]">
                    Mahavtaar
                  </p>
                  <p className="mt-1 text-[10px] font-semibold tracking-wide text-[#85889a]">
                    Daily Collection Workspace
                  </p>
                </div>
              </div>

              <header className="mb-7">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#a04b9e]">
                  Welcome back
                </p>
                <h2 className="mt-2 text-[29px] font-black tracking-[-0.05em] text-[#24243a] sm:text-[32px]">
                  Sign in
                </h2>
                <p className="mt-2 text-[13px] leading-6 text-[#85889a]">
                  Select your executive profile and enter your PIN to access the
                  workspace.
                </p>
              </header>

              <div className="mb-5 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <Label
                    htmlFor="executive-name"
                    className="text-[12px] font-bold text-[#37394c]"
                  >
                    Executive name
                  </Label>
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-[#a1a3b0]">
                    Required
                  </span>
                </div>
                <Select
                  value={executiveName}
                  onValueChange={setExecutiveName}
                  disabled={busy}
                >
                  <SelectTrigger
                    id="executive-name"
                    className="h-[53px] rounded-[12px] border-[#e3e4ed] bg-white px-4 text-[13px] shadow-none transition focus:ring-4 focus:ring-[#9226a5]/10 focus:ring-offset-0"
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

              <div className="mb-6 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <Label
                    htmlFor="login-pin"
                    className="text-[12px] font-bold text-[#37394c]"
                  >
                    PIN
                  </Label>
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-[#a1a3b0]">
                    Required
                  </span>
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
                    className="h-[53px] rounded-[12px] border-[#e3e4ed] bg-white px-4 pr-16 text-[14px] tracking-[0.2em] shadow-none transition focus-visible:ring-4 focus-visible:ring-[#9226a5]/10 focus-visible:ring-offset-0"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin((current) => !current)}
                    aria-label={showPin ? "Hide PIN" : "Show PIN"}
                    aria-pressed={showPin}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-2 text-[10px] font-extrabold tracking-wide text-[#777b8d] transition hover:bg-[#f6f1f8] hover:text-[#9226a5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9226a5]"
                  >
                    {showPin ? "HIDE" : "SHOW"}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="h-[54px] w-full rounded-[12px] border-0 text-[13px] font-extrabold text-white shadow-[0_9px_22px_rgba(117,53,153,0.2)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_13px_27px_rgba(117,53,153,0.25)] focus-visible:ring-2 focus-visible:ring-[#9226a5] focus-visible:ring-offset-2 disabled:translate-y-0 disabled:opacity-50"
                style={{ backgroundImage: brandGradient }}
                disabled={!executiveName || !pin || busy}
              >
                {busy ? "Signing in..." : "Continue"}
                {!busy && (
                  <span aria-hidden="true" className="ml-2 text-base">
                    →
                  </span>
                )}
              </Button>

              <p className="mt-5 flex items-center justify-center gap-2 text-center text-[10px] leading-5 text-[#9295a4]">
                <span
                  aria-hidden="true"
                  className="grid size-4 place-items-center rounded-[5px] border border-[#c7c8d2] text-[9px]"
                >
                  •
                </span>
                Secure access for authorised team members
              </p>
            </form>

            <div className="mx-auto mt-4 flex w-full flex-wrap justify-between gap-x-3 gap-y-1 px-1 text-[9px] text-[#a0a2ae] sm:text-[10px]">
              <span>Mahavtaar Daily Collection</span>
              <span>Secure team workspace</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
