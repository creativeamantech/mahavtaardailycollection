import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { getCurrentSession } from "@/lib/auth.functions";
import {
  applyPaidFileChangeSet,
  fetchMasterMatchingData,
  getPaidFileAuditHistory,
} from "@/lib/paid-file.functions";
import {
  reconcilePaidDataset,
  type ColumnMapping,
  type DuplicateStrategy,
  type MasterRow,
  type SheetInfo,
  type StagedPaidRow,
} from "@/lib/paid-file-reconciliation";
import { PaidFileReconciliationWorkspace } from "@/components/PaidFileReconciliationModal";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/_authenticated/paid-file")({
  beforeLoad: async () => {
    const session = await getCurrentSession();
    if (!session) throw redirect({ to: "/auth" });
    if (session.role !== "Admin") throw redirect({ to: "/" });
  },
  head: () => ({ meta: [{ title: "Paid File Reconciliation — Mahavtaar Daily Collection" }] }),
  component: PaidFilePage,
});

type WorkerEvent =
  | { type: "progress"; percent: number; label: string }
  | { type: "inspected"; sheets: SheetInfo[]; defaultSheet: string }
  | {
      type: "processed";
      fileName: string;
      records: StagedPaidRow[];
      invalidRows: number;
      totalRows: number;
    }
  | { type: "error"; message: string };

const money = (n: number) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const today = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return part("year") + "-" + part("month") + "-" + part("day");
};

const EMPTY_MAPPING: ColumnMapping = {
  agreementId: -1,
  dacMode: "split_sfdc_online",
  sfdc: -1,
  online: -1,
  paidAmount: -1,
  paidTotal: -1,
  ecs: -1,
  special: -1,
  paymentDate: -1,
};

