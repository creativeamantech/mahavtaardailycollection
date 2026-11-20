import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { EXECUTIVES } from "@/lib/executives";
import { getCurrentSession } from "@/lib/auth.functions";
import { submitSensitiveCases } from "@/lib/sensitive-cases.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function normaliseLoanId(value: string) {
  return value.replace(/^['’‘\x60]+/, "").trim().toUpperCase();
}

export function SensitiveCasesPanel() {
  const [executive, setExecutive] = useState("");
  const [loanIdsText, setLoanIdsText] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const getSession = useServerFn(getCurrentSession);
  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ["auth-session"],
    queryFn: () => getSession(),
    staleTime: 30_000,
  });
  useEffect(() => {
    if (session?.role === "Executive") setExecutive(session.name);
    else if (session?.role === "Admin") setExecutive("");
  }, [session]);

  const submit = useServerFn(submitSensitiveCases);
  const loanIds = useMemo(() => {
    const raw = loanIdsText.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean);
    const seen = new Set<string>();
    return raw.filter((value) => {
      const key = normaliseLoanId(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [loanIdsText]);

  async function handleSubmit() {
    if (!executive) {
      toast.error("Please select your executive name.");
      return;
    }
    if (loanIds.length === 0) {
      toast.error("Please enter at least one Loan ID.");
      return;
    }
    setSaving(true);
    try {
      const result = await submit({
        data: {
          executive: executive as (typeof EXECUTIVES)[number],
          loanIds,
          remarks: remarks.trim(),
        },
      });
      if (result.savedCount > 0)
        toast.success(result.savedCount + " Sensitive Case(s) submitted successfully.");
      if (result.duplicateCount > 0)
        toast.info(result.duplicateCount + " duplicate/already-listed Loan ID(s) skipped.");
      setLoanIdsText("");
      setRemarks("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit Sensitive Cases.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 space-y-6 rounded-xl border p-4">
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900">
        Sensitive Cases are permanent entries. Once a Loan ID is submitted, it cannot be removed
        from this section.
      </div>
      <div className="space-y-2">
        <Label className="text-base">Executive Name</Label>
        {session?.role === "Admin" ? (
          <Select value={executive} onValueChange={setExecutive}>
            <SelectTrigger className="h-12 text-base">
              <SelectValue placeholder="Select executive" />
            </SelectTrigger>
            <SelectContent>
              {EXECUTIVES.map((name) => (
                <SelectItem key={name} value={name} className="text-base">{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex h-12 items-center rounded-md border bg-muted px-3 text-base">
            {sessionLoading ? "Loading logged-in executive..." : executive || session?.name || "Executive not available"}
          </div>
        )}
      </div>
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Add Sensitive Cases</h3>
        <Label className="text-base" htmlFor="sensitiveLoanIds">Loan IDs (Bulk Entry)</Label>
        <Textarea
          id="sensitiveLoanIds"
          value={loanIdsText}
          onChange={(event) => setLoanIdsText(event.target.value)}
          placeholder={"Paste multiple Loan IDs — one per line\n185978480\n184267502\n182564627"}
          className="min-h-40 resize-y text-base"
          aria-describedby="sensitive-loan-help"
        />
        <p id="sensitive-loan-help" className="text-sm text-muted-foreground">
          Paste IDs from Excel or a list. New lines, spaces, commas and semicolons are supported.
        </p>
        <p className="text-sm font-medium">{loanIds.length} unique Loan ID(s) ready</p>
      </div>
      <div className="space-y-2">
        <Label className="text-base" htmlFor="sensitiveRemarks">Sensitive Case Remarks (Optional)</Label>
        <Input
          id="sensitiveRemarks"
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          maxLength={300}
          placeholder="Optional"
          className="h-12 text-base"
        />
      </div>
      <Button
        className="h-14 w-full text-lg"
        onClick={handleSubmit}
        disabled={saving || !executive || loanIds.length === 0}
      >
        {saving ? "Submitting..." : "Submit Sensitive Cases"}
      </Button>
    </section>
  );
}
