import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Lock,
  Search,
  ShieldCheck,
  SkipForward,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  type ReconciliationMode,
  type ReconciliationSummary,
  type SheetInfo,
} from "@/lib/paid-file-reconciliation";

type ReviewTab =
  | "all_changes"
  | "clean_updates"
  | "conflicts"
  | "master_higher"
  | "protected"
  | "unchanged"
  | "unmatched";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
  reconciliationMode: ReconciliationMode;
  onReconciliationModeChange: (mode: ReconciliationMode) => void;
  onAnalyze: () => void;
  reconciledRows: ReconciledRow[];
  summary: ReconciliationSummary;
  onOverrideDac: (agreementId: string, dac: number) => void;
  onCommit: () => Promise<void>;
  onCancelSession: () => void;
  busy: boolean;
  applied: boolean;
  progress: number;
  progressLabel: string;
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

function actionBadge(action: ReconciliationAction) {
  switch (action) {
    case "clean_update":
      return {
        label: "Clean Update",
        cls: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
      };
    case "provisional_confirmed":
      return {
        label: "Provisional Confirmed",
        cls: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
      };
    case "protected_conflict":
      return {
        label: "Protected Conflict",
        cls: "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300",
      };
    case "conflict_provisional":
      return {
        label: "Conflict Flagged",
        cls: "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300",
      };
    case "master_higher":
      return {
        label: "Master Higher (Skipped)",
        cls: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
      };
    case "protected_match":
      return {
        label: "Protected Skip",
        cls: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
      };
    case "unchanged":
      return {
        label: "Already Matched",
        cls: "border-border bg-muted text-muted-foreground",
      };
    case "unmatched":
      return {
        label: "Skipped (Unmatched)",
        cls: "border-border bg-muted/70 text-muted-foreground",
      };
  }
}

