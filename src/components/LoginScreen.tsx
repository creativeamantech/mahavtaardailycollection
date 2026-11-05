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

// Keep the login dropdown independent of Google Sheets API reads.
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
    <main className="flex min-h-[80vh] items-center justify-center px-4 py-10">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-xl border bg-card p-6 shadow-sm"
      >
        <div>
          <h1 className="text-2xl font-bold">Mahavtaar Daily Collection</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in with your executive PIN</p>
        </div>
        <div className="space-y-2">
          <Label>Executive Name</Label>
          <Select
            value={executiveName}
            onValueChange={setExecutiveName}
            disabled={busy}
          >
            <SelectTrigger>
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
        <div className="space-y-2">
          <Label htmlFor="login-pin">PIN</Label>
          <Input
            id="login-pin"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Enter PIN"
          />
        </div>
        <Button
          type="submit"
          className="w-full"
          disabled={!executiveName || !pin || busy}
        >
          {busy ? "Signing in..." : "Login"}
        </Button>
      </form>
    </main>
  );
}