function PaidFilePage() {
  const qc = useQueryClient();
  const fetchMaster = useServerFn(fetchMasterMatchingData);
  const fetchAudit = useServerFn(getPaidFileAuditHistory);
  const applyChanges = useServerFn(applyPaidFileChangeSet);
  const workerRef = useRef<Worker | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [dragActive, setDragActive] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceStep, setWorkspaceStep] = useState<"mapping" | "review">("mapping");

  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy>("last_wins");
  const [defaultPaymentDate, setDefaultPaymentDate] = useState(() => today());

  const [stagedRecords, setStagedRecords] = useState<StagedPaidRow[]>([]);
  const [dacOverrides, setDacOverrides] = useState<Map<string, number>>(new Map());
  const [fileName, setFileName] = useState("");
  const [invalidRows, setInvalidRows] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState(
    "Drop or select a Paid File (.xlsb, .xlsx, .xls, .csv)",
  );
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [lastCommitInfo, setLastCommitInfo] = useState<{
    applied: number;
    conflictsLogged: number;
    chainHash: string;
  } | null>(null);

  const masterQuery = useQuery({
    queryKey: ["paid-file-master"],
    queryFn: () => fetchMaster({ data: { target: "monthly-master" } }),
    staleTime: 60_000,
  });

  const auditQuery = useQuery({
    queryKey: ["paid-file-audit-history"],
    queryFn: () => fetchAudit(),
    staleTime: 30_000,
  });

  const masterRows: MasterRow[] = useMemo(
    () => (masterQuery.data?.found ? (masterQuery.data.rows as MasterRow[]) : []),
    [masterQuery.data],
  );

  const { rows: reconciledRows, summary } = useMemo(
    () =>
      reconcilePaidDataset(
        stagedRecords,
        masterRows,
        { totalRows, invalidRows },
        dacOverrides,
        defaultPaymentDate,
      ),
    [stagedRecords, masterRows, totalRows, invalidRows, dacOverrides, defaultPaymentDate],
  );

  const currentStage = applied
    ? 4
    : workspaceOpen && workspaceStep === "review"
      ? 3
      : sheets.length > 0
        ? 2
        : 1;

  function attachWorker() {
    workerRef.current?.terminate();
    const worker = new Worker(new URL("../../workers/paid-file.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerEvent>) => {
      const message = event.data;
      if (message.type === "progress") {
        setProgress(message.percent);
        setProgressLabel(message.label);
      }
      if (message.type === "inspected") {
        setSheets(message.sheets);
        setSheetName(message.defaultSheet);
        const selected = message.sheets.find((s) => s.name === message.defaultSheet);
        if (selected) setMapping(selected.mapping);
        setProgress(70);
        setProgressLabel("Columns auto-detected — review mapping below");
        setBusy(false);
        setWorkspaceStep("mapping");
        setWorkspaceOpen(true);
      }
      if (message.type === "processed") {
        setFileName(message.fileName);
        setInvalidRows(message.invalidRows);
        setTotalRows(message.totalRows);
        setStagedRecords(message.records);
        setDacOverrides(new Map());
        setProgress(100);
        setProgressLabel("Ready for pre-merge reconciliation");
        setBusy(false);
        setWorkspaceStep("review");
        setWorkspaceOpen(true);
      }
      if (message.type === "error") {
        setBusy(false);
        setProgressLabel("Processing failed");
        toast.error(message.message);
      }
    };
    worker.onerror = (event) => {
      setBusy(false);
      toast.error(event.message || "Paid File worker failed.");
    };
    return worker;
  }

  async function handleFile(file?: File) {
    if (!file) return;
    const trimmedName = file.name.trim();
    const hasValidExt = /\.(xlsb|xlsx|xls|csv)(?:\s*\(\d+\))?$/i.test(trimmedName);
    const hasExcelMime = /spreadsheet|excel|ms-excel|csv|comma-separated/i.test(file.type || "");
    let hasSpreadsheetHeader = false;
    if (!hasValidExt && !hasExcelMime) {
      const blockedExt =
        /\.(pdf|png|jpe?g|webp|gif|svg|mp4|mp3|wav|zip|rar|7z|docx?|pptx?|apk|exe)$/i.test(
          trimmedName,
        );
      if (!blockedExt && file.size >= 4) {
        const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
        const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
        const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
        hasSpreadsheetHeader = isZip || isOle;
      }
    }
    if (!hasValidExt && !hasExcelMime && !hasSpreadsheetHeader) {
      toast.error("Choose an XLSB, XLSX, XLS, or CSV file.");
      return;
    }

    setBusy(true);
    setApplied(false);
    setLastCommitInfo(null);
    setStagedRecords([]);
    setDacOverrides(new Map());
    setSheets([]);
    setProgress(10);
    setProgressLabel("Reading local file");
    setFileName(file.name);

    try {
      if (!masterFound) {
        void masterQuery.refetch();
      }
      const worker = attachWorker();
      worker.postMessage({ type: "inspect", file, fileName: file.name });
    } catch (error) {
      setBusy(false);
      setProgress(0);
      toast.error(error instanceof Error ? error.message : "Could not read local Paid File.");
    }
  }

  function handleAnalyze() {
    if (!sheetName || !workerRef.current) {
      toast.error("Select a worksheet first.");
      return;
    }
    setBusy(true);
    setProgress(40);
    setProgressLabel("Analyzing rows against Master Allocation");
    workerRef.current.postMessage({
      type: "process",
      sheetName,
      mapping,
      duplicateStrategy,
    });
  }

  function handleOverrideDac(agreementId: string, dac: number) {
    setDacOverrides((prev) => {
      const next = new Map(prev);
      next.set(agreementId, dac);
      return next;
    });
  }

  function handleCancelSession() {
    workerRef.current?.terminate();
    workerRef.current = null;
    setWorkspaceOpen(false);
    setWorkspaceStep("mapping");
    setSheets([]);
    setSheetName("");
    setMapping(EMPTY_MAPPING);
    setStagedRecords([]);
    setDacOverrides(new Map());
    setFileName("");
    setProgress(0);
    setProgressLabel("Drop or select a Paid File (.xlsb, .xlsx, .xls, .csv)");
    setBusy(false);
    setApplied(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleApplyZeroAmount(
    changes: {
      row: number;
      agreementId: string;
      dac: number;
      ecs: number;
      special: number;
      paymentDate: string;
    }[],
  ) {
    if (busy || changes.length === 0) return;
    const masterByRow = new Map(masterRows.map((row) => [row.row, row]));
    const manualChanges = changes.map((change) => {
      const master = masterByRow.get(change.row);
      if (!master || master.agreementId !== change.agreementId) {
        throw new Error(
          `Master record changed for ${change.agreementId}. Refresh and review the Paid File again.`,
        );
      }
      const dac = Math.round((master.existingDac + change.dac) * 100) / 100;
      const ecs = Math.round((master.existingEcs + change.ecs) * 100) / 100;
      const special = Math.round((master.existingSpecial + change.special) * 100) / 100;
      const increment = change.dac + change.ecs + change.special;
      const baseTotal = Math.max(master.existingTotal, master.existingNewTotal);
      return {
        row: master.row,
        agreementId: change.agreementId,
        dac,
        ecs,
        special,
        newTotal: Math.round((baseTotal + increment) * 100) / 100,
        paymentDate: change.paymentDate || today(),
        clearProvisional: false,
      };
    });
    setBusy(true);
    setProgress(20);
    setProgressLabel("Applying reviewed zero-amount manual additions");
    try {
      const totalDac = changes.reduce((sum, change) => sum + change.dac, 0);
      const result = await applyChanges({
        data: {
          target: "monthly-master",
          sourceMode: "MANUAL",
          fileName: fileName + " · Zero Amount Manual Review",
          fileDate: today(),
          totalDac,
          totalSfdc: 0,
          totalOnline: 0,
          protectedSkips: 0,
          unmatchedSkipped: 0,
          duplicatesReplaced: 0,
          changes: manualChanges,
          conflictFlags: [],
        },
      });
      setProgress(100);
      toast.success(result.applied + " zero-amount loan(s) manually updated and audit logged.");
      setDacOverrides(new Map());
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["paid-file-master"] }),
        qc.invalidateQueries({ queryKey: ["paid-file-audit-history"] }),
      ]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not apply zero-amount manual additions.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    if (applied || busy) return;
    const updates = reconciledRows.filter(
      (r) =>
        (r.action === "clean_update" || r.action === "provisional_confirmed") &&
        r.master &&
        r.hasDelta,
    );
    const conflicts = reconciledRows.filter(
      (r) => (r.action === "protected_conflict" || r.action === "conflict_provisional") && r.master,
    );

    if (updates.length === 0 && conflicts.length === 0) {
      toast.error("No new Master Data updates or conflict flags to commit.");
      return;
    }

    setBusy(true);
    setProgress(25);
    setProgressLabel("Committing delta updates & audit chain to Master Allocation");

    try {
      const totalDac = updates.reduce((sum, r) => sum + r.dac, 0);
      const totalSfdc = updates.reduce((sum, r) => sum + r.sfdc, 0);
      const totalOnline = updates.reduce((sum, r) => sum + r.online, 0);

      const res = await applyChanges({
        data: {
          target: "monthly-master",
          fileName,
          fileDate: today(),
          totalDac,
          totalSfdc,
          totalOnline,
          protectedSkips: summary.protectedSkips,
          unmatchedSkipped: summary.unmatchedCount,
          duplicatesReplaced: summary.duplicatesReplaced,
          changes: updates.map((r) => ({
            row: r.master!.row,
            agreementId: r.agreementId,
            dac: r.dac,
            newTotal: r.newTotal!,
            ecs: r.targetEcs,
            special: r.targetSpecial,
            paymentDate: r.resolvedPaymentDate,
            clearProvisional: r.action === "provisional_confirmed",
          })),
          conflictFlags: conflicts.map((r) => ({
            row: r.master!.row,
            agreementId: r.agreementId,
            existingDac: r.master!.existingDac,
            incomingDac: r.dac,
            incomingEcs: r.ecs,
            incomingSpecial: r.special,
            source: r.master!.dacSource || (r.master!.isCorrected ? "CORRECTED" : "PROVISIONAL"),
            reason: r.reason,
          })),
        },
      });

      setApplied(true);
      setLastCommitInfo({
        applied: res.applied,
        conflictsLogged: res.conflictsLogged,
        chainHash: res.chainHash,
      });
      setProgress(100);
      setProgressLabel("Committed atomically with audit trail");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["paid-file-master"] }),
        qc.invalidateQueries({ queryKey: ["paid-file-audit-history"] }),
      ]);

      toast.success(
        `${res.applied} record(s) committed` +
          (res.conflictsLogged > 0 ? ` · ${res.conflictsLogged} conflict(s) flagged` : ""),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not commit Paid File changes.");
    } finally {
      setBusy(false);
    }
  }

  const masterFound = masterQuery.data?.found ?? false;

  return (
    <main className="mx-auto w-full max-w-[1440px] space-y-5 px-3.5 pb-12 pt-4 sm:px-6 lg:px-8">
      {/* Hidden native input kept mounted so both dropzone and active file switcher work seamlessly on Android */}
      <input
        id="paid-file-input"
        ref={fileInputRef}
        type="file"
        disabled={busy}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          void handleFile(picked);
        }}
        className="sr-only"
      />

      {/* Page Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
            Admin · Master Allocation Reconciliation
          </p>
          <h1 className="mt-0.5 text-xl font-bold tracking-tight text-foreground sm:text-2xl lg:text-3xl">
            Paid File Reconciliation
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Compare Paid File totals against Master Allocation, verify negative Remaining
            differences, and commit updates with an audit chain.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 flex-1 shrink-0 whitespace-nowrap sm:min-h-9 sm:flex-initial"
            onClick={() => {
              void masterQuery.refetch();
              void auditQuery.refetch();
            }}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh Master
          </Button>
          {masterQuery.data?.found && masterQuery.data.spreadsheetUrl && (
            <a
              href={masterQuery.data.spreadsheetUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 flex-1 shrink-0 items-center justify-center gap-1.5 rounded-lg border bg-card px-3.5 text-xs font-semibold text-foreground whitespace-nowrap hover:bg-accent sm:min-h-9 sm:flex-initial"
            >
              Open Master Sheet
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </header>

      {/* 4-Stage Workflow Stepper */}
      <section aria-label="Reconciliation steps" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { num: 1, title: "1. Upload File", desc: "XLSB / XLSX / CSV" },
          { num: 2, title: "2. Map Columns", desc: "Verify 5-row sample" },
          { num: 3, title: "3. Review Diff", desc: "Negative Remaining" },
          { num: 4, title: "4. Committed", desc: "Master + Audit Log" },
        ].map((s) => {
          const active = currentStage === s.num;
          const done = currentStage > s.num || (applied && s.num === 4);
          const clickable =
            (s.num === 2 && sheets.length > 0) || (s.num === 3 && stagedRecords.length > 0);

          const cardClass = `rounded-xl border px-3 py-2.5 text-left transition-colors ${
            active
              ? "border-primary/60 bg-primary/8"
              : done
                ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20"
                : "border-border bg-card"
          }`;

          const content = (
            <>
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold ${
                    done
                      ? "bg-emerald-600 text-white"
                      : active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {done ? "✓" : s.num}
                </span>
                <span className="truncate text-xs font-semibold text-foreground">{s.title}</span>
              </div>
              <p className="mt-0.5 truncate pl-7 text-[11px] text-muted-foreground">{s.desc}</p>
            </>
          );

          if (clickable) {
            return (
              <button
                key={s.num}
                type="button"
                onClick={() => {
                  setWorkspaceOpen(true);
                  setWorkspaceStep(s.num === 2 ? "mapping" : "review");
                }}
                className={`${cardClass} min-h-11 hover:border-primary/40`}
              >
                {content}
              </button>
            );
          }

          return (
            <div key={s.num} className={cardClass}>
              {content}
            </div>
          );
        })}
      </section>

      {/* Master Connection Banner */}
      {masterQuery.isLoading ? (
        <section className="rounded-xl border bg-card p-4 text-xs text-muted-foreground sm:text-sm">
          Checking current-month Master Allocation spreadsheet…
        </section>
      ) : !masterFound ? (
        <section className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <h2 className="text-sm font-bold">Master Allocation Required Before Paid Upload</h2>
              <p className="mt-0.5 text-xs">
                {masterQuery.data?.errorMessage ||
                  "Initialize this month's Mahavtaar Master Allocation spreadsheet first so Paid File rows can match against active accounts."}
              </p>
            </div>
          </div>
          <Link
            to="/settings"
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-amber-600 px-4 text-xs font-semibold text-white whitespace-nowrap hover:bg-amber-700 sm:min-h-9"
          >
            Initialize in Settings →
          </Link>
        </section>
      ) : (
        <section className="flex flex-col gap-1.5 rounded-xl border bg-card px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="font-semibold text-foreground">
              {masterQuery.data?.spreadsheetName}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">Tab: {masterQuery.data?.tab}</span>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono font-semibold tabular-nums text-foreground">
              {masterRows.length.toLocaleString("en-IN")} Master Accounts
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {masterQuery.data?.hasProtectionColumns
              ? "Protection & conflict columns active"
              : "Protected & conflict tracking via Audit/Conflicts tabs"}
          </span>
        </section>
      )}

      {/* Post-Commit Success Banner */}
      {lastCommitInfo && (
        <section className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/75 p-4 dark:border-emerald-900 dark:bg-emerald-950/30 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-900 dark:text-emerald-200">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              Paid File Committed Atomically
            </div>
            <p className="font-mono text-xs tabular-nums text-emerald-800 dark:text-emerald-300">
              {lastCommitInfo.applied.toLocaleString("en-IN")} updated ·{" "}
              {lastCommitInfo.conflictsLogged} conflicts flagged · Chain Hash:{" "}
              {lastCommitInfo.chainHash.slice(0, 14)}…
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {lastCommitInfo.conflictsLogged > 0 && (
              <Link
                to="/conflicts"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3.5 text-xs font-semibold text-red-700 whitespace-nowrap hover:bg-red-50 sm:min-h-8"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Inspect Conflicts
              </Link>
            )}
            <Link
              to="/master-performance"
              className="inline-flex min-h-10 items-center rounded-lg border bg-white px-3.5 text-xs font-semibold text-foreground whitespace-nowrap hover:bg-accent sm:min-h-8"
            >
              Performance Report →
            </Link>
          </div>
        </section>
      )}

      {/* Step 1 Upload Dropzone (or Compact Active File Switcher when workspace is open) */}
      {sheets.length === 0 ? (
        <section
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            if (busy) return;
            const file = e.dataTransfer.files?.[0];
            void handleFile(file);
          }}
          className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors sm:p-8 ${
            dragActive
              ? "border-primary bg-primary/5"
              : "border-border bg-card hover:border-primary/40"
          }`}
        >
          <div className="mx-auto flex max-w-xl flex-col items-center gap-2.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border bg-muted/50">
              <Upload className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-base font-bold text-foreground">Select Paid File from Device</h2>
            <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
              Supports <span className="font-mono font-semibold">.xlsb</span>,{" "}
              <span className="font-mono font-semibold">.xlsx</span>,{" "}
              <span className="font-mono font-semibold">.xls</span>, and{" "}
              <span className="font-mono font-semibold">.csv</span>. Parsed locally on your device —
              fast on Android and Desktop.
            </p>
            <div className="mt-2 flex w-full flex-col items-center justify-center gap-2 sm:w-auto sm:flex-row">
              <label
                htmlFor="paid-file-input"
                className={`inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 sm:w-auto ${
                  busy ? "pointer-events-none opacity-50" : ""
                }`}
              >
                <FileSpreadsheet className="mr-2 h-4 w-4 shrink-0" />
                Choose Paid File (.xlsb / .xlsx / .csv)
              </label>
            </div>
          </div>

          {(busy || progress > 0) && (
            <div className="mx-auto mt-5 max-w-lg space-y-1.5 text-left">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-foreground">{progressLabel}</span>
                <span className="font-mono font-semibold tabular-nums text-muted-foreground">
                  {progress}%
                </span>
              </div>
              <Progress value={progress} className="h-1.5" />
            </div>
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <FileSpreadsheet className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{fileName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {sheets.length} sheet{sheets.length === 1 ? "" : "s"} detected
                {totalRows > 0 ? ` · ${totalRows.toLocaleString("en-IN")} rows parsed` : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="paid-file-input"
              className={`inline-flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-lg border bg-background px-3 text-xs font-semibold text-foreground whitespace-nowrap hover:bg-accent sm:min-h-8 sm:flex-initial ${
                busy ? "pointer-events-none opacity-50" : ""
              }`}
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Switch File
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-10 flex-1 whitespace-nowrap sm:min-h-8 sm:flex-initial"
              disabled={busy}
              onClick={handleCancelSession}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Reset
            </Button>
          </div>
        </section>
      )}

      {/* Inline Spacious Reconciliation Workspace (Step 2 Mapping & Step 3 Diff Review) */}
      {workspaceOpen && sheets.length > 0 && (
        <PaidFileReconciliationWorkspace
          step={workspaceStep}
          onStepChange={setWorkspaceStep}
          fileName={fileName}
          masterFound={masterFound}
          onRefreshMaster={() => void masterQuery.refetch()}
          spreadsheetName={masterQuery.data?.spreadsheetName ?? ""}
          sheets={sheets}
          sheetName={sheetName}
          onSelectSheet={(name) => {
            setSheetName(name);
            const s = sheets.find((x) => x.name === name);
            if (s) setMapping(s.mapping);
          }}
          mapping={mapping}
          onMappingChange={setMapping}
          duplicateStrategy={duplicateStrategy}
          onDuplicateStrategyChange={setDuplicateStrategy}
          defaultPaymentDate={defaultPaymentDate}
          onDefaultPaymentDateChange={setDefaultPaymentDate}
          onAnalyze={handleAnalyze}
          reconciledRows={reconciledRows}
          summary={summary}
          onOverrideDac={handleOverrideDac}
          onCommit={handleCommit}
          onApplyZeroAmount={handleApplyZeroAmount}
          onCancelSession={handleCancelSession}
          busy={busy}
          applied={applied}
          progress={progress}
          progressLabel={progressLabel}
        />
      )}

      {/* Audit Trail & SHA-256 Chain Verification */}
      <section className="overflow-hidden rounded-2xl border bg-card">
        <div className="flex flex-col gap-2 border-b px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 className="text-sm font-bold text-foreground sm:text-base">
              Audit Log &amp; Tamper-Evident Chain
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Every Paid File commit records batch counts, protected skips, conflicts, and SHA-256
              hashes in <span className="font-mono">Paid_File_Audit_Log</span>.
            </p>
          </div>
          {auditQuery.data?.found && (
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 self-start rounded-md px-2.5 py-1 text-xs font-semibold sm:self-auto ${
                auditQuery.data.chainValid
                  ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300"
              }`}
            >
              {auditQuery.data.chainValid ? (
                <>
                  <Lock className="h-3.5 w-3.5" />
                  Chain Verified ({auditQuery.data.verifiedCount} entries)
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Chain Mismatch at Row {auditQuery.data.brokenAtRow}
                </>
              )}
            </span>
          )}
        </div>

        {!auditQuery.data?.entries?.length ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            No Paid File audit entries recorded for this month yet.
          </div>
        ) : (
          <>
            {/* Android / Mobile Audit Cards */}
            <div className="divide-y md:hidden">
              {auditQuery.data.entries.map((entry) => (
                <div key={entry.row} className="space-y-2.5 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-foreground">{entry.fileName}</p>
                      <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                        {entry.timestamp} · {entry.adminName}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                        entry.applyStatus === "COMPLETE"
                          ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                      }`}
                    >
                      {entry.applyStatus}
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-2 rounded-lg bg-muted/35 p-2.5 text-center font-mono text-xs tabular-nums">
                    <div>
                      <div className="font-sans text-[10px] text-muted-foreground">Applied</div>
                      <div className="font-bold text-foreground">
                        {entry.recordsApplied.toLocaleString("en-IN")}
                      </div>
                    </div>
                    <div>
                      <div className="font-sans text-[10px] text-muted-foreground">DAC</div>
                      <div className="font-bold text-foreground">{money(entry.totalDac)}</div>
                    </div>
                    <div>
                      <div className="font-sans text-[10px] text-muted-foreground">Conflicts</div>
                      <div
                        className={`font-bold ${
                          entry.conflictsFlagged > 0 ? "text-red-600" : "text-foreground"
                        }`}
                      >
                        {entry.conflictsFlagged}
                      </div>
                    </div>
                    <div>
                      <div className="font-sans text-[10px] text-muted-foreground">Skipped</div>
                      <div className="font-semibold text-muted-foreground">
                        {entry.protectedSkips + entry.unmatchedSkipped}
                      </div>
                    </div>
                  </div>

                  {entry.chainHash && (
                    <p className="font-mono text-[10px] text-muted-foreground">
                      Hash: #{entry.chainHash.slice(0, 12)}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop Audit Table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/40 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Timestamp (IST)</th>
                    <th className="px-4 py-2.5">Admin</th>
                    <th className="px-4 py-2.5">File Name</th>
                    <th className="px-4 py-2.5 text-right">Applied</th>
                    <th className="px-4 py-2.5 text-right">Total DAC</th>
                    <th className="px-4 py-2.5 text-right">Conflicts</th>
                    <th className="px-4 py-2.5 text-right">Protected</th>
                    <th className="px-4 py-2.5 text-right">Unmatched</th>
                    <th className="px-4 py-2.5">Status / Hash</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {auditQuery.data.entries.map((entry) => (
                    <tr key={entry.row} className="h-10 hover:bg-muted/20">
                      <td className="px-4 py-2 font-mono tabular-nums text-muted-foreground">
                        {entry.timestamp}
                      </td>
                      <td className="px-4 py-2 font-medium">{entry.adminName}</td>
                      <td className="max-w-[220px] truncate px-4 py-2" title={entry.fileName}>
                        {entry.fileName}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {entry.recordsApplied.toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums">
                        {money(entry.totalDac)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {entry.conflictsFlagged > 0 ? (
                          <span className="font-semibold text-red-600">
                            {entry.conflictsFlagged}
                          </span>
                        ) : (
                          0
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {entry.protectedSkips}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {entry.unmatchedSkipped}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                              entry.applyStatus === "COMPLETE"
                                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                            }`}
                          >
                            {entry.applyStatus}
                          </span>
                          {entry.chainHash && (
                            <span
                              className="font-mono text-[10px] text-muted-foreground"
                              title={entry.chainHash}
                            >
                              #{entry.chainHash.slice(0, 8)}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
