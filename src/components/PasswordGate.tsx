import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { verifySettingsPassword } from "@/lib/app-config.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// One shared unlock state for every page inside the Admin section.
export const ADMIN_SESSION_KEY = "mahavtaar-admin-unlocked";
export const ADMIN_CREDENTIAL_KEY = "mahavtaar-admin-credential";
export const SETTINGS_SESSION_KEY = ADMIN_SESSION_KEY;

export function PasswordGate({
  onUnlock,
  label = "Unlock Settings",
}: {
  onUnlock: () => void;
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
          if (res.ok) { sessionStorage.setItem(ADMIN_SESSION_KEY, "1"); sessionStorage.setItem(ADMIN_CREDENTIAL_KEY, password); onUnlock(); }
          else setError("Incorrect password");
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
