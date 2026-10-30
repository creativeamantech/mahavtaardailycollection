import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADMIN_CREDENTIAL_KEY, ADMIN_SESSION_KEY } from "@/components/PasswordGate";
import { addExcludedLoanNumbersBulk } from "@/lib/excluded-loans.functions";

export function ExcludedLoanBulkManager() {
  const qc = useQueryClient();
  const addBulk = useServerFn(addExcludedLoanNumbersBulk);
  const [unlocked, setUnlocked] = useState(() => typeof window !== "undefined" && sessionStorage.getItem(ADMIN_SESSION_KEY) === "1");
  const [loanNumbers, setLoanNumbers] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <section className="space-y-3 rounded-lg border border-dashed p-3">
      <div>
        <h3 className="font-semibold">Bulk Paste Loan Numbers</h3>
        <p className="mt-1 text-sm text-muted-foreground">Excel या Google Sheets से loan numbers सीधे paste करें। हर line में एक number या comma/space/semicolon-separated list भी मान्य है। Duplicate और पहले से active numbers skip होंगे; अधिकतम 5,000 unique numbers प्रति batch।</p>
      </div>
      {unlocked ? (
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          if (!loanNumbers.trim()) return;
          setBusy(true);
          try {
            const result = await addBulk({ data: { loanNumbersText: loanNumbers, reason: reason.trim(), adminPassword: sessionStorage.getItem(ADMIN_CREDENTIAL_KEY) ?? "" } });
            setLoanNumbers("");
            await qc.invalidateQueries({ queryKey: ["excluded-loan-numbers"] });
            await qc.invalidateQueries({ queryKey: ["collections"] });
            toast.success(`Bulk import complete: ${result.added} added, ${result.skippedExisting} already-active duplicates skipped.`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Bulk import failed.");
          } finally { setBusy(false); }
        }}>
          <div className="space-y-1">
            <Label htmlFor="excluded-bulk-numbers">Loan numbers</Label>
            <Textarea id="excluded-bulk-numbers" value={loanNumbers} onChange={(e) => setLoanNumbers(e.target.value)} placeholder={"Loan number 1\nLoan number 2\nLoan number 3"} rows={6} className="font-mono text-sm" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="excluded-bulk-reason">Reason (optional, applies to all)</Label>
            <Input id="excluded-bulk-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Reason for exclusion" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || !loanNumbers.trim()}>{busy ? "Processing…" : "Bulk Add to Exclusion List"}</Button>
          </div>
        </form>
      ) : <p className="text-sm text-muted-foreground">Admin unlock required. Open any Admin page and unlock once.</p>}
    </section>
  );
}
