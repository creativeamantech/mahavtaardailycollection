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
  type ReconciliationMode,
  type SheetInfo,
  type StagedPaidRow,
} from "@/lib/paid-file-reconciliation";
import { PaidFileReconciliationModal } from "@/components/PaidFileReconciliationModal";
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
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<"mapping" | "review">("mapping");

  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy>("last_wins");
  const [reconciliationMode, setReconciliationMode] = useState<ReconciliationMode>("difference");
  const [defaultPaymentDate, setDefaultPaymentDate] = useState(() => today());

  const [stagedRecords, setStagedRecords] = useState<StagedPaidRow[]>([]);
  const [dacOverrides, setDacOverrides] = useState<Map<string, number>>(new Map());
  const [fileName, setFileName] = useState("");
  const [invalidRows, setInvalidRows] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState(
    "Drop or select a Paid File (.xlsx, .xls, .csv)",
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
        reconciliationMode,
        defaultPaymentDate,
      ),
    [
      stagedRecords,
      masterRows,
      totalRows,
      invalidRows,
      dacOverrides,
      reconciliationMode,
      defaultPaymentDate,
    ],
  );

  const currentStage = applied
    ? 4
    : modalOpen && modalStep === "review"
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
        setProgressLabel("Columns auto-detected — review mapping");
        setBusy(false);
        setModalStep("mapping");
        setModalOpen(true);
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
        setModalStep("review");
        setModalOpen(true);
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
    setModalOpen(false);
    setModalStep("mapping");
    setSheets([]);
    setSheetName("");
    setMapping(EMPTY_MAPPING);
    setStagedRecords([]);
    setDacOverrides(new Map());
    setFileName("");
    setProgress(0);
    setProgressLabel("Drop or select a Paid File (.xlsx, .xls, .csv)");
    setBusy(false);
    setApplied(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
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
      setModalOpen(false);
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
    <main className="mx-auto w-full max-w-[1500px] space-y-5 px-3 pb-24 pt-5 sm:px-5 lg:px-8">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-primary">
            Admin · Master Allocation Reconciliation
          </p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Paid File Upload & Master Reconciliation
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Interactive column mapping, Manual/Corrected protection, conflict flagging, and
            hash-chained audit commits.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="whitespace-nowrap shrink-0"
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
              className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-card px-3 text-xs font-medium hover:bg-accent"
            >
              Open Master Sheet
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </header>

      {/* 4-Stage Workflow Stepper */}
      <section className="grid grid-cols-2 gap-2 rounded-xl border bg-card p-3 sm:grid-cols-4">
        {[
          { num: 1, title: "Upload File", desc: "Local spreadsheet parse" },
          { num: 2, title: "Column Mapping", desc: "Auto-detect & 5-row preview" },
          { num: 3, title: "Reconciliation", desc: "Protect overrides & flag conflicts" },
          { num: 4, title: "Atomic Commit", desc: "Delta update + Audit chain" },
        ].map((s) => {
          const active = currentStage === s.num;
          const done = currentStage > s.num || (applied && s.num === 4);
          return (
            <div
              key={s.num}
              className={`rounded-lg border px-3 py-2 ${
                active
                  ? "border-primary/50 bg-primary/5"
                  : done
                    ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20"
                    : "border-border bg-background"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full font-mono text-[11px] font-bold ${
                    done
                      ? "bg-emerald-600 text-white"
                      : active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {done ? "✓" : s.num}
                </span>
                <span className="text-xs font-semibold text-foreground">{s.title}</span>
              </div>
              <p className="mt-0.5 pl-7 text-[11px] text-muted-foreground">{s.desc}</p>
            </div>
          );
        })}
      </section>

      {/* Prerequisite Guard or Active Master Banner */}
      {masterQuery.isLoading ? (
        <section className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          Checking current-month Master Allocation spreadsheet…
        </section>
      ) : !masterFound ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
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
            className="inline-flex h-8 shrink-0 items-center rounded-md bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-700"
          >
            Initialize in Settings →
          </Link>
        </section>
      ) : (
        <section className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="font-semibold text-foreground">
              {masterQuery.data?.spreadsheetName}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">Tab: {masterQuery.data?.tab}</span>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono tabular-nums text-foreground">
              {masterRows.length.toLocaleString("en-IN")} Master Accounts Loaded
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {masterQuery.data?.hasProtectionColumns
              ? "Source / Correction / Conflict columns active"
              : "Standard Master columns active (Protected & Conflict tracking via Audit/Conflicts tabs)"}
          </span>
        </section>
      )}

      {/* Upload Dropzone */}
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
        className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragActive
            ? "border-primary bg-primary/5"
            : "border-border bg-card hover:border-primary/40"
        }`}
      >
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
        <div className="mx-auto flex max-w-xl flex-col items-center gap-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border bg-muted/50">
            <Upload className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">
            Drop Paid File here or browse from device
          </h2>
          <p className="text-xs text-muted-foreground">
            Supports <span className="font-mono">.xlsx</span>,{" "}
            <span className="font-mono">.xls</span>, <span className="font-mono">.xlsb</span>, and{" "}
            <span className="font-mono">.csv</span>. Files are parsed locally in a Web Worker — no
            raw file is uploaded.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <label
              htmlFor="paid-file-input"
              className={`inline-flex h-8 cursor-pointer items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 ${
                busy ? "pointer-events-none opacity-50" : ""
              }`}
            >
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              Select Paid File (.xlsb / .xlsx / .csv)
            </label>
            {sheets.length > 0 && (
              <Button type="button" size="sm" variant="outline" onClick={() => setModalOpen(true)}>
                Resume Reconciliation Modal
              </Button>
            )}
          </div>
        </div>

        {(busy || progress > 0) && (
          <div className="mx-auto mt-4 max-w-lg space-y-1.5 text-left">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-foreground">{progressLabel}</span>
              <span className="font-mono tabular-nums text-muted-foreground">{progress}%</span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}
      </section>

      {/* Post-Commit Result Banner */}
      {lastCommitInfo && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-900 dark:text-emerald-200">
              <ShieldCheck className="h-4 w-4" />
              Paid File Committed Atomically
            </div>
            <p className="font-mono text-xs text-emerald-800 dark:text-emerald-300">
              {lastCommitInfo.applied} updated · {lastCommitInfo.conflictsLogged} conflicts flagged
              · Chain Hash: {lastCommitInfo.chainHash.slice(0, 14)}…
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {lastCommitInfo.conflictsLogged > 0 && (
              <Link
                to="/conflicts"
                className="inline-flex h-8 items-center gap-1 rounded-md border border-red-300 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-50"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Inspect Conflicts
              </Link>
            )}
            <Link
              to="/master-performance"
              className="inline-flex h-8 items-center rounded-md border bg-white px-3 text-xs font-semibold text-foreground hover:bg-accent"
            >
              View Performance Report →
            </Link>
          </div>
        </section>
      )}

      {/* Audit Trail & SHA-256 Chain Verification */}
      <section className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-foreground">
              Paid File Audit Log & Cryptographic Hash Chain
            </h2>
            <p className="text-xs text-muted-foreground">
              Every Paid File merge records batch diffs, protected skips, conflicts, and SHA-256
              chain hashes in <span className="font-mono">Paid_File_Audit_Log</span>.
            </p>
          </div>
          {auditQuery.data?.found && (
            <span
              className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium ${
                auditQuery.data.chainValid
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
              }`}
            >
              {auditQuery.data.chainValid ? (
                <>
                  <Lock className="h-3.5 w-3.5" />
                  Chain Verified ({auditQuery.data.verifiedCount} chained)
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

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="border-b bg-muted/40 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Timestamp (IST)</th>
                <th className="px-3 py-2">Admin</th>
                <th className="px-3 py-2">File Name</th>
                <th className="px-3 py-2 text-right">Applied</th>
                <th className="px-3 py-2 text-right">Total DAC</th>
                <th className="px-3 py-2 text-right">Conflicts</th>
                <th className="px-3 py-2 text-right">Protected</th>
                <th className="px-3 py-2 text-right">Unmatched</th>
                <th className="px-3 py-2">Status / Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {!auditQuery.data?.entries?.length ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">
                    No Paid File audit entries recorded for this month yet.
                  </td>
                </tr>
              ) : (
                auditQuery.data.entries.map((entry) => (
                  <tr key={entry.row} className="h-9 hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-mono tabular-nums text-muted-foreground">
                      {entry.timestamp}
                    </td>
                    <td className="px-3 py-1.5 font-medium">{entry.adminName}</td>
                    <td className="max-w-[200px] truncate px-3 py-1.5" title={entry.fileName}>
                      {entry.fileName}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {entry.recordsApplied.toLocaleString("en-IN")}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                      {money(entry.totalDac)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {entry.conflictsFlagged > 0 ? (
                        <span className="font-semibold text-red-600">{entry.conflictsFlagged}</span>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {entry.protectedSkips}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {entry.unmatchedSkipped}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                            entry.applyStatus === "COMPLETE"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : "border-amber-200 bg-amber-50 text-amber-800"
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <PaidFileReconciliationModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        step={modalStep}
        onStepChange={setModalStep}
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
        reconciliationMode={reconciliationMode}
        onReconciliationModeChange={setReconciliationMode}
        defaultPaymentDate={defaultPaymentDate}
        onDefaultPaymentDateChange={setDefaultPaymentDate}
        onAnalyze={handleAnalyze}
        reconciledRows={reconciledRows}
        summary={summary}
        onOverrideDac={handleOverrideDac}
        onCommit={handleCommit}
        onCancelSession={handleCancelSession}
        busy={busy}
        applied={applied}
        progress={progress}
        progressLabel={progressLabel}
      />
    </main>
  );
}
