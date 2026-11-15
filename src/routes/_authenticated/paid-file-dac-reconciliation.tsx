import { Fragment, useMemo, useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Filter,
  Loader2,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Tag,
  X,
} from "lucide-react";
import { getCurrentSession } from "@/lib/auth.functions";
import { todayISO } from "@/lib/executives";
import { downloadCsv } from "@/lib/export";
import {
  buildDacReconciliation,
  composeProvisionalDacRemark,
  composeVerifyAddToDacRemark,
  dacReconciliationCsv,
  FAST_REMARK_TAGS,
  formatInrAmount,
  mergeAmansRemark,
  type CollectionReconciliationEntry,
  type DacReconciliationItem,
  type VarianceStatus,
} from "@/lib/dac-reconciliation";
import {
  batchUpdateAmansRemarks,
  commitDacReconciliationBatch,
  getDacReconciliationData,
} from "@/lib/dac-reconciliation.functions";
import type { MasterRow } from "@/lib/paid-file-reconciliation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/paid-file-dac-reconciliation")({
  beforeLoad: async () => {
    const session = await getCurrentSession();
    if (!session) throw redirect({ to: "/auth" });
    if (session.role !== "Admin") throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [{ title: "DAC Reconciliation — Mahavtaar Daily Collection" }],
  }),
  component: PaidFileDacReconciliationPage,
});

type StatusFilter =
  | "all"
  | "actionable"
  | "missing"
  | "shortfall"
  | "unallocated"
  | "verified"
  | "unverified"
  | "matched"
  | "already_paid";

const money = (value: number) => "₹" + formatInrAmount(value);

function varianceBadge(status: VarianceStatus) {
  switch (status) {
    case "MISSING_IN_DAC":
      return {
        label: "Missing in DAC",
        textCls: "text-red-700 dark:text-red-400",
        surfaceCls:
          "bg-red-50/90 border-red-200 text-red-800 dark:bg-red-950/35 dark:border-red-900 dark:text-red-300",
      };
    case "DAC_SHORTFALL":
      return {
        label: "Shortfall",
        textCls: "text-amber-700 dark:text-amber-400",
        surfaceCls:
          "bg-amber-50/90 border-amber-200 text-amber-800 dark:bg-amber-950/35 dark:border-amber-900 dark:text-amber-300",
      };
    case "UNALLOCATED_COLLECTION":
      return {
        label: "Unallocated",
        textCls: "text-violet-700 dark:text-violet-400",
        surfaceCls:
          "bg-violet-50/90 border-violet-200 text-violet-800 dark:bg-violet-950/35 dark:border-violet-900 dark:text-violet-300",
      };
    case "ALREADY_PAID_EXCLUDED":
      return {
        label: "Already Paid",
        textCls: "text-slate-600 dark:text-slate-400",
        surfaceCls:
          "bg-slate-100 border-slate-200 text-slate-700 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300",
      };
    case "DAC_MATCHED":
      return {
        label: "Matched",
        textCls: "text-emerald-700 dark:text-emerald-400",
        surfaceCls:
          "bg-emerald-50/90 border-emerald-200 text-emerald-800 dark:bg-emerald-950/35 dark:border-emerald-900 dark:text-emerald-300",
      };
    case "DAC_EXCEEDS_COLLECTION":
      return {
        label: "Master Higher",
        textCls: "text-sky-700 dark:text-sky-400",
        surfaceCls:
          "bg-sky-50/90 border-sky-200 text-sky-800 dark:bg-sky-950/35 dark:border-sky-900 dark:text-sky-300",
      };
  }
}

type CommitDialogState = {
  mode: "PUSH_TO_DAC" | "SET_PROVISIONAL";
  items: DacReconciliationItem[];
} | null;

