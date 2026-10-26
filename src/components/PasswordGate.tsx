import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { verifySettingsPassword } from "@/lib/app-config.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Same session unlock is shared by Settings and Already Paid.
export const SETTINGS_SESSION_KEY = "mahavtaar-settings-unlocked";
// The entered password is kept per-tab so password-protected server calls can
// verify it server-side. It is cleared on lock/refresh of the tab session.
export const SETTINGS_PASSWORD_KEY = "mahavtaar-settings-pw";

export function getStoredSettingsPassword(): string {
  try {
    return sessionStorage.getItem(SETTINGS_PASSWORD_KEY) ?? "";
  } catch {
    return "";
  }
}

export function clearStoredSettingsPassword() {
  try {
    sessionStorage.removeItem(SETTINGS_PASSWORD_KEY);
    sessionStorage.removeItem(SETTINGS_SESSION_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function PasswordGate({
  onUnlock,
  label = "Unlock Settings",
}: {
  onUnlock: (password: string) => void;
  label?: string;
}) {
  const verify = useServerFn(verifySettingsPassword);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const res = await verify({ data: { password } });
          if (res.ok) {
            try {
              sessionStorage.setItem(SETTINGS_PASSWORD_KEY, password);
              sessionStorage.setItem(SETTINGS_SESSION_KEY, "1");
            } catch {
              /* storage unavailable */
            }
            onUnlock(password);
          } else {
            setError("Incorrect password");
          }
        } catch {
          setError("Incorrect password");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Label className="text-base" htmlFor="settings-password">
        Enter settings password
      </Label>
      <Input
        id="settings-password"
        type="password"
        autoComplete="off"
        className="h-12 text-base"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error !== "" && <p className="text-sm font-medium text-destructive">{error}</p>}
      <Button type="submit" className="h-12 w-full text-base" disabled={busy}>
        {busy ? "Checking…" : label}
      </Button>
    </form>
  );
}
