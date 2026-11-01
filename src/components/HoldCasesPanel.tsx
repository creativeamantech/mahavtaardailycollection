import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { EXECUTIVES } from "@/lib/executives";
import { submitHoldCases } from "@/lib/hold-cases.functions";
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
  return value.replace(/^['`\u2018\u2019]+/, "").trim().toUpperCase();
}

export function HoldCasesPanel() {
  const [executive, setExecutive] = useState("");
  const [loanIdsText, setLoanIdsText] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = useServerFn(submitHoldCases);

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
        data: { executive: executive as (typeof EXECUTIVES)[number], loanIds, remarks: remarks.trim() },
      });
      if (result.savedCount > 0) {
        toast.success(`${result.savedCount} Hold Case(s) submitted successfully.`);
      }
      if (result.duplicateCount > 0) {
        toast.warning(`${result.duplicateCount} duplicate/already-held Loan ID(s) skipped.`);
      }
      if (result.savedCount === 0 && result.duplicateCount > 0) {
        toast.info("No new Hold Cases were added.");
      }
      setLoanIdsText("");
      setRemarks("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit Hold Cases.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 space-y-5 rounded-xl border p-4">
      <div className="space-y-2">
        <Label className="text-base">Executive Name</Label>
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
      </div>

      <div className="space-y-2">
        <Label className="text-base" htmlFor="holdLoanIds">Loan IDs (Bulk Entry)</Label>
        <Textarea
          id="holdLoanIds"
          value={loanIdsText}
          onChange={(event) => setLoanIdsText(event.target.value)}
          placeholder={"Paste multiple Loan IDs — one per line\n185978480\n184267502\n182564627"}
          className="min-h-40 resize-y text-base"
          aria-describedby="hold-loan-help"
        />
        <p id="hold-loan-help" className="text-sm text-muted-foreground">
          Paste IDs from Excel or a list. New lines, spaces, commas and semicolons are supported.
        </p>
        <p className="text-sm font-medium">{loanIds.length} unique Loan ID(s) ready</p>
      </div>

      <div className="space-y-2">
        <Label className="text-base" htmlFor="holdRemarks">Hold Reason / Remarks (Optional)</Label>
        <Input
          id="holdRemarks"
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          maxLength={300}
          placeholder="Optional"
          className="h-12 text-base"
        />
      </div>

      <Button className="h-14 w-full text-lg" onClick={handleSubmit} disabled={saving || !executive || loanIds.length === 0}>
        {saving ? "Submitting..." : "Submit Hold Cases"}
      </Button>
    </section>
  );
}