function PaidFileDacReconciliationPage() {
  const qc = useQueryClient();
  const fetchReconciliationData = useServerFn(getDacReconciliationData);
  const runBatchRemarks = useServerFn(batchUpdateAmansRemarks);
  const runCommitBatch = useServerFn(commitDacReconciliationBatch);

  const [includeAlreadyPaid, setIncludeAlreadyPaid] = useState(false);
  const [categoryMismatchOnly, setCategoryMismatchOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedColCats, setSelectedColCats] = useState<string[]>([]);
  const [selectedMasterCats, setSelectedMasterCats] = useState<string[]>([]);
  const [executiveFilter, setExecutiveFilter] = useState("__all__");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [remarkDrafts, setRemarkDrafts] = useState<Record<string, string>>({});
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [commitDialog, setCommitDialog] = useState<CommitDialogState>(null);
  const [allowOverwriteProtected, setAllowOverwriteProtected] = useState(false);
  const [targetAmountOverrides, setTargetAmountOverrides] = useState<Record<string, string>>({});

  const dataQuery = useQuery({
    queryKey: ["dac-reconciliation-data"],
    queryFn: () => fetchReconciliationData(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const excludedLoanIds = useMemo(
    () =>
      new Set(
        (dataQuery.data?.excludedLoans ?? [])
          .filter((r) => r.status.toLowerCase() === "active")
          .map((r) => r.loanNumber.trim().toUpperCase()),
      ),
    [dataQuery.data?.excludedLoans],
  );

  const reconciliation = useMemo(() => {
    const collections = (dataQuery.data?.collections ?? []) as CollectionReconciliationEntry[];
    const masterRows = (
      dataQuery.data?.master.found ? dataQuery.data.master.rows : []
    ) as MasterRow[];
    return buildDacReconciliation({
      collections,
      masterRows,
      includeAlreadyPaid,
      excludedLoanIds,
    });
  }, [dataQuery.data, includeAlreadyPaid, excludedLoanIds]);

  const filteredItems = useMemo(() => {
    const colCatSet = new Set(selectedColCats.map((c) => c.toLowerCase()));
    const masterCatSet = new Set(selectedMasterCats.map((c) => c.toLowerCase()));
    const q = search.trim().toLowerCase();

    return reconciliation.items.filter((item) => {
      if (statusFilter === "actionable") {
        if (
          item.varianceStatus !== "MISSING_IN_DAC" &&
          item.varianceStatus !== "DAC_SHORTFALL" &&
          item.varianceStatus !== "UNALLOCATED_COLLECTION"
        ) {
          return false;
        }
      } else if (statusFilter === "missing" && item.varianceStatus !== "MISSING_IN_DAC") {
        return false;
      } else if (statusFilter === "shortfall" && item.varianceStatus !== "DAC_SHORTFALL") {
        return false;
      } else if (
        statusFilter === "unallocated" &&
        item.varianceStatus !== "UNALLOCATED_COLLECTION"
      ) {
        return false;
      } else if (statusFilter === "verified" && !item.isVerifiedByAman) {
        return false;
      } else if (statusFilter === "unverified" && item.isVerifiedByAman) {
        return false;
      } else if (
        statusFilter === "matched" &&
        item.varianceStatus !== "DAC_MATCHED" &&
        item.varianceStatus !== "DAC_EXCEEDS_COLLECTION"
      ) {
        return false;
      } else if (statusFilter === "already_paid" && !item.hasAlreadyPaid) {
        return false;
      }

      if (categoryMismatchOnly && !item.categoryMismatch) return false;

      if (colCatSet.size > 0) {
        const matchesCol = item.collectionCategories.some((c) => colCatSet.has(c.toLowerCase()));
        if (!matchesCol) return false;
      }

      if (masterCatSet.size > 0) {
        const matchesMaster = item.masterCategories.some((c) => masterCatSet.has(c.toLowerCase()));
        if (!matchesMaster) return false;
      }

      if (executiveFilter !== "__all__" && !item.executives.includes(executiveFilter)) {
        return false;
      }

      if (fromDate || toDate) {
        const matchesDate = item.allRows.some((entry) => {
          if (!entry.date) return false;
          if (fromDate && entry.date < fromDate) return false;
          if (toDate && entry.date > toDate) return false;
          return true;
        });
        if (!matchesDate) return false;
      }

      if (q) {
        const remarkText = (
          remarkDrafts[item.agreementId] ?? item.combinedAmansRemarks
        ).toLowerCase();
        const hit =
          item.agreementId.toLowerCase().includes(q) ||
          item.displayLoanId.toLowerCase().includes(q) ||
          item.customerName.toLowerCase().includes(q) ||
          item.executives.some((e) => e.toLowerCase().includes(q)) ||
          item.collectionCategory.toLowerCase().includes(q) ||
          item.masterCategory.toLowerCase().includes(q) ||
          remarkText.includes(q);
        if (!hit) return false;
      }

      return true;
    });
  }, [
    reconciliation.items,
    statusFilter,
    categoryMismatchOnly,
    selectedColCats,
    selectedMasterCats,
    executiveFilter,
    fromDate,
    toDate,
    search,
    remarkDrafts,
  ]);

  const selectedItems = useMemo(
    () => filteredItems.filter((item) => selectedIds.has(item.agreementId)),
    [filteredItems, selectedIds],
  );

  const selectedPushEligible = useMemo(
    () =>
      selectedItems.filter(
        (item) =>
          item.masterRow !== null &&
          !item.hasDuplicateMaster &&
          item.varianceStatus !== "ALREADY_PAID_EXCLUDED" &&
          item.collectionAmount > 0,
      ),
    [selectedItems],
  );

  const allFilteredSelected =
    filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.agreementId));

  const hasActiveFilters =
    statusFilter !== "all" ||
    selectedColCats.length > 0 ||
    selectedMasterCats.length > 0 ||
    executiveFilter !== "__all__" ||
    Boolean(fromDate) ||
    Boolean(toDate) ||
    Boolean(search.trim()) ||
    categoryMismatchOnly ||
    includeAlreadyPaid;

  function toggleSelectAll(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const item of filteredItems) {
        if (checked) next.add(item.agreementId);
        else next.delete(item.agreementId);
      }
      return next;
    });
  }

  function toggleRowSelection(agreementId: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(agreementId);
      else next.delete(agreementId);
      return next;
    });
  }

  function toggleRowExpand(agreementId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(agreementId)) next.delete(agreementId);
      else next.add(agreementId);
      return next;
    });
  }

  function toggleCategoryChip(list: string[], setter: (next: string[]) => void, value: string) {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  function appendTagToDraft(item: DacReconciliationItem, tag: string) {
    const current = remarkDrafts[item.agreementId] ?? item.combinedAmansRemarks;
    setRemarkDrafts((prev) => ({
      ...prev,
      [item.agreementId]: mergeAmansRemark(current, tag),
    }));
  }

  function resetFilters() {
    setStatusFilter("all");
    setSelectedColCats([]);
    setSelectedMasterCats([]);
    setExecutiveFilter("__all__");
    setFromDate("");
    setToDate("");
    setSearch("");
    setCategoryMismatchOnly(false);
    setIncludeAlreadyPaid(false);
  }

  async function handleCopyLoanId(loanId: string) {
    try {
      await navigator.clipboard.writeText(loanId);
      setCopiedId(loanId);
      setTimeout(() => setCopiedId((curr) => (curr === loanId ? null : curr)), 1500);
    } catch {
      toast.error("Could not copy Loan ID.");
    }
  }

  async function saveSingleRemark(item: DacReconciliationItem) {
    const draft = (remarkDrafts[item.agreementId] ?? item.combinedAmansRemarks).trim();
    const rowNumbers = item.allRows.map((r) => r.row);
    if (rowNumbers.length === 0) return;

    setSavingRowId(item.agreementId);
    try {
      const res = await runBatchRemarks({
        data: {
          updates: [
            {
              rows: rowNumbers,
              loanId: item.agreementId,
              remark: draft,
              mode: "replace",
            },
          ],
        },
      });
      toast.success(
        `Saved Aman's Remarks for ${item.agreementId} (${res.updatedCount} row${res.updatedCount === 1 ? "" : "s"}).`,
      );
      setRemarkDrafts((prev) => {
        const next = { ...prev };
        delete next[item.agreementId];
        return next;
      });
      await qc.invalidateQueries({ queryKey: ["dac-reconciliation-data"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save Aman's Remarks.");
    } finally {
      setSavingRowId(null);
    }
  }

  async function handleBatchVerifyRemarks() {
    if (selectedItems.length === 0 || batchBusy) return;
    const today = todayISO();
    setBatchBusy(true);
    try {
      const updates = selectedItems.map((item) => {
        const draft = remarkDrafts[item.agreementId];
        const autoRemark = composeVerifyAddToDacRemark(item.collectionAmount, today);
        const targetRemark =
          draft !== undefined && draft.trim() ? mergeAmansRemark(draft, autoRemark) : autoRemark;
        return {
          rows: item.allRows.map((r) => r.row),
          loanId: item.agreementId,
          remark: targetRemark,
          mode: draft !== undefined ? ("replace" as const) : ("append" as const),
        };
      });

      const res = await runBatchRemarks({ data: { updates } });
      toast.success(
        `Verified ${selectedItems.length} account(s) across ${res.updatedCount} Collections row(s) in ${res.batches} batch(es).`,
      );
      setSelectedIds(new Set());
      setRemarkDrafts((prev) => {
        const next = { ...prev };
        for (const item of selectedItems) delete next[item.agreementId];
        return next;
      });
      await qc.invalidateQueries({ queryKey: ["dac-reconciliation-data"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Batch remark update failed.");
    } finally {
      setBatchBusy(false);
    }
  }

  function openCommitDialog(
    mode: "PUSH_TO_DAC" | "SET_PROVISIONAL",
    items: DacReconciliationItem[],
  ) {
    const eligible = items.filter(
      (item) =>
        item.masterRow !== null &&
        !item.hasDuplicateMaster &&
        item.varianceStatus !== "ALREADY_PAID_EXCLUDED" &&
        item.collectionAmount > 0,
    );
    if (eligible.length === 0) {
      toast.error(
        "None of the selected rows match a unique Master Allocation account with an active collection.",
      );
      return;
    }

    const overrides: Record<string, string> = {};
    for (const item of eligible) {
      overrides[item.agreementId] =
        mode === "PUSH_TO_DAC"
          ? String(item.targetPushDac)
          : String(item.gapAmount > 0 ? item.gapAmount : item.collectionAmount);
    }
    setTargetAmountOverrides(overrides);
    setAllowOverwriteProtected(eligible.some((i) => i.isMasterProtected));
    setCommitDialog({ mode, items: eligible });
  }

  async function handleConfirmCommit() {
    if (!commitDialog || batchBusy) return;
    const today = todayISO();
    const { mode, items } = commitDialog;
    setBatchBusy(true);

    try {
      const payloadItems = items.map((item) => {
        const rawOverride = Number(targetAmountOverrides[item.agreementId]);
        const targetAmount =
          Number.isFinite(rawOverride) && rawOverride >= 0
            ? rawOverride
            : mode === "PUSH_TO_DAC"
              ? item.targetPushDac
              : item.collectionAmount;

        const autoNote =
          mode === "PUSH_TO_DAC"
            ? composeVerifyAddToDacRemark(targetAmount, today)
            : composeProvisionalDacRemark(targetAmount, item.latestPaymentDate || today);

        const draft = remarkDrafts[item.agreementId];
        const amansRemark =
          draft !== undefined && draft.trim() ? mergeAmansRemark(draft, autoNote) : autoNote;

        return {
          agreementId: item.agreementId,
          masterRow: item.masterRow!,
          expectedExistingDac: item.masterDac,
          targetAmount,
          paymentDate: item.latestPaymentDate || today,
          collectionRows: item.allRows.map((r) => r.row),
          amansRemark,
          remarkMode: draft !== undefined ? ("replace" as const) : ("append" as const),
          collectionCategory: item.collectionCategory,
          masterCategory: item.masterCategory,
        };
      });

      const res = await runCommitBatch({
        data: {
          mode,
          allowOverwriteProtected,
          items: payloadItems,
        },
      });

      toast.success(
        mode === "PUSH_TO_DAC"
          ? `Pushed ${res.updatedMasterRows} Master DAC record(s) (${money(res.totalDacDelta)} net delta) & updated ${res.updatedCollectionRows} Collections remark(s).`
          : `Staged ${res.updatedMasterRows} Provisional DAC record(s) & updated ${res.updatedCollectionRows} Collections remark(s).`,
      );

      setCommitDialog(null);
      setSelectedIds(new Set());
      setRemarkDrafts((prev) => {
        const next = { ...prev };
        for (const item of items) delete next[item.agreementId];
        return next;
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["dac-reconciliation-data"] }),
        qc.invalidateQueries({ queryKey: ["paid-file-master"] }),
        qc.invalidateQueries({ queryKey: ["paid-file-audit-history"] }),
      ]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not commit batch to Master Sheet.",
      );
    } finally {
      setBatchBusy(false);
    }
  }

  function handleExportCsv(sourceItems: DacReconciliationItem[], suffix: string) {
    if (sourceItems.length === 0) {
      toast.info("No rows match the current selection for CSV export.");
      return;
    }
    const itemsWithDrafts = sourceItems.map((item) => ({
      ...item,
      combinedAmansRemarks: remarkDrafts[item.agreementId] ?? item.combinedAmansRemarks,
    }));
    downloadCsv(
      `dac-reconciliation-${suffix}-${todayISO()}.csv`,
      dacReconciliationCsv(itemsWithDrafts),
    );
    toast.success(`Exported ${itemsWithDrafts.length} account(s) to CSV.`);
  }

  const master = dataQuery.data?.master;
  const masterFound = master?.found ?? false;
  const summary = reconciliation.summary;

  return (
    <main className="mx-auto w-full max-w-[1520px] space-y-5 px-3.5 pb-28 pt-4 sm:px-6 lg:px-8">
      {/* Page Header */}
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-wide text-primary">
            Admin · Paid File &amp; Collection Verification
          </p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Collection-to-Master DAC Reconciliation
          </h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
            Compare daily Collections entries against Monthly Master DAC, audit categories
            side-by-side, record verification notes in Aman&apos;s Remarks (Column S), and
            batch-push safe DAC updates without touching sheet formulas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/paid-file"
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border bg-card px-3.5 text-xs font-semibold text-foreground whitespace-nowrap hover:bg-accent"
          >
            Paid File Upload
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-10 shrink-0 whitespace-nowrap"
            disabled={dataQuery.isFetching}
            onClick={() => void dataQuery.refetch()}
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${dataQuery.isFetching ? "animate-spin" : ""}`}
            />
            {dataQuery.isFetching ? "Refreshing..." : "Refresh Data"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-10 shrink-0 whitespace-nowrap"
            disabled={filteredItems.length === 0}
            onClick={() => handleExportCsv(filteredItems, "filtered")}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export Discrepancy CSV
          </Button>
          {masterFound && master?.spreadsheetUrl && (
            <a
              href={master.spreadsheetUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border bg-card px-3.5 text-xs font-semibold text-foreground whitespace-nowrap hover:bg-accent"
            >
              Open Master Sheet
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </header>

      {/* Master Connection & Schema Status Bar */}
      {dataQuery.isLoading ? (
        <section className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          Loading Collections Sheet and active Monthly Master Allocation…
        </section>
      ) : dataQuery.error ? (
        <section className="rounded-xl border border-red-200 bg-red-50/70 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          Could not load reconciliation data:{" "}
          {dataQuery.error instanceof Error ? dataQuery.error.message : "Please retry."}
        </section>
      ) : !masterFound ? (
        <section className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <h2 className="text-sm font-bold">Monthly Master Allocation Sheet Not Found</h2>
              <p className="mt-0.5 text-xs">
                {master?.errorMessage ||
                  "Initialize this month's Mahavtaar Master Allocation spreadsheet first."}
              </p>
            </div>
          </div>
          <Link
            to="/settings"
            className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-amber-600 px-4 text-xs font-semibold text-white whitespace-nowrap hover:bg-amber-700"
          >
            Initialize in Settings →
          </Link>
        </section>
      ) : (
        <section className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="font-semibold text-foreground">{master?.spreadsheetName}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">Tab: {master?.tab}</span>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono font-semibold tabular-nums text-foreground">
              {master?.rows.length.toLocaleString("en-IN")} Master accounts
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>Write guard: Remaining &amp; New Total formulas preserved</span>
            {!master?.columnSupport.provisionalDac && (
              <span className="font-medium text-amber-700 dark:text-amber-400">
                · Add &quot;Provisional DAC&quot; column in Master to stage provisional credits
              </span>
            )}
          </div>
        </section>
      )}

      {/* 1. Summary Metric Cards */}
      <section
        aria-label="Reconciliation summary"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Total Collections in App</p>
          <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-foreground">
            {money(summary.totalCollectionsAmount)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {summary.totalCollectionsCount.toLocaleString("en-IN")} accounts ·{" "}
            {summary.totalCollectionsRows.toLocaleString("en-IN")} entries
          </p>
        </div>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === "missing" ? "all" : "missing")}
          className={`rounded-xl border p-4 text-left transition-colors ${
            statusFilter === "missing"
              ? "border-red-400 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20"
              : "bg-card hover:border-red-300"
          }`}
        >
          <p className="text-xs font-medium text-muted-foreground">Missing from Master DAC</p>
          <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-red-700 dark:text-red-400">
            {money(summary.missingInDacAmount)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {summary.missingInDacCount.toLocaleString("en-IN")} uncredited accounts (DAC = ₹0)
          </p>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === "shortfall" ? "all" : "shortfall")}
          className={`rounded-xl border p-4 text-left transition-colors ${
            statusFilter === "shortfall"
              ? "border-amber-400 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
              : "bg-card hover:border-amber-300"
          }`}
        >
          <p className="text-xs font-medium text-muted-foreground">
            Partially Credited (Shortfall)
          </p>
          <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-amber-700 dark:text-amber-400">
            {money(summary.shortfallGapAmount)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {summary.shortfallCount.toLocaleString("en-IN")} cases · Col{" "}
            {money(summary.shortfallCollectionAmount)} vs DAC{" "}
            {money(summary.shortfallMasterDacAmount)}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === "verified" ? "all" : "verified")}
          className={`rounded-xl border p-4 text-left transition-colors ${
            statusFilter === "verified"
              ? "border-emerald-400 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
              : "bg-card hover:border-emerald-300"
          }`}
        >
          <p className="text-xs font-medium text-muted-foreground">Verified by Aman</p>
          <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {summary.verifiedRowsCount.toLocaleString("en-IN")} rows
          </p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {summary.verifiedAccountsCount.toLocaleString("en-IN")} accounts with verification note
          </p>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === "already_paid" ? "all" : "already_paid")}
          className={`rounded-xl border p-4 text-left transition-colors ${
            statusFilter === "already_paid"
              ? "border-slate-400 bg-muted/60"
              : "bg-card hover:border-slate-300"
          }`}
        >
          <p className="text-xs font-medium text-muted-foreground">Already Paid Excluded</p>
          <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-foreground">
            {money(summary.alreadyPaidAmount)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {summary.alreadyPaidRowCount.toLocaleString("en-IN")} entries ·{" "}
            {includeAlreadyPaid ? "Included in math" : "Isolated from totals"}
          </p>
        </button>
      </section>

      {/* 2. Filter Toolbar */}
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {/* Search */}
          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="dac-search" className="text-xs font-semibold text-muted-foreground">
              Search Loan ID / Customer / Executive / Remarks
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="dac-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search agreement ID, customer, executive or Aman's remarks…"
                className="h-10 pl-9 text-sm"
              />
            </div>
          </div>

          {/* Status Filter */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">Variance Status</Label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="h-10 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses ({reconciliation.items.length})</SelectItem>
                <SelectItem value="actionable">
                  Actionable Discrepancies (
                  {summary.missingInDacCount + summary.shortfallCount + summary.unallocatedCount})
                </SelectItem>
                <SelectItem value="missing">
                  Missing in DAC ({summary.missingInDacCount})
                </SelectItem>
                <SelectItem value="shortfall">Shortfall ({summary.shortfallCount})</SelectItem>
                <SelectItem value="unallocated">
                  Unallocated in Master ({summary.unallocatedCount})
                </SelectItem>
                <SelectItem value="verified">Verified ({summary.verifiedAccountsCount})</SelectItem>
                <SelectItem value="unverified">
                  Unverified ({reconciliation.items.length - summary.verifiedAccountsCount})
                </SelectItem>
                <SelectItem value="matched">
                  Matched / Master Higher ({summary.matchedCount + summary.exceedsCount})
                </SelectItem>
                <SelectItem value="already_paid">
                  Already Paid ({summary.alreadyPaidAccountCount})
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Multi-select Categories Popover */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">
              Categories (Collection / Master)
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-full justify-between px-3 text-xs font-medium"
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <Filter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {selectedColCats.length + selectedMasterCats.length === 0
                      ? "All Categories"
                      : `${selectedColCats.length} Col · ${selectedMasterCats.length} Master`}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 space-y-3 p-3.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-foreground">Filter by Category</p>
                  {(selectedColCats.length > 0 || selectedMasterCats.length > 0) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedColCats([]);
                        setSelectedMasterCats([]);
                      }}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                  <p className="text-[11px] font-semibold text-muted-foreground">
                    Collection Categories (Col T / Bucket)
                  </p>
                  {reconciliation.collectionCategoryOptions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">None found</p>
                  ) : (
                    reconciliation.collectionCategoryOptions.map((cat) => (
                      <label
                        key={`col-${cat}`}
                        className="flex cursor-pointer items-center gap-2 py-0.5 text-xs"
                      >
                        <Checkbox
                          checked={selectedColCats.includes(cat)}
                          onCheckedChange={() =>
                            toggleCategoryChip(selectedColCats, setSelectedColCats, cat)
                          }
                        />
                        <span className="truncate">{cat}</span>
                      </label>
                    ))
                  )}
                </div>

                <div className="border-t pt-2.5 max-h-40 space-y-1.5 overflow-y-auto pr-1">
                  <p className="text-[11px] font-semibold text-muted-foreground">
                    Master / Paid File Categories
                  </p>
                  {reconciliation.masterCategoryOptions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">None loaded</p>
                  ) : (
                    reconciliation.masterCategoryOptions.map((cat) => (
                      <label
                        key={`mst-${cat}`}
                        className="flex cursor-pointer items-center gap-2 py-0.5 text-xs"
                      >
                        <Checkbox
                          checked={selectedMasterCats.includes(cat)}
                          onCheckedChange={() =>
                            toggleCategoryChip(selectedMasterCats, setSelectedMasterCats, cat)
                          }
                        />
                        <span className="truncate">{cat}</span>
                      </label>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Executive Filter */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">Executive</Label>
            <Select value={executiveFilter} onValueChange={setExecutiveFilter}>
              <SelectTrigger className="h-10 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Executives</SelectItem>
                {reconciliation.executiveOptions.map((exec) => (
                  <SelectItem key={exec} value={exec}>
                    {exec}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Payment Date Range */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="dac-from" className="text-xs font-semibold text-muted-foreground">
                From Date
              </Label>
              <Input
                id="dac-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-10 px-2 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dac-to" className="text-xs font-semibold text-muted-foreground">
                To Date
              </Label>
              <Input
                id="dac-to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="h-10 px-2 text-xs"
              />
            </div>
          </div>
        </div>

        {/* Toggle Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <div className="flex flex-wrap items-center gap-5">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
              <Switch checked={includeAlreadyPaid} onCheckedChange={setIncludeAlreadyPaid} />
              <span>Include Already Paid rows in active totals</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
              <Switch checked={categoryMismatchOnly} onCheckedChange={setCategoryMismatchOnly} />
              <span>Compare mismatched categories only</span>
            </label>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">
              Showing {filteredItems.length.toLocaleString("en-IN")} of{" "}
              {reconciliation.items.length.toLocaleString("en-IN")} accounts
            </span>
            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-xs"
                onClick={resetFilters}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Reset
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* 3. Batch Action Bar */}
      {selectedItems.length > 0 && (
        <section
          aria-label="Batch actions"
          className="sticky top-[68px] z-20 flex flex-col gap-3 rounded-xl border border-primary/40 bg-card/95 p-3.5 shadow-md backdrop-blur sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-bold text-foreground tabular-nums">
              {selectedItems.length} account(s) selected
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono tabular-nums text-foreground">
              Collection{" "}
              {money(selectedItems.reduce((sum, item) => sum + item.collectionAmount, 0))}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono font-semibold tabular-nums text-red-700 dark:text-red-400">
              Gap {money(selectedItems.reduce((sum, item) => sum + item.gapAmount, 0))}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={batchBusy}
              onClick={() => void handleBatchVerifyRemarks()}
              className="min-h-9 whitespace-nowrap text-xs"
            >
              {batchBusy ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              )}
              Verify Selected &amp; Update Aman&apos;s Remarks
            </Button>

            <Button
              type="button"
              size="sm"
              disabled={batchBusy || selectedPushEligible.length === 0 || !masterFound}
              onClick={() => openCommitDialog("PUSH_TO_DAC", selectedPushEligible)}
              className="min-h-9 whitespace-nowrap text-xs"
            >
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
              Batch Push Verified Amounts to Master DAC ({selectedPushEligible.length})
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={
                batchBusy ||
                selectedPushEligible.length === 0 ||
                !master?.columnSupport.provisionalDac
              }
              onClick={() => openCommitDialog("SET_PROVISIONAL", selectedPushEligible)}
              className="min-h-9 whitespace-nowrap text-xs"
            >
              <Clock className="mr-1.5 h-3.5 w-3.5" />
              Set Provisional ({selectedPushEligible.length})
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => handleExportCsv(selectedItems, "selected")}
              className="min-h-9 whitespace-nowrap text-xs"
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export Selected CSV
            </Button>
          </div>
        </section>
      )}

      {/* 4. Reconciliation Data Table */}
      <section className="overflow-hidden rounded-xl border bg-card">
        {filteredItems.length === 0 ? (
          <div className="space-y-3 p-10 text-center">
            <p className="text-sm font-semibold text-foreground">
              {reconciliation.items.length === 0
                ? "No collection entries found in the active Collections sheet."
                : "No accounts match your active filters."}
            </p>
            {hasActiveFilters && (
              <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
                Clear All Filters
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Mobile Cards (Android-first responsive layout) */}
            <div className="divide-y md:hidden">
              {filteredItems.map((item) => {
                const badge = varianceBadge(item.varianceStatus);
                const draftRemark = remarkDrafts[item.agreementId] ?? item.combinedAmansRemarks;
                const remarkDirty =
                  remarkDrafts[item.agreementId] !== undefined &&
                  remarkDrafts[item.agreementId] !== item.combinedAmansRemarks;
                const isSelected = selectedIds.has(item.agreementId);
                const canPushMaster =
                  masterFound &&
                  item.masterRow !== null &&
                  !item.hasDuplicateMaster &&
                  item.varianceStatus !== "ALREADY_PAID_EXCLUDED" &&
                  item.collectionAmount > 0;

                return (
                  <article key={item.agreementId} className="space-y-3 p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) =>
                            toggleRowSelection(item.agreementId, Boolean(checked))
                          }
                          aria-label={`Select ${item.agreementId}`}
                          className="mt-1"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-mono text-sm font-bold text-foreground">
                              {item.agreementId}
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleCopyLoanId(item.agreementId)}
                              aria-label={`Copy ${item.agreementId}`}
                              className="rounded p-1 text-muted-foreground hover:bg-muted"
                            >
                              {copiedId === item.agreementId ? (
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {item.customerName} · {item.executives.join(", ")}
                          </p>
                        </div>
                      </div>

                      <span
                        className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${badge.surfaceCls}`}
                      >
                        {badge.label}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-2.5 font-mono text-xs tabular-nums">
                      <div>
                        <div className="font-sans text-[10px] text-muted-foreground">
                          Collection
                        </div>
                        <div className="font-bold text-foreground">
                          {money(item.collectionAmount)}
                        </div>
                      </div>
                      <div>
                        <div className="font-sans text-[10px] text-muted-foreground">
                          Master DAC
                        </div>
                        <div className="font-semibold text-foreground">{money(item.masterDac)}</div>
                      </div>
                      <div>
                        <div className="font-sans text-[10px] text-muted-foreground">
                          Difference
                        </div>
                        <div className={`font-bold ${badge.textCls}`}>
                          {item.difference > 0 ? "+" : ""}
                          {money(item.difference)}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div>
                        <span className="font-semibold text-foreground">Category:</span> Col{" "}
                        {item.collectionCategory} / Master {item.masterCategory}
                        {item.categoryMismatch && (
                          <span className="ml-1.5 font-semibold text-amber-700 dark:text-amber-400">
                            (Category Mismatch)
                          </span>
                        )}
                      </div>
                      <div>
                        <span className="font-semibold text-foreground">Dates:</span> Pay{" "}
                        {item.latestPaymentDate || "—"} · Alloc {item.allocationDate || "—"}
                        {item.hasAlreadyPaid && (
                          <span className="ml-1.5 font-semibold text-red-700 dark:text-red-400">
                            · Already Paid ({item.alreadyPaidCount})
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={draftRemark}
                          onChange={(e) =>
                            setRemarkDrafts((prev) => ({
                              ...prev,
                              [item.agreementId]: e.target.value,
                            }))
                          }
                          placeholder="Aman's Remarks (Column S)…"
                          className="h-10 flex-1 text-xs"
                        />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-10 w-10 shrink-0"
                            >
                              <Tag className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel className="text-xs">
                              Fast Verification Tags
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {FAST_REMARK_TAGS.map((tag) => (
                              <DropdownMenuItem
                                key={tag}
                                onClick={() => appendTagToDraft(item, tag)}
                                className="text-xs"
                              >
                                {tag}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {canPushMaster && (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => openCommitDialog("PUSH_TO_DAC", [item])}
                            className="min-h-10 flex-1 text-xs"
                          >
                            Verify &amp; Push to DAC
                          </Button>
                        )}
                        {canPushMaster && master?.columnSupport.provisionalDac && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => openCommitDialog("SET_PROVISIONAL", [item])}
                            className="min-h-10 text-xs"
                          >
                            Set Provisional
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant={remarkDirty ? "default" : "outline"}
                          disabled={savingRowId === item.agreementId}
                          onClick={() => void saveSingleRemark(item)}
                          className="min-h-10 text-xs"
                        >
                          {savingRowId === item.agreementId ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="mr-1 h-3.5 w-3.5" />
                          )}
                          Save Remark
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Desktop High-Density Reconciliation Ledger */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1220px] border-collapse text-left text-xs">
                <thead className="border-b bg-muted/45 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-3">
                      <Checkbox
                        checked={allFilteredSelected}
                        onCheckedChange={(checked) => toggleSelectAll(Boolean(checked))}
                        aria-label="Select all filtered rows"
                      />
                    </th>
                    <th className="px-3 py-3">Loan ID</th>
                    <th className="px-3 py-3">Customer / Executive</th>
                    <th className="px-3 py-3">Category (Col vs Master)</th>
                    <th className="px-3 py-3">Payment &amp; Alloc Date</th>
                    <th className="px-3 py-3 text-right">Collection ₹</th>
                    <th className="px-3 py-3 text-right">Master DAC ₹</th>
                    <th className="px-3 py-3 text-right">Difference / Gap</th>
                    <th className="min-w-[260px] px-3 py-3">Aman&apos;s Remarks (Col S)</th>
                    <th className="px-3 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredItems.map((item) => {
                    const badge = varianceBadge(item.varianceStatus);
                    const draftRemark = remarkDrafts[item.agreementId] ?? item.combinedAmansRemarks;
                    const remarkDirty =
                      remarkDrafts[item.agreementId] !== undefined &&
                      remarkDrafts[item.agreementId] !== item.combinedAmansRemarks;
                    const isSelected = selectedIds.has(item.agreementId);
                    const isExpanded = expandedIds.has(item.agreementId);
                    const canPushMaster =
                      masterFound &&
                      item.masterRow !== null &&
                      !item.hasDuplicateMaster &&
                      item.varianceStatus !== "ALREADY_PAID_EXCLUDED" &&
                      item.collectionAmount > 0;

                    return (
                      <Fragment key={item.agreementId}>
                        <tr className="align-top transition-colors hover:bg-muted/25">
                          <td className="px-3 py-3">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) =>
                                toggleRowSelection(item.agreementId, Boolean(checked))
                              }
                              aria-label={`Select ${item.agreementId}`}
                            />
                          </td>

                          {/* 2. Loan ID */}
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-1">
                              {item.allRows.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => toggleRowExpand(item.agreementId)}
                                  aria-label={`Toggle entries for ${item.agreementId}`}
                                  className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              )}
                              <span className="font-mono font-bold text-foreground">
                                {item.agreementId}
                              </span>
                              <button
                                type="button"
                                onClick={() => void handleCopyLoanId(item.agreementId)}
                                aria-label={`Copy ${item.agreementId}`}
                                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              >
                                {copiedId === item.agreementId ? (
                                  <Check className="h-3 w-3 text-emerald-600" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            </div>
                            <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                              <div>
                                {item.masterRow ? `Master row ${item.masterRow}` : "Not in Master"}
                                {item.allRows.length > 1 ? ` · ${item.allRows.length} entries` : ""}
                              </div>
                              {item.hasDuplicateMaster && (
                                <div className="font-semibold text-red-700 dark:text-red-400">
                                  Duplicate Agreement ID in Master
                                </div>
                              )}
                              {item.hasCollectionConflict && (
                                <div className="font-semibold text-amber-700 dark:text-amber-400">
                                  Unvalidated collection conflict
                                </div>
                              )}
                            </div>
                          </td>

                          {/* 3. Customer / Executive */}
                          <td className="px-3 py-3">
                            <div
                              className="max-w-[175px] truncate font-semibold text-foreground"
                              title={item.customerName}
                            >
                              {item.customerName}
                            </div>
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              {item.executives.join(", ") || "—"}
                            </div>
                          </td>

                          {/* 4. Categories side-by-side */}
                          <td className="px-3 py-3">
                            <div className="space-y-1">
                              <div className="text-[11px]">
                                <span className="font-semibold text-muted-foreground">Col:</span>{" "}
                                <span className="font-medium text-foreground">
                                  {item.collectionCategory}
                                </span>
                              </div>
                              <div className="text-[11px]">
                                <span className="font-semibold text-muted-foreground">Master:</span>{" "}
                                <span className="font-medium text-foreground">
                                  {item.masterCategory}
                                </span>
                                {item.masterBucket &&
                                  item.masterBucket.toLowerCase() !==
                                    item.masterCategory.toLowerCase() && (
                                    <span className="text-muted-foreground">
                                      {" "}
                                      / {item.masterBucket}
                                    </span>
                                  )}
                              </div>
                              {item.categoryMismatch && (
                                <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                                  Category differs
                                </div>
                              )}
                            </div>
                          </td>

                          {/* 5. Payment & Alloc Date */}
                          <td className="px-3 py-3 font-mono text-[11px] tabular-nums">
                            <div className="text-foreground">
                              Pay:{" "}
                              {item.earliestPaymentDate === item.latestPaymentDate
                                ? item.latestPaymentDate || "—"
                                : `${item.earliestPaymentDate} .. ${item.latestPaymentDate}`}
                            </div>
                            <div className="mt-0.5 text-muted-foreground">
                              Alloc: {item.allocationDate || "—"}
                            </div>
                            {item.hasAlreadyPaid && (
                              <div className="mt-0.5 font-sans font-semibold text-red-700 dark:text-red-400">
                                Already Paid ({item.alreadyPaidCount} ·{" "}
                                {money(item.alreadyPaidAmount)})
                              </div>
                            )}
                          </td>

                          {/* 6. Collection Amount */}
                          <td className="px-3 py-3 text-right font-mono tabular-nums">
                            <div className="font-bold text-foreground">
                              {money(item.collectionAmount)}
                            </div>
                            {item.hasAlreadyPaid && !includeAlreadyPaid && (
                              <div className="mt-0.5 font-sans text-[10px] text-muted-foreground">
                                Excl. {money(item.alreadyPaidAmount)} AP
                              </div>
                            )}
                          </td>

                          {/* 7. Master DAC */}
                          <td className="px-3 py-3 text-right font-mono tabular-nums">
                            <div className="font-semibold text-foreground">
                              {money(item.masterDac)}
                            </div>
                            <div className="mt-0.5 font-sans text-[10px] text-muted-foreground">
                              {item.dacSource || (item.masterRow ? "UNSET" : "—")}
                              {item.provisionalDac !== null && item.provisionalDac > 0
                                ? ` · Prov ${money(item.provisionalDac)}`
                                : ""}
                            </div>
                          </td>

                          {/* 8. Difference / Gap */}
                          <td className="px-3 py-3 text-right">
                            <div className={`font-mono font-bold tabular-nums ${badge.textCls}`}>
                              {item.difference > 0 ? "+" : ""}
                              {money(item.difference)}
                            </div>
                            <div className="mt-1 flex justify-end">
                              <span
                                className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badge.surfaceCls}`}
                              >
                                {badge.label}
                              </span>
                            </div>
                          </td>

                          {/* 9. Aman's Remarks */}
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-1">
                              <Input
                                value={draftRemark}
                                onChange={(e) =>
                                  setRemarkDrafts((prev) => ({
                                    ...prev,
                                    [item.agreementId]: e.target.value,
                                  }))
                                }
                                placeholder="Add Aman's remark…"
                                className="h-8 flex-1 text-xs"
                              />
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8 shrink-0"
                                    title="Insert quick verification tag"
                                  >
                                    <Tag className="h-3.5 w-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuLabel className="text-xs">
                                    Quick Remarks Tags
                                  </DropdownMenuLabel>
                                  <DropdownMenuSeparator />
                                  {FAST_REMARK_TAGS.map((tag) => (
                                    <DropdownMenuItem
                                      key={tag}
                                      onClick={() => appendTagToDraft(item, tag)}
                                      className="text-xs"
                                    >
                                      {tag}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                            <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                              <span>
                                {item.isVerifiedByAman ? (
                                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                    Verified in Col S
                                  </span>
                                ) : (
                                  "Not yet verified"
                                )}
                              </span>
                              <span>Rows: {item.allRows.map((r) => r.row).join(", ")}</span>
                            </div>
                          </td>

                          {/* 10. Action */}
                          <td className="px-3 py-3 text-right">
                            <div className="flex flex-col items-end gap-1.5">
                              {canPushMaster && (
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => openCommitDialog("PUSH_TO_DAC", [item])}
                                  className="h-8 whitespace-nowrap px-2.5 text-[11px]"
                                >
                                  Verify &amp; Push to DAC
                                </Button>
                              )}
                              <div className="flex items-center gap-1">
                                {canPushMaster && master?.columnSupport.provisionalDac && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openCommitDialog("SET_PROVISIONAL", [item])}
                                    className="h-7 whitespace-nowrap px-2 text-[11px]"
                                  >
                                    Set Provisional
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={remarkDirty ? "secondary" : "ghost"}
                                  disabled={savingRowId === item.agreementId}
                                  onClick={() => void saveSingleRemark(item)}
                                  className="h-7 whitespace-nowrap px-2 text-[11px]"
                                >
                                  {savingRowId === item.agreementId ? "Saving…" : "Update Remarks"}
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-muted/20">
                            <td colSpan={10} className="px-6 py-3">
                              <div className="space-y-1.5">
                                <p className="text-[11px] font-bold text-foreground">
                                  Collections Entries for {item.agreementId}
                                </p>
                                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                                  {item.allRows.map((entry) => (
                                    <div
                                      key={entry.row}
                                      className="rounded-lg border bg-card px-3 py-2 text-[11px]"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-mono font-semibold text-foreground">
                                          Row {entry.row} · {entry.date}
                                        </span>
                                        <span className="font-mono font-bold tabular-nums text-foreground">
                                          {money(entry.amount)}
                                        </span>
                                      </div>
                                      <div className="mt-0.5 text-muted-foreground">
                                        {entry.executive} ·{" "}
                                        {entry.allocationCategory ||
                                          entry.bucket ||
                                          "Uncategorized"}
                                        {entry.alreadyPaid ? " · Already Paid" : ""}
                                      </div>
                                      {entry.amansRemarks && (
                                        <div className="mt-1 truncate text-[10px] text-foreground">
                                          Remark: {entry.amansRemarks}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* 5. Recent Reconciliation Audit Log */}
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-bold text-foreground">
            Recent DAC Reconciliation Audit Trail
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Logged to <span className="font-mono">DAC_Reconciliation_Audit</span> (with SHA-256
            batch chaining in <span className="font-mono">Paid_File_Audit_Log</span>).
          </p>
        </div>
        {!dataQuery.data?.auditEntries?.length ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            No DAC reconciliation commits recorded for this month yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-xs">
              <thead className="border-b bg-muted/40 text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Timestamp (IST)</th>
                  <th className="px-4 py-2.5">Loan ID</th>
                  <th className="px-4 py-2.5 text-right">Old DAC</th>
                  <th className="px-4 py-2.5 text-right">New DAC / Prov</th>
                  <th className="px-4 py-2.5">Categories (Col / Master)</th>
                  <th className="px-4 py-2.5">Aman&apos;s Remark</th>
                  <th className="px-4 py-2.5">Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {dataQuery.data.auditEntries.map((entry) => (
                  <tr key={entry.row} className="hover:bg-muted/20">
                    <td className="px-4 py-2 font-mono tabular-nums text-muted-foreground">
                      {entry.timestamp}
                    </td>
                    <td className="px-4 py-2 font-mono font-semibold text-foreground">
                      {entry.loanId}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {money(entry.oldDac)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums">
                      {entry.provisionalDac !== null
                        ? `Prov ${money(entry.provisionalDac)}`
                        : money(entry.newDac)}
                    </td>
                    <td className="px-4 py-2 text-[11px] text-muted-foreground">
                      {entry.collectionCategory || "—"} / {entry.masterCategory || "—"}
                    </td>
                    <td className="max-w-[300px] truncate px-4 py-2" title={entry.amansRemark}>
                      {entry.amansRemark || "—"}
                    </td>
                    <td className="px-4 py-2">{entry.adminName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Batch / Single Master DAC Commit Confirmation Dialog */}
      <Dialog open={commitDialog !== null} onOpenChange={(open) => !open && setCommitDialog(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {commitDialog?.mode === "PUSH_TO_DAC"
                ? "Confirm Verify & Push to Master DAC"
                : "Confirm Stage Provisional DAC in Master"}
            </DialogTitle>
            <DialogDescription>
              {commitDialog?.mode === "PUSH_TO_DAC"
                ? `Updates DAC, sets DAC Source = "CORRECTED" and Is Corrected = TRUE in ${master?.spreadsheetName ?? "Master"}, and writes audit remarks to Collections Column S. Formula columns (Remaining / New Total) are never modified.`
                : `Writes staged amounts to Master Provisional DAC and logs verification notes to Collections Column S without altering confirmed DAC or formulas.`}
            </DialogDescription>
          </DialogHeader>

          {commitDialog && (
            <div className="space-y-3">
              {commitDialog.items.some((item) => item.isMasterProtected) &&
                commitDialog.mode === "PUSH_TO_DAC" && (
                  <label className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100">
                    <Checkbox
                      checked={allowOverwriteProtected}
                      onCheckedChange={(checked) => setAllowOverwriteProtected(Boolean(checked))}
                      className="mt-0.5"
                    />
                    <span>
                      <strong>Protected rows detected:</strong> Some selected Master records already
                      have <span className="font-mono">DAC Source = MANUAL / CORRECTED</span>. Check
                      to confirm intentionally updating them.
                    </span>
                  </label>
                )}

              <div className="max-h-72 overflow-y-auto rounded-lg border">
                <table className="w-full text-left text-xs">
                  <thead className="border-b bg-muted/50 text-[11px] uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Loan ID</th>
                      <th className="px-3 py-2 text-right">Current DAC</th>
                      <th className="px-3 py-2 text-right">
                        {commitDialog.mode === "PUSH_TO_DAC" ? "Target DAC (₹)" : "Provisional (₹)"}
                      </th>
                      <th className="px-3 py-2">Collections Rows</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {commitDialog.items.map((item) => (
                      <tr key={item.agreementId}>
                        <td className="px-3 py-2">
                          <div className="font-mono font-bold">{item.agreementId}</div>
                          <div className="text-[10px] text-muted-foreground">
                            Master row {item.masterRow}
                            {item.isMasterProtected ? ` · ${item.dacSource || "CORRECTED"}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {money(item.masterDac)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={targetAmountOverrides[item.agreementId] ?? ""}
                            onChange={(e) =>
                              setTargetAmountOverrides((prev) => ({
                                ...prev,
                                [item.agreementId]: e.target.value,
                              }))
                            }
                            className="ml-auto h-8 w-28 text-right font-mono text-xs tabular-nums"
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                          S{item.allRows.map((r) => r.row).join(", S")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {commitDialog.items.some((i) => i.hasCollectionConflict) && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    One or more selected Loan IDs have unvalidated duplicate conflict entries in
                    Collections. Verify receipts before confirming.
                  </span>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={batchBusy}
              onClick={() => setCommitDialog(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                batchBusy ||
                !commitDialog ||
                (commitDialog.mode === "PUSH_TO_DAC" &&
                  commitDialog.items.some((item) => item.isMasterProtected) &&
                  !allowOverwriteProtected)
              }
              onClick={() => void handleConfirmCommit()}
            >
              {batchBusy ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Writing Batch…
                </>
              ) : commitDialog?.mode === "PUSH_TO_DAC" ? (
                `Commit ${commitDialog.items.length} Record(s) to Master DAC`
              ) : (
                `Stage ${commitDialog?.items.length ?? 0} Provisional DAC`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
