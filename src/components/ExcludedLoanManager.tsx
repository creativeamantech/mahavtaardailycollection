import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addExcludedLoanNumber, getExcludedLoanNumbers, removeExcludedLoanNumber } from "@/lib/excluded-loans.functions";
import { verifySettingsPassword } from "@/lib/app-config.functions";
import { ExcludedLoanBulkManager } from "@/components/ExcludedLoanBulkManager";

export function ExcludedLoanManager() {
  const qc = useQueryClient();
  const getList = useServerFn(getExcludedLoanNumbers);
  const addLoan = useServerFn(addExcludedLoanNumber);
  const removeLoan = useServerFn(removeExcludedLoanNumber);
  const verifyPassword = useServerFn(verifySettingsPassword);
  const [loanNumber, setLoanNumber] = useState("");
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [adminCredential, setAdminCredential] = useState("");
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ["excluded-loan-numbers"],
    queryFn: () => getList(),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const active = useMemo(() => data.filter((r) => r.status.toLowerCase() === "active"), [data]);

  async function unlockAdmin() {
    setBusy(true);
    try {
      const result = await verifyPassword({ data: { password } });
      if (result.ok) {
        setAdminUnlocked(true);
        setAdminCredential(password);
        setPassword("");
        toast.success("Admin controls unlocked.");
      } else {
        toast.error("Incorrect admin password.");
      }
    } catch {
      toast.error("Could not verify admin access.");
    } finally {
      setBusy(false);
    }
  }

  async function submitAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!loanNumber.trim()) return;
    setBusy(true);
    try {
      await addLoan({ data: { loanNumber: loanNumber.trim(), reason: reason.trim(), adminPassword: adminCredential } });
      setLoanNumber("");
      setReason("");
      await qc.invalidateQueries({ queryKey: ["excluded-loan-numbers"] });
      await qc.invalidateQueries({ queryKey: ["collections"] });
      toast.success("Loan number excluded from collection reports.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add excluded loan number.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(loan: string) {
    if (!window.confirm(`Remove ${loan} from the exclusion list? Its eligible payments will count in reports again.`)) return;
    setBusy(true);
    try {
      await removeLoan({ data: { loanNumber: loan, adminPassword: adminCredential } });
      await qc.invalidateQueries({ queryKey: ["excluded-loan-numbers"] });
      await qc.invalidateQueries({ queryKey: ["collections"] });
      toast.success("Loan number removed from the active exclusion list.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove excluded loan number.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="excluded-loans" className="mt-6 scroll-mt-6 space-y-4 rounded-xl border p-4">
      <div>
        <h2 className="text-xl font-bold">Excluded Loan Numbers</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Active exclusions are omitted from collection totals, executive performance, payment counts, averages and reports. Original payment rows remain unchanged.
        </p>
      </div>

      {!adminUnlocked ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void unlockAdmin(); }}>
          <Label htmlFor="excluded-admin-password">Admin password to manage exclusions</Label>
          <div className="flex gap-2">
            <Input id="excluded-admin-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Admin password" className="h-11" />
            <Button type="submit" disabled={busy || !password}>Unlock</Button>
          </div>
        </form>
      ) : (
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitAdd}>
          <div className="space-y-1">
            <Label htmlFor="excluded-loan-number">Loan Number</Label>
            <Input id="excluded-loan-number" value={loanNumber} onChange={(e) => setLoanNumber(e.target.value)} placeholder="Enter loan number" className="h-11" required maxLength={60} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="excluded-reason">Reason (optional)</Label>
            <Input id="excluded-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for exclusion" className="h-11" maxLength={300} />
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" disabled={busy || !loanNumber.trim()}>{busy ? "Saving..." : "Add to Exclusion List"}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => { setAdminUnlocked(false); setAdminCredential(""); }}>Lock Admin Controls</Button>
          </div>
        </form>
      )}

      <ExcludedLoanBulkManager />

      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Current Exclusion List ({active.length})</h3>
        <Button type="button" size="sm" variant="outline" onClick={() => void refetch()} disabled={isLoading}>Refresh</Button>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading exclusion list...</p> : active.length === 0 ? (
        <p className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">No excluded loan numbers.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted"><tr><th className="p-3 text-left">Loan Number</th><th className="p-3 text-left">Date Added</th><th className="p-3 text-left">Reason</th>{adminUnlocked && <th className="p-3 text-right">Action</th>}</tr></thead>
            <tbody>
              {active.map((item, index) => (
                <tr key={`${item.loanNumber}-${item.dateAdded}-${index}`} className="border-t">
                  <td className="p-3 font-medium">{item.loanNumber}</td>
                  <td className="p-3 whitespace-nowrap">{item.dateAdded || "—"}</td>
                  <td className="p-3">{item.reason || "—"}</td>
                  {adminUnlocked && <td className="p-3 text-right"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void remove(item.loanNumber)}>Remove</Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
