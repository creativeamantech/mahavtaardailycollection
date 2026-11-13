import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Download,
  FileSpreadsheet,
  Loader2,
  Lock,
  Search,
  ShieldCheck,
  SkipForward,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { downloadCsv, toCsv } from "@/lib/export";
import {
  computeSamplePreview,
  isMappingValid,
  type ColumnMapping,
  type DacMode,
  type DuplicateStrategy,
  type ReconciledRow,
  type ReconciliationAction,
  type ReconciliationSummary,
  type SheetInfo,
} from "@/lib/paid-file-reconciliation";

export type ReviewTab =
  | "all_changes"
  | "clean_updates"
  | "conflicts"
  | "master_higher"
  | "protected"
  | "unchanged"
  | "unmatched"
  | "zero_amount";

export type ZeroAmountChange = {
  row: number;
  agreementId: string;
  dac: number;
  ecs: number;
  special: number;
  paymentDate: string;
};

export type PaidFileWorkspaceProps = {
  step: "mapping" | "review";
  onStepChange: (step: "mapping" | "review") => void;
  fileName: string;
  masterFound: boolean;
  onRefreshMaster: () => void;
  spreadsheetName: string;
  sheets: SheetInfo[];
  sheetName: string;
  onSelectSheet: (sheetName: string) => void;
  mapping: ColumnMapping;
  onMappingChange: (mapping: ColumnMapping) => void;
  duplicateStrategy: DuplicateStrategy;
  onDuplicateStrategyChange: (strategy: DuplicateStrategy) => void;
  defaultPaymentDate: string;
  onDefaultPaymentDateChange: (date: string) => void;
  onAnalyze: () => void;
  reconciledRows: ReconciledRow[];
  summary: ReconciliationSummary;
  onOverrideDac: (agreementId: string, dac: number) => void;
  onCommit: () => Promise<void>;
  onApplyZeroAmount: (changes: ZeroAmountChange[]) => Promise<void>;
  onCancelSession: () => void;
  busy: boolean;
  applied: boolean;
  progress: number;
  progressLabel: string;
};

type ModalProps = PaidFileWorkspaceProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const money = (n: number) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const signedMoney = (n: number) => {
  const num = Number(n || 0);
  if (Math.abs(num) <= 0.005) return "₹0";
  return (
    (num > 0 ? "+" : "-") +
    "₹" +
    Math.abs(num).toLocaleString("en-IN", { maximumFractionDigits: 2 })
  );
};

function actionMeta(action: ReconciliationAction) {
  switch (action) {
    case "clean_update":
      return {
        label: "Update Needed",
        cls: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
        dotCls: "bg-emerald-600",
      };
    case "provisional_confirmed":
      return {
        label: "Provisional Confirmed",
        cls: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
        dotCls: "bg-emerald-600",
      };
    case "protected_conflict":
      return {
        label: "Protected Conflict",
        cls: "bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300",
        dotCls: "bg-red-600",
      };
    case "conflict_provisional":
      return {
        label: "Conflict Flagged",
        cls: "bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300",
        dotCls: "bg-red-600",
      };
    case "master_higher":
      return {
        label: "Master Higher (Skipped)",
        cls: "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
        dotCls: "bg-amber-500",
      };
    case "protected_match":
      return {
        label: "Protected Skip",
        cls: "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
        dotCls: "bg-amber-500",
      };
    case "unchanged":
      return {
        label: "Already Matched",
        cls: "bg-muted text-muted-foreground",
        dotCls: "bg-muted-foreground/60",
      };
    case "unmatched":
      return {
        label: "Unmatched",
        cls: "bg-muted/80 text-muted-foreground",
        dotCls: "bg-muted-foreground/50",
      };
  }
}

