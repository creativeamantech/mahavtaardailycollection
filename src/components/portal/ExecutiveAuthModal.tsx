import { useState } from "react";
import { PORTAL_EXECUTIVES, type PortalExecutive } from "@/lib/portal-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerFn } from "@tanstack/react-start";
import { verifySettingsPassword } from "@/lib/app-config.functions";
import { Lock, ShieldCheck, User, UserCheck } from "lucide-react";

import { useSheetAuth } from "@/hooks/useSheetAuth";

export const PORTAL_EXECUTIVE_STORAGE_KEY = "portal_selected_executive";
export const PORTAL_ADMIN_PASS_STORAGE_KEY = "portal_admin_password";

interface Props {
  currentExecutive: PortalExecutive | null;
  onSelect: (executive: PortalExecutive, adminPassword?: string) => void;
  onClose?: () => void;
}

export function ExecutiveAuthModal({ currentExecutive, onSelect, onClose }: Props) {
  const { user } = useSheetAuth();
  const isSheetAdmin = user?.role === "Admin";

  const [selected, setSelected] = useState<PortalExecutive | null>(
    currentExecutive || (user?.executiveName as PortalExecutive) || null,
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const verify = useServerFn(verifySettingsPassword);

  const handleSelect = async (exec: PortalExecutive) => {
    if (!isSheetAdmin && user?.executiveName && exec !== user.executiveName) {
      setError(`Your account is locked to ${user.executiveName}. Only Admin can switch names.`);
      return;
    }

    setSelected(exec);
    setError("");

    if (exec !== "Aman") {
      // Non-admin executives can enter directly
      sessionStorage.setItem(PORTAL_EXECUTIVE_STORAGE_KEY, exec);
      sessionStorage.removeItem(PORTAL_ADMIN_PASS_STORAGE_KEY);
      onSelect(exec);
      if (onClose) onClose();
    }
  };

  const handleAmanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError("Please enter the administrator password.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const res = await verify({ data: { password } });
      if (res.ok) {
        sessionStorage.setItem(PORTAL_EXECUTIVE_STORAGE_KEY, "Aman");
        sessionStorage.setItem(PORTAL_ADMIN_PASS_STORAGE_KEY, password);
        onSelect("Aman", password);
        if (onClose) onClose();
      } else {
        setError("Incorrect administrator password.");
      }
    } catch {
      setError("Incorrect administrator password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card p-6 shadow-md">
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <UserCheck className="h-6 w-6" />
        </div>
        <h2 className="mt-3 text-2xl font-bold tracking-tight">Choose Your Name</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Select your name before entering the Bank Portal Usage module to record activity and
          access your schedule.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PORTAL_EXECUTIVES.map((exec, idx) => {
          const isAman = exec === "Aman";
          const isCurrent = selected === exec;
          const isLockedOut =
            !isSheetAdmin && Boolean(user?.executiveName) && exec !== user?.executiveName;

          return (
            <button
              key={`portal-auth-${exec}-${idx}`}
              type="button"
              disabled={isLockedOut}
              onClick={() => handleSelect(exec)}
              className={`flex flex-col items-center justify-center rounded-xl border p-4 text-center transition-all ${
                isLockedOut
                  ? "opacity-40 cursor-not-allowed border-border bg-muted/20"
                  : isCurrent
                    ? "border-primary bg-primary/5 ring-2 ring-primary"
                    : "border-border bg-background hover:border-primary/50 hover:bg-accent/40"
              }`}
            >
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full ${
                  isAman
                    ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                    : "bg-primary/10 text-primary"
                }`}
              >
                {isAman ? (
                  <ShieldCheck className="h-5 w-5" />
                ) : isLockedOut ? (
                  <Lock className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <User className="h-5 w-5" />
                )}
              </div>
              <span className="mt-2 font-semibold text-sm">{isAman ? "Aman" : exec}</span>
              <span className="text-[11px] text-muted-foreground">
                {isAman ? "Administrator" : isLockedOut ? "Locked" : "Executive"}
              </span>
            </button>
          );
        })}
      </div>

      {selected === "Aman" && (
        <form
          onSubmit={handleAmanSubmit}
          className="mt-6 rounded-xl border bg-muted/40 p-4 space-y-3"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-purple-800 dark:text-purple-300">
            <Lock className="h-4 w-4" />
            <span>Administrator Password Required for Aman</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Administrative access manages schedules, complaints, warnings, bans, and accountability
            settings.
          </p>

          <div className="space-y-1">
            <Label htmlFor="admin-password">Enter Password</Label>
            <Input
              id="admin-password"
              type="password"
              placeholder="Enter administrator password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11"
              autoFocus
            />
          </div>

          {error && <p className="text-xs font-semibold text-destructive">{error}</p>}

          <Button type="submit" disabled={busy} className="w-full h-11">
            {busy ? "Verifying..." : "Verify & Enter as Aman"}
          </Button>
        </form>
      )}
    </div>
  );
}
