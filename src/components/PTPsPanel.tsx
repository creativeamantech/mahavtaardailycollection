import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { EXECUTIVES } from "@/lib/executives";
import { getCurrentSession } from "@/lib/auth.functions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listActivePTPs, removePTPs, submitPTPs } from "@/lib/ptp.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ActivePTP = {
  row: number;
  submittedAt: string;
  executive: string;
  loanId: string;
  remarks: string;
  status: string;
};

function normaliseLoanId(value: string) {
  return value
    .replace(/^['’‘\x60]+/, "")
    .trim()
    .toUpperCase();
}

export function PTPsPanel() {
  const queryClient = useQueryClient();
  const [executive, setExecutive] = useState("");
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
  const [loanIdsText, setLoanIdsText] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingCases, setLoadingCases] = useState(false);
  const [activeCases, setActiveCases] = useState<ActivePTP[]>([]);
  const [selectedToRemove, setSelectedToRemove] = useState<string[]>([]);
  const submit = useServerFn(submitPTPs);
  const loadCases = useServerFn(listActivePTPs);
  const removeCases = useServerFn(removePTPs);

  const loanIds = useMemo(() => {
    const raw = loanIdsText
      .split(/[\s,;]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    return raw.filter((value) => {
      const key = normaliseLoanId(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [loanIdsText]);

  async function loadMyPTPs() {
    if (!executive) {
      toast.error("Please select your executive name first.");
      return;
    }
    setLoadingCases(true);
    try {
      const result = await loadCases({
        data: { executive: executive as (typeof EXECUTIVES)[number] },
      });
      setActiveCases(result as ActivePTP[]);
      setSelectedToRemove([]);
      if (result.length === 0) toast.info("No active PTPs found for this executive.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load PTPs.");
    } finally {
      setLoadingCases(false);
    }
  }

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
      await queryClient.invalidateQueries({ queryKey: ["report-bundle"] });
      if (result.savedCount > 0)
        toast.success(result.savedCount + " PTP(s) submitted successfully.");
      if (result.skippedPaidCount > 0)
        toast.warning(
          result.skippedPaidCount +
            " Loan ID(s) already Paid — skipped. Paid cases cannot be added to PTP.",
        );
      if (result.skippedHoldCount > 0)
        toast.warning(
          result.skippedHoldCount +
            " Loan ID(s) already in Hold — skipped. These remain in Hold, not PTP.",
        );
      if (result.duplicateCount > 0)
        toast.info(result.duplicateCount + " duplicate/already-active PTP Loan ID(s) skipped.");
      if (
        result.savedCount === 0 &&
        result.duplicateCount > 0 &&
        result.skippedPaidCount === 0 &&
        result.skippedHoldCount === 0
      )
        toast.info("No new PTPs were added.");
      setLoanIdsText("");
      setRemarks("");
      if (executive) await loadMyPTPs();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit PTPs.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveSelected() {
    if (!executive || selectedToRemove.length === 0) return;
    setSaving(true);
    try {
      const result = await removeCases({
        data: {
          executive: executive as (typeof EXECUTIVES)[number],
          loanIds: selectedToRemove,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["report-bundle"] });
      if (result.removedCount > 0) toast.success(result.removedCount + " PTP(s) removed.");
      if (result.skippedPaidCount > 0)
        toast.warning(result.skippedPaidCount + " Paid Loan ID(s) were protected and not removed.");
      await loadMyPTPs();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove PTPs.");
    } finally {
      setSaving(false);
    }
  }

  function toggleSelected(loanId: string, checked: boolean) {
    setSelectedToRemove((current) =>
      checked
        ? [...current.filter((id) => normaliseLoanId(id) !== normaliseLoanId(loanId)), loanId]
        : current.filter((id) => normaliseLoanId(id) !== normaliseLoanId(loanId)),
    );
  }

  return (
    <section className="mt-6 space-y-6 rounded-xl border p-4">
      <div className="space-y-2">
        <Label className="text-base">Executive Name</Label>
        {session?.role === "Admin" ? (
          <Select
            value={executive}
            onValueChange={(value) => {
              setExecutive(value);
              setActiveCases([]);
              setSelectedToRemove([]);
            }}
          >
            <SelectTrigger className="h-12 text-base">
              <SelectValue placeholder="Select executive" />
            </SelectTrigger>
            <SelectContent>
              {EXECUTIVES.map((name) => (
                <SelectItem key={name} value={name} className="text-base">
                  {name}
                </SelectItem>
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
        <h3 className="text-lg font-semibold">Add PTPs</h3>
        <Label className="text-base" htmlFor="ptpLoanIds">
          Loan IDs (Bulk Entry)
        </Label>
        <Textarea
          id="ptpLoanIds"
          value={loanIdsText}
          onChange={(event) => setLoanIdsText(event.target.value)}

          placeholder={"Paste multiple Loan IDs — one per line\n185978480\n184267502\n182564627"}
          className="min-h-40 resize-y text-base"
          aria-describedby="ptp-loan-help"
        />
        <p id="ptp-loan-help" className="text-sm text-muted-foreground">
          Paste IDs from Excel or a list. New lines, spaces, commas and semicolons are supported.
        </p>
        <p className="text-sm font-medium">{loanIds.length} unique Loan ID(s) ready</p>
      </div>

      <div className="space-y-2">
        <Label className="text-base" htmlFor="ptpRemarks">
          PTP Remarks (Optional)
        </Label>
        <Input
          id="ptpRemarks"
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
        {saving ? "Submitting..." : "Submit PTPs"}
      </Button>

      <div className="border-t pt-5 space-y-3">
        <div>
          <h3 className="text-lg font-semibold">Remove PTPs</h3>
          <p className="text-sm text-muted-foreground">
            Select your executive name above, load your active cases, then choose the cases to
            remove.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full h-11"
          onClick={loadMyPTPs}
          disabled={!executive || loadingCases || saving}
        >
          {loadingCases ? "Loading..." : "Load My Active PTPs"}
        </Button>
        {activeCases.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{activeCases.length} active case(s)</span>
              <button
                type="button"
                className="text-primary underline"
                onClick={() =>
                  setSelectedToRemove(
                    selectedToRemove.length === activeCases.length
                      ? []
                      : activeCases.map((item) => item.loanId),
                  )
                }
              >
                {selectedToRemove.length === activeCases.length ? "Clear selection" : "Select all"}
              </button>
            </div>
            <ul className="max-h-72 space-y-2 overflow-y-auto rounded-lg border p-3">
              {activeCases.map((item) => (
                <li key={item.row} className="flex items-start gap-3 border-b pb-2 last:border-0">
                  <Checkbox
                    checked={selectedToRemove.some(
                      (id) => normaliseLoanId(id) === normaliseLoanId(item.loanId),
                    )}
                    onCheckedChange={(checked) => toggleSelected(item.loanId, checked === true)}
                    aria-label={"Select Loan ID " + item.loanId + " for removal"}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold break-all">{item.loanId}</p>
                    {item.remarks && (
                      <p className="text-sm text-muted-foreground">{item.remarks}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Added: {item.submittedAt || "—"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="destructive"
              className="h-12 w-full"
              onClick={handleRemoveSelected}
              disabled={saving || selectedToRemove.length === 0}
            >
              {saving ? "Processing..." : "Remove Selected (" + selectedToRemove.length + ")"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Removed PTPs remain in Google Sheet history with a Removed status and timestamp.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