export function PaidFileReconciliationWorkspace({
  step,
  onStepChange,
  fileName,
  masterFound,
  onRefreshMaster,
  spreadsheetName,
  sheets,
  sheetName,
  onSelectSheet,
  mapping,
  onMappingChange,
  duplicateStrategy,
  onDuplicateStrategyChange,
  defaultPaymentDate,
  onDefaultPaymentDateChange,
  onAnalyze,
  reconciledRows,
  summary,
  onOverrideDac,
  onCommit,
  onApplyZeroAmount,
  onCancelSession,
  busy,
  applied,
  progress,
  progressLabel,
}: PaidFileWorkspaceProps) {
  const [reviewTab, setReviewTab] = useState<ReviewTab>("all_changes");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [zeroAmounts, setZeroAmounts] = useState<
    Record<string, { dac: string; ecs: string; special: string }>
  >({});
  const [zeroPaymentDates, setZeroPaymentDates] = useState<Record<string, string>>({});
  const [bulkPasteOpen, setBulkPasteOpen] = useState(false);
  const [bulkPasteText, setBulkPasteText] = useState("");
  const [bulkPasteMessage, setBulkPasteMessage] = useState("");

  const zeroAmountRows = useMemo(
    () => reconciledRows.filter((row) => row.dac === 0 && row.ecs === 0 && row.special === 0),
    [reconciledRows],
  );
  const eligibleZeroRows = useMemo(
    () =>
      zeroAmountRows.filter(
        (row) =>
          row.master &&
          !row.protectedSkip &&
          row.action !== "protected_conflict" &&
          row.action !== "conflict_provisional",
      ),
    [zeroAmountRows],
  );
  const zeroReadyCount = useMemo(
    () =>
      eligibleZeroRows.filter((row) => {
        const values = zeroAmounts[row.agreementId] ?? { dac: "", ecs: "", special: "" };
        return [values.dac, values.ecs, values.special].some((value) => Number(value) > 0);
      }).length,
    [eligibleZeroRows, zeroAmounts],
  );

  function applyBulkPaste() {
    const lines = bulkPasteText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      setBulkPasteMessage("Paste at least one loan row.");
      return;
    }
    const firstLine = lines[0] ?? "";
    const delimiter = firstLine.includes("\t") ? "\t" : firstLine.includes("|") ? "|" : ",";
    const firstCells = firstLine.split(delimiter).map((cell) => cell.trim().toLowerCase());
    const hasHeader = firstCells.some((cell) => /loan|agreement|account/.test(cell));
    const dataLines = hasHeader ? lines.slice(1) : lines;
    const eligibleById = new Map(
      eligibleZeroRows.map((row) => [row.agreementId.trim().toLowerCase(), row]),
    );
    const updates: Array<{
      agreementId: string;
      dac: string;
      ecs: string;
      special: string;
      paymentDate: string;
    }> = [];
    const errors: string[] = [];

    dataLines.forEach((line, index) => {
      const cells = line.split(delimiter).map((cell) => cell.trim());
      const [loanNumber, dac = "", ecs = "", special = "", paymentDate = ""] = cells;
      const lineNum = index + (hasHeader ? 2 : 1);
      if (!loanNumber) {
        errors.push(`Line ${lineNum}: missing loan number`);
        return;
      }
      if ([dac, ecs, special].every((value) => value === "") && !paymentDate) {
        errors.push(`Line ${lineNum}: no amount or date supplied`);
        return;
      }
      const row = eligibleById.get(loanNumber.toLowerCase());
      if (!row) {
        errors.push(`Line ${lineNum}: loan ${loanNumber} is unmatched, protected, or not eligible`);
        return;
      }
      const validAmounts = [dac, ecs, special].every(
        (value) =>
          value === "" ||
          (Number.isFinite(Number(value.replace(/₹|,/g, ""))) &&
            Number(value.replace(/₹|,/g, "")) >= 0),
      );
      if (!validAmounts) {
        errors.push(`Line ${lineNum}: invalid amount for ${loanNumber}`);
        return;
      }
      if (paymentDate && !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
        errors.push(`Line ${lineNum}: date must be YYYY-MM-DD for ${loanNumber}`);
        return;
      }
      updates.push({
        agreementId: row.agreementId,
        dac: dac === "" ? "" : String(Number(dac.replace(/₹|,/g, ""))),
        ecs: ecs === "" ? "" : String(Number(ecs.replace(/₹|,/g, ""))),
        special: special === "" ? "" : String(Number(special.replace(/₹|,/g, ""))),
        paymentDate,
      });
    });

    if (!updates.length) {
      setBulkPasteMessage("No rows imported. " + errors.slice(0, 3).join(" · "));
      return;
    }

    setZeroAmounts((previous) => {
      const next = { ...previous };
      for (const update of updates) {
        const current = next[update.agreementId] ?? { dac: "", ecs: "", special: "" };
        next[update.agreementId] = {
          dac: update.dac === "" ? current.dac : update.dac,
          ecs: update.ecs === "" ? current.ecs : update.ecs,
          special: update.special === "" ? current.special : update.special,
        };
      }
      return next;
    });
    setZeroPaymentDates((previous) => {
      const next = { ...previous };
      for (const update of updates) {
        if (update.paymentDate) next[update.agreementId] = update.paymentDate;
      }
      return next;
    });
    setBulkPasteMessage(
      `${updates.length} loan row(s) imported.` +
        (errors.length ? ` ${errors.length} skipped: ${errors.slice(0, 3).join(" · ")}` : ""),
    );
  }

  async function applyZeroAmounts() {
    const changes = eligibleZeroRows.flatMap((row) => {
      const values = zeroAmounts[row.agreementId] ?? { dac: "", ecs: "", special: "" };
      const dac = Number(values.dac || 0);
      const ecs = Number(values.ecs || 0);
      const special = Number(values.special || 0);
      if (
        ![dac, ecs, special].every((value) => Number.isFinite(value) && value >= 0) ||
        dac + ecs + special <= 0 ||
        !row.master
      ) {
        return [];
      }
      return [
        {
          row: row.master.row,
          agreementId: row.agreementId,
          dac,
          ecs,
          special,
          paymentDate:
            zeroPaymentDates[row.agreementId] || row.resolvedPaymentDate || defaultPaymentDate,
        },
      ];
    });
    if (changes.length) {
      await onApplyZeroAmount(changes);
      setZeroAmounts({});
    }
  }

  const activeSheet = useMemo(() => sheets.find((s) => s.name === sheetName), [sheets, sheetName]);
  const mappingValidation = useMemo(() => isMappingValid(mapping), [mapping]);
  const samplePreview = useMemo(
    () => computeSamplePreview(activeSheet?.sampleRows ?? [], mapping, 5, defaultPaymentDate),
    [activeSheet, mapping, defaultPaymentDate],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reconciledRows.filter((row) => {
      if (q) {
        const matchId = row.agreementId.toLowerCase().includes(q);
        const matchCust = (row.master?.customer ?? "").toLowerCase().includes(q);
        const matchExec = (row.master?.executive ?? "").toLowerCase().includes(q);
        if (!matchId && !matchCust && !matchExec) return false;
      }
      switch (reviewTab) {
        case "all_changes":
          return row.action !== "unchanged" && row.action !== "unmatched";
        case "clean_updates":
          return row.action === "clean_update" || row.action === "provisional_confirmed";
        case "conflicts":
          return row.action === "protected_conflict" || row.action === "conflict_provisional";
        case "master_higher":
          return row.action === "master_higher";
        case "protected":
          return row.protectedSkip;
        case "unchanged":
          return row.action === "unchanged";
        case "unmatched":
          return row.action === "unmatched";
        case "zero_amount":
          return false;
      }
    });
  }, [reconciledRows, reviewTab, search]);

  const filteredZeroRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return zeroAmountRows;
    return zeroAmountRows.filter((row) => {
      const matchId = row.agreementId.toLowerCase().includes(q);
      const matchCust = (row.master?.customer ?? "").toLowerCase().includes(q);
      const matchExec = (row.master?.executive ?? "").toLowerCase().includes(q);
      return matchId || matchCust || matchExec;
    });
  }, [zeroAmountRows, search]);

  const allChangesCount =
    summary.matchedUpdates +
    summary.totalConflictsFlagged +
    summary.masterHigherCount +
    summary.protectedMatches;
  const commitCount = summary.matchedUpdates + summary.totalConflictsFlagged;

  function setDacMode(mode: DacMode) {
    onMappingChange({ ...mapping, dacMode: mode });
  }

  const filterTabs: Array<{ id: ReviewTab; label: string; count: number }> = [
    { id: "all_changes", label: "Priority View", count: allChangesCount },
    { id: "clean_updates", label: "Remaining < 0", count: summary.matchedUpdates },
    { id: "conflicts", label: "Conflicts", count: summary.totalConflictsFlagged },
    { id: "master_higher", label: "Master Higher", count: summary.masterHigherCount },
    { id: "protected", label: "Protected", count: summary.protectedSkips },
    { id: "unchanged", label: "Matched", count: summary.unchangedCount },
    { id: "unmatched", label: "Unmatched", count: summary.unmatchedCount },
    { id: "zero_amount", label: "Zero Amount", count: zeroAmountRows.length },
  ];

  function exportSummaryCsv() {
    downloadCsv(
      "paid-file-reconciliation-summary.csv",
      toCsv(
        [
          "Agreement ID",
          "Customer",
          "Executive",
          "Master Source",
          "Action",
          "Master Total",
          "Paid File DAC",
          "Paid File Total",
          "Remaining (Master - Paid)",
          "Delta DAC",
          "Target DAC",
          "Target ECS",
          "Target Special",
          "Payment Date",
          "New Total",
          "Reason",
        ],
        reconciledRows.map((r) => [
          r.agreementId,
          r.master?.customer ?? "",
          r.master?.executive ?? "",
          r.master?.dacSource ?? "",
          r.action,
          r.master ? r.currentMasterTotal : "",
          r.paidFileDac,
          r.paidFileTotal,
          r.master ? r.remaining : "",
          r.deltaDac,
          r.dac,
          r.targetEcs,
          r.targetSpecial,
          r.resolvedPaymentDate,
          r.newTotal ?? "",
          r.reason,
        ]),
      ),
    );
  }

  function exportUnmatchedCsv() {
    downloadCsv(
      "paid-file-unmatched.csv",
      toCsv(
        [
          "Agreement ID",
          "SFDC",
          "Online",
          "Paid DAC",
          "ECS",
          "Special",
          "Paid Total",
          "Payment Date",
          "Rows",
        ],
        reconciledRows
          .filter((r) => r.action === "unmatched")
          .map((r) => [
            r.agreementId,
            r.sfdc,
            r.online,
            r.paidFileDac,
            r.ecs,
            r.special,
            r.paidFileTotal,
            r.resolvedPaymentDate,
            r.sourceRows,
          ]),
      ),
    );
  }

  return (
    <section
      aria-label="Paid file reconciliation workspace"
      className="overflow-hidden rounded-2xl border bg-card shadow-xs"
    >
      {/* Workspace Header Bar */}
      <div className="border-b bg-muted/20 px-4 py-3.5 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-primary" />
              <h2 className="truncate text-base font-bold tracking-tight text-foreground sm:text-lg">
                {step === "mapping"
                  ? "Step 2 · Map Columns & Check 5-Row Sample"
                  : "Step 3 · Review Differences & Commit to Master"}
              </h2>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {fileName}
              {sheetName ? ` · Sheet: ${sheetName}` : ""}
              {spreadsheetName ? ` · Target: ${spreadsheetName}` : ""}
            </p>
          </div>

          {/* Segmented Stage Switcher (touch friendly on mobile) */}
          <div className="grid grid-cols-2 gap-1 rounded-xl border bg-background p-1 sm:flex sm:shrink-0">
            <button
              type="button"
              onClick={() => onStepChange("mapping")}
              className={`min-h-10 rounded-lg px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                step === "mapping"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              A. Column Mapping
            </button>
            <button
              type="button"
              disabled={reconciledRows.length === 0 && step === "mapping"}
              onClick={() => {
                if (reconciledRows.length > 0) onStepChange("review");
              }}
              className={`min-h-10 rounded-lg px-3 text-xs font-semibold transition-colors whitespace-nowrap disabled:opacity-45 ${
                step === "review"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              B. Review Diff
            </button>
          </div>
        </div>

        {busy && (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                {progressLabel}
              </span>
              <span className="font-mono font-semibold tabular-nums text-muted-foreground">
                {progress}%
              </span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}
      </div>

      {/* Workspace Body */}
      <div className="p-4 sm:p-6">
        {step === "mapping" ? (
          <div className="space-y-5">
            {/* Formula Visual Guide */}
            <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3.5 py-3 text-xs leading-relaxed text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
              <p className="font-semibold">How Master Update Calculation Works</p>
              <p className="mt-1 text-emerald-900/90 dark:text-emerald-200/90">
                1. Paid DAC = <span className="font-semibold">SFDC + Online</span> (or single DAC)
                <span className="mx-1.5 text-emerald-600/70">·</span>
                2. Paid Total = <span className="font-semibold">DAC + ECS + Special</span>
                <span className="mx-1.5 text-emerald-600/70">·</span>
                3.{" "}
                <span className="font-mono font-semibold">
                  Remaining = Master Total − Paid Total
                </span>
                <span className="mx-1.5 text-emerald-600/70">·</span>
                Only <span className="font-semibold">negative Remaining</span> rows update
                Master&apos;s DAC, ECS, Special &amp; Payment Date.
              </p>
            </div>

            {/* Workbook Settings */}
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Worksheet
                </label>
                <select
                  className="h-11 w-full rounded-lg border bg-background px-3 text-sm font-medium md:h-10"
                  value={sheetName}
                  onChange={(e) => onSelectSheet(e.target.value)}
                >
                  <option value="">Select worksheet</option>
                  {sheets.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} ({s.rowCount.toLocaleString("en-IN")} rows)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Paid File DAC Mode
                </label>
                <div className="grid h-11 grid-cols-2 gap-1 rounded-lg border bg-muted p-1 md:h-10">
                  <button
                    type="button"
                    onClick={() => setDacMode("split_sfdc_online")}
                    className={
                      mapping.dacMode === "split_sfdc_online"
                        ? "rounded-md bg-background px-2 text-xs font-semibold text-foreground shadow-xs"
                        : "rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                    }
                  >
                    SFDC + Online
                  </button>
                  <button
                    type="button"
                    onClick={() => setDacMode("single_dac")}
                    className={
                      mapping.dacMode === "single_dac"
                        ? "rounded-md bg-background px-2 text-xs font-semibold text-foreground shadow-xs"
                        : "rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                    }
                  >
                    Single DAC Col
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Duplicate Loan IDs
                </label>
                <select
                  className="h-11 w-full rounded-lg border bg-background px-3 text-sm font-medium md:h-10"
                  value={duplicateStrategy}
                  onChange={(e) => onDuplicateStrategyChange(e.target.value as DuplicateStrategy)}
                >
                  <option value="last_wins">Last Row Wins</option>
                  <option value="sum">Sum Duplicate Rows</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Default Payment Date
                </label>
                <Input
                  type="date"
                  className="h-11 text-sm md:h-10"
                  value={defaultPaymentDate}
                  onChange={(e) => onDefaultPaymentDateChange(e.target.value)}
                />
              </div>
            </div>

            {/* Column Selectors */}
            <div className="rounded-xl border bg-muted/15 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">Column Mapping</h3>
                <span className="text-xs text-muted-foreground">
                  Auto-detected from {activeSheet?.name ?? "selected sheet"}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <MappingSelect
                  label="Agreement / Loan ID"
                  required
                  value={mapping.agreementId}
                  headers={activeSheet?.headers ?? []}
                  onChange={(val) => onMappingChange({ ...mapping, agreementId: val })}
                />

                {mapping.dacMode === "split_sfdc_online" ? (
                  <>
                    <MappingSelect
                      label="SFDC Amount"
                      value={mapping.sfdc}
                      headers={activeSheet?.headers ?? []}
                      onChange={(val) => onMappingChange({ ...mapping, sfdc: val })}
                    />
                    <MappingSelect
                      label="Online Amount"
                      value={mapping.online}
                      headers={activeSheet?.headers ?? []}
                      onChange={(val) => onMappingChange({ ...mapping, online: val })}
                    />
                  </>
                ) : (
                  <MappingSelect
                    label="Direct DAC / Paid Amount"
                    required
                    value={mapping.paidAmount}
                    headers={activeSheet?.headers ?? []}
                    onChange={(val) => onMappingChange({ ...mapping, paidAmount: val })}
                  />
                )}

                <MappingSelect
                  label="Paid File Total"
                  unsetLabel="Auto (DAC + ECS + Special)"
                  value={mapping.paidTotal}
                  headers={activeSheet?.headers ?? []}
                  onChange={(val) => onMappingChange({ ...mapping, paidTotal: val })}
                />

                <MappingSelect
                  label="ECS Amount"
                  value={mapping.ecs}
                  headers={activeSheet?.headers ?? []}
                  onChange={(val) => onMappingChange({ ...mapping, ecs: val })}
                />

                <MappingSelect
                  label="Special Amount"
                  value={mapping.special}
                  headers={activeSheet?.headers ?? []}
                  onChange={(val) => onMappingChange({ ...mapping, special: val })}
                />

                <MappingSelect
                  label="Payment Date"
                  unsetLabel={`Use Default (${defaultPaymentDate || "Today"})`}
                  value={mapping.paymentDate}
                  headers={activeSheet?.headers ?? []}
                  onChange={(val) => onMappingChange({ ...mapping, paymentDate: val })}
                />
              </div>

              {!mappingValidation.valid && (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-medium text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  {mappingValidation.message}
                </p>
              )}
            </div>

            {/* Live 5-Row Sample Computation Preview (Desktop Table + Android Cards) */}
            <div className="rounded-xl border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                <h3 className="text-sm font-semibold text-foreground">5-Row Sample Preview</h3>
                <span className="text-xs text-muted-foreground">
                  Verify values match your spreadsheet before analyzing
                </span>
              </div>

              {samplePreview.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  No non-empty sample rows found in the selected worksheet.
                </div>
              ) : (
                <>
                  {/* Android / Mobile Cards */}
                  <div className="divide-y md:hidden">
                    {samplePreview.map((row) => (
                      <div key={row.rowIndex} className="space-y-2 p-3.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 font-mono text-xs">
                            <span className="text-muted-foreground">#{row.rowIndex}</span>
                            <span className="font-bold text-foreground">{row.agreementId}</span>
                          </div>
                          <span
                            className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                              row.valid
                                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                                : "bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300"
                            }`}
                          >
                            {row.valid ? "Valid" : "Missing ID"}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-2.5 text-xs font-mono tabular-nums">
                          {mapping.dacMode === "split_sfdc_online" && (
                            <>
                              <div>
                                <div className="font-sans text-[10px] text-muted-foreground">
                                  SFDC
                                </div>
                                <div className="font-medium">{money(row.sfdc)}</div>
                              </div>
                              <div>
                                <div className="font-sans text-[10px] text-muted-foreground">
                                  Online
                                </div>
                                <div className="font-medium">{money(row.online)}</div>
                              </div>
                            </>
                          )}
                          <div>
                            <div className="font-sans text-[10px] text-muted-foreground">
                              Paid DAC
                            </div>
                            <div className="font-semibold text-foreground">{money(row.dac)}</div>
                          </div>
                          <div>
                            <div className="font-sans text-[10px] text-muted-foreground">ECS</div>
                            <div className="font-medium">{money(row.ecs)}</div>
                          </div>
                          <div>
                            <div className="font-sans text-[10px] text-muted-foreground">
                              Special
                            </div>
                            <div className="font-medium">{money(row.special)}</div>
                          </div>
                          <div>
                            <div className="font-sans text-[10px] text-muted-foreground">
                              Paid Total
                            </div>
                            <div className="font-bold text-primary">{money(row.paidTotal)}</div>
                          </div>
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-muted-foreground">
                          Payment Date: {row.paymentDate}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop Table */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b bg-muted/40 text-[11px] uppercase text-muted-foreground">
                        <tr>
                          <th className="px-3.5 py-2.5">Row</th>
                          <th className="px-3.5 py-2.5">Agreement ID</th>
                          {mapping.dacMode === "split_sfdc_online" && (
                            <>
                              <th className="px-3.5 py-2.5 text-right">SFDC</th>
                              <th className="px-3.5 py-2.5 text-right">Online</th>
                            </>
                          )}
                          <th className="px-3.5 py-2.5 text-right">Paid DAC</th>
                          <th className="px-3.5 py-2.5 text-right">ECS</th>
                          <th className="px-3.5 py-2.5 text-right">Special</th>
                          <th className="px-3.5 py-2.5 text-right">Paid Total</th>
                          <th className="px-3.5 py-2.5">Payment Date</th>
                          <th className="px-3.5 py-2.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {samplePreview.map((row) => (
                          <tr key={row.rowIndex} className="h-10 hover:bg-muted/20">
                            <td className="px-3.5 py-2 font-mono tabular-nums text-muted-foreground">
                              #{row.rowIndex}
                            </td>
                            <td className="px-3.5 py-2 font-mono font-semibold tabular-nums">
                              {row.agreementId}
                            </td>
                            {mapping.dacMode === "split_sfdc_online" && (
                              <>
                                <td className="px-3.5 py-2 text-right font-mono tabular-nums">
                                  {money(row.sfdc)}
                                </td>
                                <td className="px-3.5 py-2 text-right font-mono tabular-nums">
                                  {money(row.online)}
                                </td>
                              </>
                            )}
                            <td className="px-3.5 py-2 text-right font-mono font-semibold tabular-nums">
                              {money(row.dac)}
                            </td>
                            <td className="px-3.5 py-2 text-right font-mono tabular-nums">
                              {money(row.ecs)}
                            </td>
                            <td className="px-3.5 py-2 text-right font-mono tabular-nums">
                              {money(row.special)}
                            </td>
                            <td className="px-3.5 py-2 text-right font-mono font-bold tabular-nums text-primary">
                              {money(row.paidTotal)}
                            </td>
                            <td className="px-3.5 py-2 font-mono tabular-nums text-muted-foreground">
                              {row.paymentDate}
                            </td>
                            <td className="px-3.5 py-2">
                              <span
                                className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${
                                  row.valid
                                    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                                    : "bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300"
                                }`}
                              >
                                {row.valid ? "Valid" : "Missing ID"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {!masterFound && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                <span>
                  Master Allocation spreadsheet is not connected yet — showing parsed Paid File
                  preview only. Connect Master Allocation to compare &amp; commit.
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-10 shrink-0 whitespace-nowrap"
                  onClick={onRefreshMaster}
                >
                  Retry Master Check
                </Button>
              </div>
            )}

            {/* 4-Metric Reconciliation Summary Strip */}
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3">
              <MetricCard
                icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                label="To Update (Remaining < 0)"
                value={summary.matchedUpdates.toLocaleString("en-IN")}
                sub={`Add ${signedMoney(summary.totalNetDifference)} to Master`}
                tone="emerald"
              />
              <MetricCard
                icon={<AlertTriangle className="h-4 w-4 text-red-600" />}
                label="Conflicts Flagged"
                value={summary.totalConflictsFlagged.toLocaleString("en-IN")}
                sub={`${summary.protectedConflicts} protected · ${summary.conflictProvisional} provisional`}
                tone="red"
              />
              <MetricCard
                icon={<Lock className="h-4 w-4 text-amber-600" />}
                label="Protected Skips"
                value={summary.protectedSkips.toLocaleString("en-IN")}
                sub={`${summary.protectedMatches} match · ${summary.protectedConflicts} conflict`}
                tone="amber"
              />
              <MetricCard
                icon={<SkipForward className="h-4 w-4 text-muted-foreground" />}
                label="No Update Needed"
                value={(
                  summary.unchangedCount +
                  summary.masterHigherCount +
                  summary.unmatchedCount
                ).toLocaleString("en-IN")}
                sub={`${summary.unchangedCount} matched · ${summary.masterHigherCount} higher · ${summary.unmatchedCount} unmatched`}
                tone="neutral"
              />
            </div>

            {/* Totals Breakdown + Export Buttons */}
            <div className="flex flex-col gap-3 rounded-xl border bg-muted/20 px-3.5 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs font-mono tabular-nums sm:flex sm:flex-wrap sm:items-center sm:gap-x-3">
                <span className="text-muted-foreground">
                  Rows:{" "}
                  <strong className="text-foreground">
                    {summary.totalParsedRows.toLocaleString("en-IN")}
                  </strong>
                </span>
                <span className="text-muted-foreground">
                  +DAC:{" "}
                  <strong className="text-emerald-700 dark:text-emerald-400">
                    {money(summary.totalUpdateDac)}
                  </strong>
                </span>
                <span className="text-muted-foreground">
                  +ECS: <strong className="text-foreground">{money(summary.totalUpdateEcs)}</strong>
                </span>
                <span className="text-muted-foreground">
                  +Special:{" "}
                  <strong className="text-foreground">{money(summary.totalUpdateSpecial)}</strong>
                </span>
                <span className="col-span-2 text-muted-foreground sm:col-span-1">
                  Paid File Total:{" "}
                  <strong className="text-foreground">{money(summary.totalIncomingDac)}</strong>
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-10 flex-1 whitespace-nowrap sm:min-h-8 sm:flex-initial"
                  onClick={exportSummaryCsv}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Summary CSV
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-10 flex-1 whitespace-nowrap sm:min-h-8 sm:flex-initial"
                  disabled={summary.unmatchedCount === 0}
                  onClick={exportUnmatchedCsv}
                >
                  Unmatched CSV ({summary.unmatchedCount})
                </Button>
              </div>
            </div>

            {/* Prominent Ready-to-Commit Action Banner (Visible immediately before scrolling 500 rows) */}
            {reviewTab !== "zero_amount" && (
              <div
                className={`flex flex-col gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-center sm:justify-between ${
                  applied
                    ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30"
                    : "border-primary/25 bg-primary/5"
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {applied
                      ? "Changes Committed to Master Allocation"
                      : commitCount > 0
                        ? `${commitCount.toLocaleString("en-IN")} account(s) ready to commit (+${money(summary.totalNetDifference)})`
                        : "No updates or conflicts pending commit"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {applied
                      ? "Master sheet and SHA-256 audit log are up to date."
                      : "Review or adjust DAC below, then commit atomically to Master Allocation."}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="min-h-11 w-full shrink-0 whitespace-nowrap sm:min-h-10 sm:w-auto sm:px-5"
                  disabled={busy || !masterFound || commitCount === 0 || applied}
                  onClick={() => void onCommit()}
                >
                  {busy ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      Committing…
                    </>
                  ) : applied ? (
                    <>
                      <ShieldCheck className="mr-1.5 h-4 w-4" />
                      Committed to Master
                    </>
                  ) : (
                    `Commit to Master (${commitCount.toLocaleString("en-IN")})`
                  )}
                </Button>
              </div>
            )}

            {/* Filter Tabs (Horizontally scrollable single row on mobile) + Search */}
            <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
              <div
                role="tablist"
                aria-label="Reconciliation categories"
                className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1"
              >
                {filterTabs.map((tab) => {
                  const active = reviewTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setReviewTab(tab.id)}
                      className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold whitespace-nowrap transition-colors md:min-h-9 ${
                        active
                          ? "border-primary bg-primary text-primary-foreground shadow-xs"
                          : "border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span
                        className={`font-mono tabular-nums text-[11px] ${
                          active ? "text-primary-foreground/90" : "text-muted-foreground"
                        }`}
                      >
                        ({tab.count.toLocaleString("en-IN")})
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="relative w-full lg:w-72 lg:shrink-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search Agreement ID, Customer, Exec…"
                  className="h-11 pl-9 pr-9 text-sm md:h-9 md:text-xs"
                />
                {search && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* ZERO AMOUNT REVIEW SECTION */}
            {reviewTab === "zero_amount" ? (
              <section className="space-y-4 rounded-xl border bg-card p-3.5 sm:p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">
                      Paid File Zero Amount Review
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Rows with ₹0 in DAC, ECS &amp; Special from this Paid File. Add manual amounts
                      here without altering standard reconciliation.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-10 shrink-0 whitespace-nowrap sm:min-h-8"
                    onClick={() => setBulkPasteOpen((open) => !open)}
                  >
                    <ClipboardPaste className="mr-1.5 h-3.5 w-3.5" />
                    {bulkPasteOpen ? "Hide Excel Bulk Paste" : "Excel Bulk Paste"}
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <div className="rounded-lg border bg-muted/30 p-2.5">
                    <p className="text-[11px] text-muted-foreground">Zero rows found</p>
                    <p className="mt-0.5 font-mono text-lg font-bold tabular-nums">
                      {zeroAmountRows.length}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-2.5">
                    <p className="text-[11px] text-muted-foreground">Master matched</p>
                    <p className="mt-0.5 font-mono text-lg font-bold tabular-nums">
                      {zeroAmountRows.filter((row) => row.master).length}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-2.5">
                    <p className="text-[11px] text-muted-foreground">Protected / unmatched</p>
                    <p className="mt-0.5 font-mono text-lg font-bold tabular-nums">
                      {zeroAmountRows.length - eligibleZeroRows.length}
                    </p>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2.5 dark:border-emerald-900 dark:bg-emerald-950/20">
                    <p className="text-[11px] text-emerald-800 dark:text-emerald-300">
                      Ready to apply
                    </p>
                    <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                      {zeroReadyCount}
                    </p>
                  </div>
                </div>

                {bulkPasteOpen && (
                  <div className="space-y-2.5 rounded-xl border bg-muted/20 p-3.5">
                    <div>
                      <h4 className="text-xs font-semibold text-foreground">
                        Bulk Paste — Individual Loan Amounts
                      </h4>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Paste copied Excel rows with{" "}
                        <span className="font-mono">
                          Loan Number, DAC, ECS, Special, Payment Date
                        </span>
                        . Empty cells keep existing values untouched.
                      </p>
                    </div>
                    <textarea
                      aria-label="Paste individual loan amounts"
                      className="min-h-28 w-full rounded-lg border bg-background p-2.5 font-mono text-xs"
                      placeholder={"LN001\t500\t0\t0\t2026-11-13\nLN002\t0\t750\t0\t2026-11-13"}
                      value={bulkPasteText}
                      onChange={(event) => {
                        setBulkPasteText(event.target.value);
                        setBulkPasteMessage("");
                      }}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="min-h-10"
                        onClick={applyBulkPaste}
                        disabled={!bulkPasteText.trim()}
                      >
                        Import Pasted Rows
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="min-h-10"
                        onClick={() => {
                          setBulkPasteText("");
                          setBulkPasteMessage("");
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                    {bulkPasteMessage && (
                      <p role="status" className="text-xs font-medium text-foreground">
                        {bulkPasteMessage}
                      </p>
                    )}
                  </div>
                )}

                {filteredZeroRows.length === 0 ? (
                  <div className="rounded-xl border px-4 py-8 text-center text-xs text-muted-foreground">
                    {zeroAmountRows.length === 0
                      ? "No zero-amount rows found in this Paid File."
                      : "No zero-amount rows match your search."}
                  </div>
                ) : (
                  <>
                    {/* Android / Mobile Cards for Zero Amount Review */}
                    <div className="space-y-3 md:hidden">
                      {filteredZeroRows.slice(0, 300).map((row) => {
                        const values = zeroAmounts[row.agreementId] ?? {
                          dac: "",
                          ecs: "",
                          special: "",
                        };
                        const disabled = !row.master || !eligibleZeroRows.includes(row);
                        const update = (key: "dac" | "ecs" | "special", value: string) =>
                          setZeroAmounts((prev) => ({
                            ...prev,
                            [row.agreementId]: {
                              ...(prev[row.agreementId] ?? { dac: "", ecs: "", special: "" }),
                              [key]: value,
                            },
                          }));

                        return (
                          <div key={row.agreementId} className="space-y-3 rounded-xl border p-3.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-mono text-sm font-bold tabular-nums text-foreground">
                                  {row.agreementId}
                                </p>
                                {row.master?.customer && (
                                  <p className="truncate text-xs text-muted-foreground">
                                    {row.master.customer}
                                  </p>
                                )}
                              </div>
                              <div className="text-right text-xs">
                                <span
                                  className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                                    !row.master || disabled
                                      ? "bg-muted text-muted-foreground"
                                      : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                                  }`}
                                >
                                  {!row.master
                                    ? "Unmatched"
                                    : disabled
                                      ? "Protected / Conflict"
                                      : `Row ${row.master.row}`}
                                </span>
                                <p className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                                  Existing DAC: {money(row.master?.existingDac ?? 0)}
                                </p>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2.5">
                              {(
                                [
                                  { key: "dac", label: "Manual DAC (₹)" },
                                  { key: "ecs", label: "Manual ECS (₹)" },
                                  { key: "special", label: "Manual Special (₹)" },
                                ] as const
                              ).map(({ key, label }) => (
                                <div key={key}>
                                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                                    {label}
                                  </label>
                                  <Input
                                    aria-label={`Manual ${key} for ${row.agreementId}`}
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    step="0.01"
                                    className="h-11 font-mono text-sm tabular-nums"
                                    value={values[key]}
                                    disabled={disabled}
                                    onChange={(event) => update(key, event.target.value)}
                                  />
                                </div>
                              ))}
                              <div>
                                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                                  Payment Date
                                </label>
                                <Input
                                  aria-label={`Payment date for ${row.agreementId}`}
                                  type="date"
                                  className="h-11 font-mono text-xs tabular-nums"
                                  value={
                                    zeroPaymentDates[row.agreementId] ??
                                    row.resolvedPaymentDate ??
                                    defaultPaymentDate
                                  }
                                  disabled={disabled}
                                  onChange={(event) =>
                                    setZeroPaymentDates((previous) => ({
                                      ...previous,
                                      [row.agreementId]: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Desktop Table for Zero Amount Review */}
                    <div className="hidden overflow-x-auto rounded-xl border md:block">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b bg-muted/50 text-[11px] uppercase text-muted-foreground">
                          <tr>
                            <th className="p-3">Loan Number</th>
                            <th className="p-3">Master Match</th>
                            <th className="p-3 text-right">Existing DAC</th>
                            <th className="p-3">Manual DAC</th>
                            <th className="p-3">Manual ECS</th>
                            <th className="p-3">Manual Special</th>
                            <th className="p-3">Payment Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {filteredZeroRows.slice(0, 300).map((row) => {
                            const values = zeroAmounts[row.agreementId] ?? {
                              dac: "",
                              ecs: "",
                              special: "",
                            };
                            const disabled = !row.master || !eligibleZeroRows.includes(row);
                            const update = (key: "dac" | "ecs" | "special", value: string) =>
                              setZeroAmounts((prev) => ({
                                ...prev,
                                [row.agreementId]: {
                                  ...(prev[row.agreementId] ?? { dac: "", ecs: "", special: "" }),
                                  [key]: value,
                                },
                              }));
                            return (
                              <tr key={row.agreementId} className="hover:bg-muted/20">
                                <td className="p-2.5 font-mono font-semibold tabular-nums">
                                  {row.agreementId}
                                </td>
                                <td className="p-2.5">
                                  {!row.master
                                    ? "Unmatched"
                                    : disabled
                                      ? "Protected / conflict"
                                      : `Matched · row ${row.master.row}`}
                                </td>
                                <td className="p-2.5 text-right font-mono tabular-nums">
                                  {money(row.master?.existingDac ?? 0)}
                                </td>
                                {(["dac", "ecs", "special"] as const).map((key) => (
                                  <td className="p-2" key={key}>
                                    <Input
                                      aria-label={`Manual ${key} for ${row.agreementId}`}
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      className="h-9 w-28 font-mono tabular-nums"
                                      value={values[key]}
                                      disabled={disabled}
                                      onChange={(event) => update(key, event.target.value)}
                                    />
                                  </td>
                                ))}
                                <td className="p-2">
                                  <Input
                                    aria-label={`Payment date for ${row.agreementId}`}
                                    type="date"
                                    className="h-9 w-36 font-mono tabular-nums"
                                    value={
                                      zeroPaymentDates[row.agreementId] ??
                                      row.resolvedPaymentDate ??
                                      defaultPaymentDate
                                    }
                                    disabled={disabled}
                                    onChange={(event) =>
                                      setZeroPaymentDates((previous) => ({
                                        ...previous,
                                        [row.agreementId]: event.target.value,
                                      }))
                                    }
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                <div className="flex flex-col gap-3 border-t pt-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground">
                    Manual additions are additive, Admin-only, and audit-logged separately.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="min-h-11 w-full whitespace-nowrap sm:min-h-10 sm:w-auto"
                    disabled={busy || zeroReadyCount === 0}
                    onClick={() => void applyZeroAmounts()}
                  >
                    Validate &amp; Apply Manual Additions ({zeroReadyCount})
                  </Button>
                </div>
              </section>
            ) : (
              /* STANDARD DIFF REVIEW: MOBILE CARDS + DESKTOP TABLE */
              <>
                {filteredRows.length === 0 ? (
                  <div className="rounded-xl border bg-muted/10 px-4 py-10 text-center text-xs text-muted-foreground">
                    {reviewTab === "conflicts"
                      ? "No conflicts detected in this upload."
                      : reviewTab === "master_higher"
                        ? "No accounts have Master Total higher than Paid File Total."
                        : reviewTab === "protected"
                          ? "No protected Manual or Corrected records encountered."
                          : reviewTab === "unchanged"
                            ? "No already-matched identical records."
                            : reviewTab === "unmatched"
                              ? "All uploaded Agreement IDs matched Master Allocation."
                              : "No rows match the current filter."}
                  </div>
                ) : (
                  <>
                    {/* Android / Mobile Comparison Cards (Zero Horizontal Scroll!) */}
                    <div className="space-y-3 md:hidden">
                      {filteredRows.slice(0, 500).map((r) => {
                        const badge = actionMeta(r.action);
                        const isNegativeRemaining = r.remaining < -0.01;
                        const isPositiveRemaining = r.remaining > 0.01;
                        const isExpanded = expandedId === r.agreementId;

                        return (
                          <article
                            key={r.agreementId}
                            className="space-y-3 rounded-xl border bg-card p-3.5 shadow-2xs"
                          >
                            {/* Top Row: ID, Source & Status */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-mono text-sm font-bold tabular-nums text-foreground">
                                    {r.agreementId}
                                  </span>
                                  <span className="text-[11px] font-medium uppercase text-muted-foreground">
                                    ·{" "}
                                    {r.master
                                      ? r.master.dacSource ||
                                        (r.master.isCorrected ? "CORRECTED" : "MASTER")
                                      : "UNMATCHED"}
                                  </span>
                                </div>
                                {r.master?.customer && (
                                  <p className="mt-0.5 truncate text-xs font-medium text-foreground">
                                    {r.master.customer}
                                  </p>
                                )}
                                {r.master?.executive && (
                                  <p className="text-[11px] text-muted-foreground">
                                    {r.master.executive}
                                    {r.master.bucket ? ` · ${r.master.bucket}` : ""}
                                  </p>
                                )}
                              </div>
                              <span
                                className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${badge.cls}`}
                              >
                                <span className={`size-1.5 rounded-full ${badge.dotCls}`} />
                                {badge.label}
                              </span>
                            </div>

                            {/* 3-Box Financial Comparison: Master | Paid File | Remaining */}
                            <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-2.5 font-mono tabular-nums">
                              <div>
                                <div className="font-sans text-[10px] font-medium uppercase text-muted-foreground">
                                  Master
                                </div>
                                <div className="mt-0.5 text-xs font-bold text-foreground">
                                  {r.master ? money(r.currentMasterTotal) : "—"}
                                </div>
                              </div>
                              <div>
                                <div className="font-sans text-[10px] font-medium uppercase text-muted-foreground">
                                  Paid File
                                </div>
                                <div className="mt-0.5 text-xs font-bold text-foreground">
                                  {money(r.paidFileTotal)}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="font-sans text-[10px] font-medium uppercase text-muted-foreground">
                                  Remaining
                                </div>
                                <div
                                  className={`mt-0.5 text-xs font-bold ${
                                    isNegativeRemaining
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : isPositiveRemaining
                                        ? "text-amber-600 dark:text-amber-400"
                                        : "text-muted-foreground"
                                  }`}
                                >
                                  {r.master ? signedMoney(r.remaining) : "—"}
                                </div>
                              </div>
                            </div>

                            {/* Incoming Paid Breakdown & Master Update Values */}
                            <div className="space-y-2 rounded-lg bg-muted/20 p-2.5 text-xs">
                              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                                <span>
                                  Paid DAC:{" "}
                                  <strong className="text-foreground">
                                    {money(r.paidFileDac)}
                                  </strong>
                                  {r.sfdc > 0 || r.online > 0
                                    ? ` (${money(r.sfdc)}+${money(r.online)})`
                                    : ""}
                                </span>
                                {(r.ecs > 0 || r.special > 0) && (
                                  <span>
                                    ECS {money(r.ecs)} · Sp {money(r.special)}
                                  </span>
                                )}
                              </div>

                              {(r.hasDelta || (r.isEditable && !applied)) && (
                                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                                  <div className="min-w-0 font-mono text-[11px] tabular-nums">
                                    <span className="font-sans font-semibold text-foreground">
                                      Master Update:
                                    </span>{" "}
                                    <span className="text-muted-foreground">
                                      ECS {money(r.targetEcs)} · Sp {money(r.targetSpecial)}
                                      {r.resolvedPaymentDate ? ` · ${r.resolvedPaymentDate}` : ""}
                                    </span>
                                  </div>
                                  {r.isEditable && !applied ? (
                                    <div className="flex items-center gap-1.5">
                                      <label
                                        htmlFor={`mob-dac-${r.agreementId}`}
                                        className="text-[11px] font-medium text-muted-foreground"
                                      >
                                        DAC ₹
                                      </label>
                                      <input
                                        id={`mob-dac-${r.agreementId}`}
                                        aria-label={`Override DAC for ${r.agreementId}`}
                                        type="number"
                                        inputMode="decimal"
                                        step="0.01"
                                        className="h-10 w-24 rounded-md border bg-background px-2 text-right font-mono text-xs font-semibold tabular-nums"
                                        value={r.dac}
                                        onChange={(e) => {
                                          const val = Number(e.target.value);
                                          if (Number.isFinite(val))
                                            onOverrideDac(r.agreementId, val);
                                        }}
                                      />
                                    </div>
                                  ) : (
                                    <span className="font-mono text-xs font-bold tabular-nums text-foreground">
                                      DAC {money(r.dac)}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Reason + Multi-Row Inspection */}
                            <div className="flex flex-wrap items-start justify-between gap-2 text-xs text-muted-foreground">
                              <p className="min-w-0 flex-1 leading-relaxed">{r.reason}</p>
                              {r.sourceRows > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedId(isExpanded ? null : r.agreementId)}
                                  className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border bg-background px-2.5 text-[11px] font-semibold text-primary"
                                >
                                  {r.sourceRows} rows
                                  {isExpanded ? (
                                    <ChevronUp className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              )}
                            </div>

                            {isExpanded && (
                              <div className="space-y-1.5 rounded-lg border bg-muted/30 p-2.5 text-[11px]">
                                {r.transactions.map((tx, idx) => (
                                  <div
                                    key={`${tx.row}-${idx}`}
                                    className="flex items-center justify-between gap-2 font-mono tabular-nums"
                                  >
                                    <span className="text-muted-foreground">Row {tx.row}</span>
                                    <span>
                                      SFDC {money(tx.sfdc)} · Onl {money(tx.online)} · Tot{" "}
                                      {money(tx.paidTotal)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>

                    {/* Desktop High-Density Table */}
                    <div className="hidden overflow-x-auto rounded-xl border md:block">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b bg-muted/50 text-[11px] uppercase text-muted-foreground">
                          <tr>
                            <th className="px-3.5 py-2.5">Agreement ID &amp; Customer</th>
                            <th className="px-3.5 py-2.5 text-right">Master Total</th>
                            <th className="px-3.5 py-2.5 text-right">Paid File Total</th>
                            <th className="px-3.5 py-2.5 text-right">Remaining (Master − Paid)</th>
                            <th className="px-3.5 py-2.5 text-right">
                              Master Update (DAC · ECS · Sp · Date)
                            </th>
                            <th className="px-3.5 py-2.5">Status &amp; Reason</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {filteredRows.slice(0, 500).map((r) => {
                            const badge = actionMeta(r.action);
                            const isNegativeRemaining = r.remaining < -0.01;
                            const isPositiveRemaining = r.remaining > 0.01;
                            const isExpanded = expandedId === r.agreementId;

                            return (
                              <tr key={r.agreementId} className="hover:bg-muted/25">
                                <td className="px-3.5 py-2.5 align-top">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-mono font-bold tabular-nums text-foreground">
                                      {r.agreementId}
                                    </span>
                                    <span className="font-mono text-[10px] font-medium uppercase text-muted-foreground">
                                      ·{" "}
                                      {r.master
                                        ? r.master.dacSource ||
                                          (r.master.isCorrected ? "CORRECTED" : "MASTER")
                                        : "UNMATCHED"}
                                    </span>
                                  </div>
                                  {r.master?.customer && (
                                    <div className="mt-0.5 font-medium text-foreground">
                                      {r.master.customer}
                                    </div>
                                  )}
                                  {r.master?.executive && (
                                    <div className="text-[11px] text-muted-foreground">
                                      {r.master.executive}
                                      {r.master.bucket ? ` · ${r.master.bucket}` : ""}
                                    </div>
                                  )}
                                  {r.sourceRows > 1 && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedId(isExpanded ? null : r.agreementId)
                                      }
                                      className="mt-1 text-[11px] font-medium text-primary underline underline-offset-2"
                                    >
                                      {r.sourceRows} rows (
                                      {r.duplicatesReplaced > 0 ? "last wins" : "summed"}) ·{" "}
                                      {isExpanded ? "Hide" : "Inspect"}
                                    </button>
                                  )}
                                  {isExpanded && (
                                    <div className="mt-1.5 space-y-1 rounded-md border bg-muted/40 p-2 text-[11px]">
                                      {r.transactions.map((tx, idx) => (
                                        <div
                                          key={`${tx.row}-${idx}`}
                                          className="flex items-center justify-between gap-2 font-mono tabular-nums"
                                        >
                                          <span className="text-muted-foreground">
                                            Row {tx.row}
                                          </span>
                                          <span>
                                            SFDC {money(tx.sfdc)} · Onl {money(tx.online)} · Tot{" "}
                                            {money(tx.paidTotal)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </td>

                                <td className="px-3.5 py-2.5 text-right align-top font-mono tabular-nums">
                                  {r.master ? (
                                    <>
                                      <div className="font-semibold text-foreground">
                                        {money(r.currentMasterTotal)}
                                      </div>
                                      {(r.master.existingDac > 0 ||
                                        r.master.existingEcs > 0 ||
                                        r.master.existingSpecial > 0) && (
                                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                                          DAC {money(r.master.existingDac)} · ECS{" "}
                                          {money(r.master.existingEcs)} · Sp{" "}
                                          {money(r.master.existingSpecial)}
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    "—"
                                  )}
                                </td>

                                <td className="px-3.5 py-2.5 text-right align-top font-mono tabular-nums">
                                  <div className="font-semibold text-foreground">
                                    {money(r.paidFileTotal)}
                                  </div>
                                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                                    DAC {money(r.paidFileDac)}
                                    {r.sfdc > 0 || r.online > 0
                                      ? ` (${money(r.sfdc)}+${money(r.online)})`
                                      : ""}
                                  </div>
                                  {(r.ecs > 0 || r.special > 0) && (
                                    <div className="text-[10px] text-muted-foreground">
                                      ECS {money(r.ecs)} · Sp {money(r.special)}
                                    </div>
                                  )}
                                </td>

                                <td className="px-3.5 py-2.5 text-right align-top font-mono tabular-nums">
                                  <div
                                    className={`font-bold ${
                                      isNegativeRemaining
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : isPositiveRemaining
                                          ? "text-amber-600 dark:text-amber-400"
                                          : "text-muted-foreground"
                                    }`}
                                  >
                                    {r.master ? signedMoney(r.remaining) : "—"}
                                  </div>
                                  {isNegativeRemaining && (
                                    <div className="mt-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">
                                      Add +{money(r.difference)}
                                    </div>
                                  )}
                                </td>

                                <td className="px-3.5 py-2.5 text-right align-top font-mono tabular-nums">
                                  {r.isEditable && !applied ? (
                                    <div className="flex items-center justify-end gap-1.5">
                                      <span className="font-sans text-[10px] text-muted-foreground">
                                        DAC:
                                      </span>
                                      <input
                                        aria-label={`Override DAC for ${r.agreementId}`}
                                        type="number"
                                        step="0.01"
                                        className="h-7 w-24 rounded-md border bg-background px-2 text-right font-mono text-xs tabular-nums"
                                        value={r.dac}
                                        onChange={(e) => {
                                          const val = Number(e.target.value);
                                          if (Number.isFinite(val))
                                            onOverrideDac(r.agreementId, val);
                                        }}
                                      />
                                    </div>
                                  ) : (
                                    <div className="font-semibold">DAC {money(r.dac)}</div>
                                  )}
                                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                                    ECS {money(r.targetEcs)} · Sp {money(r.targetSpecial)}
                                  </div>
                                  {r.resolvedPaymentDate && (
                                    <div className="text-[10px] text-muted-foreground">
                                      Date: {r.resolvedPaymentDate}
                                    </div>
                                  )}
                                </td>

                                <td className="px-3.5 py-2.5 align-top">
                                  <span
                                    className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}
                                  >
                                    <span className={`size-1.5 rounded-full ${badge.dotCls}`} />
                                    {badge.label}
                                  </span>
                                  <div className="mt-1 max-w-[260px] text-[11px] leading-snug text-muted-foreground">
                                    {r.reason}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {filteredRows.length > 500 && (
                  <p className="text-xs text-muted-foreground">
                    Showing first 500 filtered records. Use Search to locate specific Agreement IDs.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Workspace Action Footer */}
      <div className="flex flex-col-reverse gap-2.5 border-t bg-muted/20 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          {step === "review" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 flex-1 whitespace-nowrap sm:min-h-9 sm:flex-initial"
              disabled={busy}
              onClick={() => onStepChange("mapping")}
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Edit Mapping
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 flex-1 whitespace-nowrap sm:min-h-9 sm:flex-initial"
            disabled={busy}
            onClick={onCancelSession}
          >
            Cancel &amp; Clear
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {step === "mapping" ? (
            <Button
              type="button"
              size="sm"
              className="min-h-11 w-full whitespace-nowrap sm:min-h-10 sm:w-auto sm:px-5"
              disabled={busy || !sheetName || !mappingValidation.valid}
              onClick={onAnalyze}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Analyzing…
                </>
              ) : (
                <>
                  Analyze Against Master Data
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </>
              )}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              className="min-h-11 w-full whitespace-nowrap sm:min-h-10 sm:w-auto sm:px-5"
              disabled={busy || !masterFound || commitCount === 0 || applied}
              onClick={() => void onCommit()}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Committing…
                </>
              ) : applied ? (
                <>
                  <ShieldCheck className="mr-1.5 h-4 w-4" />
                  Committed to Master Data
                </>
              ) : (
                `Commit to Master Data (${commitCount.toLocaleString("en-IN")})`
              )}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Dialog wrapper preserved for backwards compatibility with any external modal consumers.
 */
export function PaidFileReconciliationModal({ open, onOpenChange, ...props }: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[100dvh] w-screen max-w-none overflow-y-auto rounded-none border-0 p-0 sm:h-auto sm:max-h-[90dvh] sm:w-[96vw] sm:max-w-6xl sm:rounded-2xl sm:border">
        <DialogTitle className="sr-only">Paid File Reconciliation</DialogTitle>
        <DialogDescription className="sr-only">
          Column mapping, reconciliation diff review, and Master Allocation commit workspace.
        </DialogDescription>
        <PaidFileReconciliationWorkspace {...props} />
      </DialogContent>
    </Dialog>
  );
}

function MappingSelect({
  label,
  required,
  unsetLabel = "Not mapped",
  value,
  headers,
  onChange,
}: {
  label: string;
  required?: boolean;
  unsetLabel?: string;
  value: number;
  headers: string[];
  onChange: (value: number) => void;
}) {
  const mapped = value >= 0;
  return (
    <div className="min-w-0 rounded-lg border bg-background p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="text-xs font-semibold text-foreground">
          {label}
          {required ? <span className="ml-1 text-red-600">*</span> : null}
        </label>
        <span
          className={`text-[11px] font-medium ${
            mapped ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"
          }`}
        >
          {mapped ? "Mapped" : "Optional"}
        </span>
      </div>
      <select
        className="h-10 w-full min-w-0 rounded-md border bg-background px-2.5 text-xs font-medium"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        <option value={-1}>{unsetLabel}</option>
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `Column ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: "emerald" | "amber" | "red" | "neutral";
}) {
  const borderCls =
    tone === "emerald"
      ? "border-emerald-200 dark:border-emerald-900"
      : tone === "amber"
        ? "border-amber-200 dark:border-amber-900"
        : tone === "red"
          ? "border-red-200 dark:border-red-900"
          : "border-border";
  return (
    <div className={`rounded-xl border bg-card p-3 sm:p-3.5 ${borderCls}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold leading-tight text-muted-foreground">
          {label}
        </span>
        <span className="shrink-0">{icon}</span>
      </div>
      <p className="mt-1.5 font-mono text-xl font-bold tabular-nums text-foreground sm:text-2xl">
        {value}
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{sub}</p>
    </div>
  );
}