export function PaidFileReconciliationModal({
  open,
  onOpenChange,
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
  reconciliationMode,
  onReconciliationModeChange,
  onAnalyze,
  reconciledRows,
  summary,
  onOverrideDac,
  onCommit,
  onCancelSession,
  busy,
  applied,
  progress,
  progressLabel,
}: Props) {
  const [reviewTab, setReviewTab] = useState<ReviewTab>("all_changes");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const activeSheet = useMemo(() => sheets.find((s) => s.name === sheetName), [sheets, sheetName]);

  const mappingValidation = useMemo(() => isMappingValid(mapping), [mapping]);

  const samplePreview = useMemo(
    () => computeSamplePreview(activeSheet?.sampleRows ?? [], mapping, 5),
    [activeSheet, mapping],
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
      }
    });
  }, [reconciledRows, reviewTab, search]);

  const allChangesCount =
    summary.matchedUpdates +
    summary.totalConflictsFlagged +
    summary.masterHigherCount +
    summary.protectedMatches;
  const commitCount = summary.matchedUpdates + summary.totalConflictsFlagged;

  function setDacMode(mode: DacMode) {
    onMappingChange({ ...mapping, dacMode: mode });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] w-[96vw] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-3.5 py-2.5 sm:px-5 sm:py-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pr-7">
            <div>
              <DialogTitle className="flex items-center gap-2 text-base font-bold tracking-tight sm:text-lg">
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-primary sm:h-5 sm:w-5" />
                <span>
                  {step === "mapping"
                    ? "Step 2 · Interactive Column Mapping"
                    : "Step 3 · Pre-Merge Reconciliation Review"}
                </span>
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-[11px] sm:text-xs">
                {fileName}
                {spreadsheetName ? ` · Target: ${spreadsheetName}` : ""}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-medium sm:text-xs">
              <span
                className={
                  step === "mapping"
                    ? "rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-primary sm:px-2.5 sm:py-1"
                    : "rounded border px-2 py-0.5 text-muted-foreground sm:px-2.5 sm:py-1"
                }
              >
                A. Column Mapping
              </span>
              <span className="text-muted-foreground">→</span>
              <span
                className={
                  step === "review"
                    ? "rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-primary sm:px-2.5 sm:py-1"
                    : "rounded border px-2 py-0.5 text-muted-foreground sm:px-2.5 sm:py-1"
                }
              >
                B. Reconciliation Diff
              </span>
            </div>
          </div>
          {busy && (
            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {progressLabel}
                </span>
                <span className="font-mono tabular-nums text-muted-foreground">{progress}%</span>
              </div>
              <Progress value={progress} className="h-1.5" />
            </div>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3 sm:px-5 sm:py-4">
          {step === "mapping" ? (
            <div className="space-y-4">
              {/* Worksheet + DAC Mode + Duplicate Strategy + Reconciliation Mode */}
              <div className="grid gap-3 rounded-lg border bg-card p-3.5 md:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Worksheet
                  </label>
                  <select
                    className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
                    value={sheetName}
                    onChange={(e) => onSelectSheet(e.target.value)}
                  >
                    <option value="">Select sheet</option>
                    {sheets.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name} ({s.rowCount.toLocaleString("en-IN")} rows)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    DAC Calculation Mode
                  </label>
                  <div className="grid grid-cols-2 gap-1 rounded-md border bg-muted p-1">
                    <button
                      type="button"
                      onClick={() => setDacMode("split_sfdc_online")}
                      className={
                        mapping.dacMode === "split_sfdc_online"
                          ? "rounded bg-background px-2 py-1 text-xs font-semibold text-foreground shadow-sm"
                          : "rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                      }
                    >
                      SFDC + Online
                    </button>
                    <button
                      type="button"
                      onClick={() => setDacMode("single_dac")}
                      className={
                        mapping.dacMode === "single_dac"
                          ? "rounded bg-background px-2 py-1 text-xs font-semibold text-foreground shadow-sm"
                          : "rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                      }
                    >
                      Single DAC Col
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Duplicate Agreement IDs
                  </label>
                  <select
                    className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
                    value={duplicateStrategy}
                    onChange={(e) => onDuplicateStrategyChange(e.target.value as DuplicateStrategy)}
                  >
                    <option value="last_wins">Last Occurrence Wins (Recommended)</option>
                    <option value="sum">Sum Duplicate Rows</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Master Total Comparison
                  </label>
                  <select
                    className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
                    value={reconciliationMode}
                    onChange={(e) =>
                      onReconciliationModeChange(e.target.value as ReconciliationMode)
                    }
                  >
                    <option value="difference">Difference Only (Paid File − Master)</option>
                    <option value="additive">Additive (Add Full Amount On Top)</option>
                  </select>
                </div>
              </div>

              <div className="rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                {reconciliationMode === "difference" ? (
                  <>
                    <strong>Difference Mode Active:</strong> Compares{" "}
                    <span className="font-semibold">Paid File Total</span> against{" "}
                    <span className="font-semibold">Master Total</span>. Only accounts with a
                    positive new payment difference are updated; already-matched accounts and higher
                    Master totals are skipped automatically.
                  </>
                ) : (
                  <>
                    <strong>Additive Mode Active:</strong> Adds the full Paid File DAC directly on
                    top of existing Master Total without subtracting prior collection.
                  </>
                )}
              </div>

              {/* Column Selectors */}
              <div className="rounded-lg border bg-card p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    Column Mapping Overrides
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    Auto-detected headers from {activeSheet?.name ?? "sheet"}
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
                    label="ECS Amount (Optional)"
                    value={mapping.ecs}
                    headers={activeSheet?.headers ?? []}
                    onChange={(val) => onMappingChange({ ...mapping, ecs: val })}
                  />
                  <MappingSelect
                    label="Special Amount (Optional)"
                    value={mapping.special}
                    headers={activeSheet?.headers ?? []}
                    onChange={(val) => onMappingChange({ ...mapping, special: val })}
                  />
                </div>

                {!mappingValidation.valid && (
                  <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                    {mappingValidation.message}
                  </p>
                )}
              </div>

              {/* Live 5-Row Sample Computation Preview */}
              <div className="rounded-lg border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
                  <h3 className="text-sm font-semibold text-foreground">
                    Live Sample Computation Preview (First 5 Rows)
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    Updates immediately when column mapping changes
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b bg-muted/50 text-[11px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Sample #</th>
                        <th className="px-3 py-2">Agreement ID</th>
                        {mapping.dacMode === "split_sfdc_online" && (
                          <>
                            <th className="px-3 py-2 text-right">SFDC</th>
                            <th className="px-3 py-2 text-right">Online</th>
                          </>
                        )}
                        <th className="px-3 py-2 text-right">Paid File Total</th>
                        <th className="px-3 py-2 text-right">ECS</th>
                        <th className="px-3 py-2 text-right">Special</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {samplePreview.length === 0 ? (
                        <tr>
                          <td
                            colSpan={mapping.dacMode === "split_sfdc_online" ? 8 : 6}
                            className="px-3 py-6 text-center text-muted-foreground"
                          >
                            No non-empty sample rows found in the selected worksheet.
                          </td>
                        </tr>
                      ) : (
                        samplePreview.map((row) => (
                          <tr key={row.rowIndex} className="h-9">
                            <td className="px-3 py-1.5 font-mono tabular-nums text-muted-foreground">
                              #{row.rowIndex}
                            </td>
                            <td className="px-3 py-1.5 font-mono font-semibold tabular-nums">
                              {row.agreementId}
                            </td>
                            {mapping.dacMode === "split_sfdc_online" && (
                              <>
                                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                                  {money(row.sfdc)}
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                                  {money(row.online)}
                                </td>
                              </>
                            )}
                            <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                              {money(row.dac)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                              {money(row.ecs)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                              {money(row.special)}
                            </td>
                            <td className="px-3 py-1.5">
                              <span
                                className={
                                  row.valid
                                    ? "rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800"
                                    : "rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-800"
                                }
                              >
                                {row.valid ? "Valid" : "Invalid / Missing ID"}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3.5">
              {!masterFound && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                  <span>
                    Master Allocation spreadsheet is not connected yet — showing parsed Paid File
                    preview only. Connect or initialize Master Allocation to match & commit.
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={onRefreshMaster}
                  >
                    Retry Master Check
                  </Button>
                </div>
              )}

              {/* Four-Metric Reconciliation Strip */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
                <MetricCard
                  icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                  label="Updated Accounts"
                  value={summary.matchedUpdates.toLocaleString("en-IN")}
                  sub={`Net Diff ${signedMoney(summary.totalNetDifference)}`}
                  tone="emerald"
                />
                <MetricCard
                  icon={<Lock className="h-4 w-4 text-amber-600" />}
                  label="Protected (Manual / Corrected)"
                  value={summary.protectedSkips.toLocaleString("en-IN")}
                  sub={`${summary.protectedMatches} matched · ${summary.protectedConflicts} conflict`}
                  tone="amber"
                />
                <MetricCard
                  icon={<AlertTriangle className="h-4 w-4 text-red-600" />}
                  label="Conflicts Flagged"
                  value={summary.totalConflictsFlagged.toLocaleString("en-IN")}
                  sub={`${summary.protectedConflicts} protected · ${summary.conflictProvisional} provisional`}
                  tone="red"
                />
                <MetricCard
                  icon={<SkipForward className="h-4 w-4 text-muted-foreground" />}
                  label="Already Matched / Higher"
                  value={(summary.unchangedCount + summary.masterHigherCount).toLocaleString(
                    "en-IN",
                  )}
                  sub={`${summary.unchangedCount} identical · ${summary.masterHigherCount} master higher · ${summary.unmatchedCount} unmatched`}
                  tone="neutral"
                />
              </div>

              {/* Row Accountability Strip */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-y py-2 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono tabular-nums">
                  <span>
                    Parsed Rows:{" "}
                    <strong className="text-foreground">{summary.totalParsedRows}</strong>
                  </span>
                  <span>·</span>
                  <span>
                    Unique IDs: <strong className="text-foreground">{summary.uniqueIds}</strong>
                  </span>
                  <span>·</span>
                  <span>
                    Mode:{" "}
                    <strong className="text-foreground">
                      {reconciliationMode === "difference" ? "Difference Only" : "Additive"}
                    </strong>
                  </span>
                  <span>·</span>
                  <span>
                    Paid File Total:{" "}
                    <strong className="text-foreground">{money(summary.totalIncomingDac)}</strong>
                  </span>
                  <span>·</span>
                  <span>
                    Commit Target DAC:{" "}
                    <strong className="text-emerald-700 dark:text-emerald-400">
                      {money(summary.totalUpdateDac)}
                    </strong>
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 whitespace-nowrap text-xs"
                    onClick={() =>
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
                            "Paid File Total",
                            "Difference",
                            "Target DAC",
                            "Incoming ECS",
                            "Incoming Special",
                            "Base Total",
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
                            r.paidFileTotal,
                            r.master ? r.difference : "",
                            r.dac,
                            r.ecs,
                            r.special,
                            r.master?.existingTotal ?? "",
                            r.newTotal ?? "",
                            r.reason,
                          ]),
                        ),
                      )
                    }
                  >
                    <Download className="mr-1 h-3 w-3" />
                    Summary CSV
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 whitespace-nowrap text-xs"
                    disabled={summary.unmatchedCount === 0}
                    onClick={() =>
                      downloadCsv(
                        "paid-file-unmatched.csv",
                        toCsv(
                          [
                            "Agreement ID",
                            "SFDC",
                            "Online",
                            "Paid File Total",
                            "ECS",
                            "Special",
                            "Rows",
                          ],
                          reconciledRows
                            .filter((r) => r.action === "unmatched")
                            .map((r) => [
                              r.agreementId,
                              r.sfdc,
                              r.online,
                              r.paidFileTotal,
                              r.ecs,
                              r.special,
                              r.sourceRows,
                            ]),
                        ),
                      )
                    }
                  >
                    Unmatched CSV ({summary.unmatchedCount})
                  </Button>
                </div>
              </div>

              {/* Filter Tabs + Search */}
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <Tabs
                  value={reviewTab}
                  onValueChange={(v) => setReviewTab(v as ReviewTab)}
                  className="w-full sm:w-auto"
                >
                  <TabsList className="flex h-auto flex-wrap justify-start gap-0.5">
                    <TabsTrigger value="all_changes" className="text-xs">
                      Updated First ({allChangesCount})
                    </TabsTrigger>
                    <TabsTrigger value="clean_updates" className="text-xs">
                      Updates Only ({summary.matchedUpdates})
                    </TabsTrigger>
                    <TabsTrigger value="conflicts" className="text-xs">
                      Conflicts ({summary.totalConflictsFlagged})
                    </TabsTrigger>
                    <TabsTrigger value="master_higher" className="text-xs">
                      Master Higher ({summary.masterHigherCount})
                    </TabsTrigger>
                    <TabsTrigger value="protected" className="text-xs">
                      Protected ({summary.protectedSkips})
                    </TabsTrigger>
                    <TabsTrigger value="unchanged" className="text-xs">
                      Matched ({summary.unchangedCount})
                    </TabsTrigger>
                    <TabsTrigger value="unmatched" className="text-xs">
                      Unmatched ({summary.unmatchedCount})
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search Agreement ID or Customer..."
                    className="h-8 pl-8 text-xs"
                  />
                </div>
              </div>

              {/* Diff Table */}
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[780px] text-left text-xs">
                  <thead className="border-b bg-muted/60 text-[11px] uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Agreement ID & Customer</th>
                      <th className="px-3 py-2 text-right">Master Total</th>
                      <th className="px-3 py-2 text-right">Paid File Total</th>
                      <th className="px-3 py-2 text-right">Difference / DAC</th>
                      <th className="px-3 py-2 text-right">New Total</th>
                      <th className="px-3 py-2">Resulting Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
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
                        </td>
                      </tr>
                    ) : (
                      filteredRows.slice(0, 500).map((r) => {
                        const badge = actionBadge(r.action);
                        const diffPositive = r.difference > 0.01;
                        const diffNegative = r.difference < -0.01;
                        return (
                          <tr key={r.agreementId} className="min-h-[40px] hover:bg-muted/30">
                            <td className="px-3 py-2 align-top">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-mono font-semibold tabular-nums text-foreground">
                                  {r.agreementId}
                                </span>
                                <span className="rounded border bg-background px-1 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
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
                                    setExpandedId(
                                      expandedId === r.agreementId ? null : r.agreementId,
                                    )
                                  }
                                  className="mt-0.5 text-[10px] font-medium text-primary underline underline-offset-2"
                                >
                                  {r.sourceRows} rows (
                                  {r.duplicatesReplaced > 0 ? "last wins" : "summed"}) ·{" "}
                                  {expandedId === r.agreementId ? "Hide" : "Inspect"}
                                </button>
                              )}
                              {expandedId === r.agreementId && (
                                <div className="mt-1.5 space-y-1 rounded border bg-muted/40 p-1.5 text-[11px]">
                                  {r.transactions.map((tx, idx) => (
                                    <div
                                      key={`${tx.row}-${idx}`}
                                      className="flex items-center justify-between gap-2 font-mono tabular-nums"
                                    >
                                      <span className="text-muted-foreground">Row {tx.row}</span>
                                      <span>
                                        SFDC {money(tx.sfdc)} · Onl {money(tx.online)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>

                            <td className="px-3 py-2 text-right align-top font-mono tabular-nums">
                              {r.master ? (
                                <>
                                  <div className="font-semibold text-foreground">
                                    {money(r.currentMasterTotal)}
                                  </div>
                                  {r.master.existingDac > 0 && (
                                    <div className="text-[10px] text-muted-foreground">
                                      Base {money(r.master.existingTotal)} + DAC{" "}
                                      {money(r.master.existingDac)}
                                    </div>
                                  )}
                                </>
                              ) : (
                                "—"
                              )}
                            </td>

                            <td className="px-3 py-2 text-right align-top font-mono tabular-nums">
                              <div className="font-semibold text-foreground">
                                {money(r.paidFileTotal)}
                              </div>
                              {(r.sfdc > 0 || r.online > 0) && (
                                <div className="text-[10px] text-muted-foreground">
                                  SFDC {money(r.sfdc)} · Onl {money(r.online)}
                                </div>
                              )}
                              {(r.ecs > 0 || r.special > 0) && (
                                <div className="text-[10px] text-muted-foreground">
                                  ECS {money(r.ecs)} · Sp {money(r.special)}
                                </div>
                              )}
                            </td>

                            <td className="px-3 py-2 text-right align-top font-mono tabular-nums">
                              <div
                                className={`font-bold ${
                                  diffPositive
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : diffNegative
                                      ? "text-amber-600 dark:text-amber-400"
                                      : "text-muted-foreground"
                                }`}
                              >
                                {r.master ? signedMoney(r.difference) : money(r.paidFileTotal)}
                              </div>
                              {r.isEditable && !applied && (
                                <div className="mt-1 flex items-center justify-end gap-1">
                                  <span className="font-sans text-[10px] text-muted-foreground">
                                    DAC:
                                  </span>
                                  <input
                                    aria-label={`Override DAC for ${r.agreementId}`}
                                    type="number"
                                    step="0.01"
                                    className="h-6 w-20 rounded border bg-background px-1.5 text-right font-mono text-[11px] tabular-nums"
                                    value={r.dac}
                                    onChange={(e) => {
                                      const val = Number(e.target.value);
                                      if (Number.isFinite(val)) onOverrideDac(r.agreementId, val);
                                    }}
                                  />
                                </div>
                              )}
                            </td>

                            <td className="px-3 py-2 text-right align-top font-mono tabular-nums">
                              {r.master ? (
                                <span>
                                  {money(r.currentMasterTotal)} →{" "}
                                  <strong className="text-foreground">
                                    {money(r.newTotal ?? r.currentMasterTotal)}
                                  </strong>
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>

                            <td className="px-3 py-2 align-top">
                              <span
                                className={`inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium ${badge.cls}`}
                              >
                                {badge.label}
                              </span>
                              <div className="mt-0.5 max-w-[230px] text-[10px] text-muted-foreground">
                                {r.reason}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {filteredRows.length > 500 && (
                <p className="text-xs text-muted-foreground">
                  Showing first 500 filtered records. Use Search to inspect specific Agreement IDs.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-3.5 py-2.5 sm:justify-between sm:px-5 sm:py-3">
          <div className="flex items-center gap-2">
            {step === "review" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 whitespace-nowrap"
                disabled={busy}
                onClick={() => onStepChange("mapping")}
              >
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Back to Mapping
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 whitespace-nowrap"
              disabled={busy}
              onClick={onCancelSession}
            >
              Cancel & Clear
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {step === "mapping" ? (
              <Button
                type="button"
                size="sm"
                className="shrink-0 whitespace-nowrap"
                disabled={busy || !sheetName || !mappingValidation.valid}
                onClick={onAnalyze}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Analyzing…
                  </>
                ) : (
                  "Analyze Against Master Data"
                )}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                className="shrink-0 whitespace-nowrap"
                disabled={busy || !masterFound || commitCount === 0 || applied}
                onClick={() => void onCommit()}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Committing…
                  </>
                ) : applied ? (
                  <>
                    <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                    Committed to Master Data
                  </>
                ) : (
                  `Commit to Master Data (${commitCount.toLocaleString("en-IN")})`
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MappingSelect({
  label,
  required,
  value,
  headers,
  onChange,
}: {
  label: string;
  required?: boolean;
  value: number;
  headers: string[];
  onChange: (value: number) => void;
}) {
  return (
    <div className="min-w-0 rounded-md border bg-muted/20 p-2.5">
      <label className="mb-1 block text-xs font-medium text-foreground">
        {label}
        {required ? <span className="ml-1 text-red-600">*</span> : null}
      </label>
      <select
        className="h-8 w-full min-w-0 rounded-md border bg-background px-2 text-xs"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        <option value={-1}>Not mapped</option>
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
    <div className={`rounded-lg border bg-card p-3 ${borderCls}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {icon}
      </div>
      <p className="mt-1 font-mono text-xl font-bold tabular-nums text-foreground">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}
