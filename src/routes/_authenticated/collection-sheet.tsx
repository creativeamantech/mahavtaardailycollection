import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "@/lib/auth.functions";
import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Search,
  RefreshCw,
  X,
  Download,
  Eye,
  CalendarRange,
  CheckCircle2,
  Filter,
  IndianRupee,
  Layers,
  AlertTriangle,
} from "lucide-react";

import { getCollections } from "@/lib/mahavtaar.functions";
import { getExcludedLoanNumbers } from "@/lib/excluded-loans.functions";
import {
  normaliseLoanId,
  summarizeCollectionSheetPos,
  type CollectionRow,
  type LoanSummary,
} from "@/lib/loans";
import { formatAmount, todayISO } from "@/lib/executives";
import { sanitizeCsvCell } from "@/lib/export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/collection-sheet")({
  loader: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData({
      queryKey: ["auth-session"],
      queryFn: () => getCurrentSession(),
      staleTime: 30_000,
    });
    if (!session) return null;
    return Promise.all([
      context.queryClient.ensureQueryData({
        queryKey: ["collections"],
        queryFn: () => getCollections(),
        staleTime: 30_000,
      }),
      context.queryClient.ensureQueryData({
        queryKey: ["excluded-loan-numbers"],
        queryFn: () => getExcludedLoanNumbers(),
        staleTime: 30_000,
      }),
    ]);
  },
  head: () => ({
    meta: [
      { title: "Collection Sheet — Mahavtaar Daily Collection" },
      {
        name: "description",
        content:
          "Read-only view of the complete Collections sheet with Date-Range POS Cleared tracking and Loan Number search.",
      },
    ],
  }),
  component: CollectionSheetPage,
});

type Collection = {
  row?: number;
  executive?: string;
  loanId?: string;
  amount?: number;
  date?: string;
  time?: string;
  createdAt?: string;
  status?: string;
  entryDate?: string;
  entryType?: string;
  settlement?: boolean;
  settlementType?: string;
  foreclosureEntry?: boolean;
  bucket?: string;
  city?: string;
  emiAmount?: number | null;
  pos?: number | null;
  foreclosure?: number | null;
  receiptLinks?: string[];
  remark?: string;
  actualId?: string;
  amansRemarks?: string;
  allocationCategory?: string;
  allocationDate?: string;
  allocationType?: string;
  alreadyPaid?: boolean;
  isValidated?: boolean;
  isConflict?: boolean;
  linkedName?: string;
  portalUrl?: string;
};

type PosStatusFilter = "__all__" | "pos_cleared" | "full_pos_paid" | "pos_pending";
type ActiveTab = "rows" | "pos_cleared";

const columns: {
  key: keyof Collection;
  label: string;
  render?: (row: Collection) => React.ReactNode;
}[] = [
  { key: "executive", label: "Executive" },
  { key: "loanId", label: "Loan Number" },
  { key: "amount", label: "Amount", render: (r) => formatAmount(Number(r.amount ?? 0)) },
  { key: "date", label: "Payment Date" },
  { key: "time", label: "Time" },
  { key: "createdAt", label: "Created At" },
  { key: "status", label: "Status" },
  { key: "entryDate", label: "Entry Date" },
  { key: "entryType", label: "Entry Type" },
  { key: "settlementType", label: "Settlement" },
  { key: "bucket", label: "Bucket" },
  { key: "city", label: "City" },
  {
    key: "emiAmount",
    label: "EMI Amount",
    render: (r) => (r.emiAmount == null ? "" : formatAmount(r.emiAmount)),
  },
  {
    key: "pos",
    label: "Principal Outstanding",
    render: (r) => (r.pos == null ? "" : formatAmount(r.pos)),
  },
  {
    key: "foreclosure",
    label: "Approx. Foreclosure",
    render: (r) => (r.foreclosure == null ? "" : formatAmount(r.foreclosure)),
  },
  {
    key: "receiptLinks",
    label: "Receipt",
    render: (r) =>
      (r.receiptLinks ?? []).map((url, i) => (
        <a
          key={url + i}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline"
        >
          Open {i + 1}
        </a>
      )),
  },
  { key: "remark", label: "Remark" },
  { key: "actualId", label: "Active ID" },
  { key: "amansRemarks", label: "Aman's Remarks" },
  { key: "allocationCategory", label: "Allocation Category" },
  { key: "allocationDate", label: "Allocation Date" },
  { key: "allocationType", label: "Allocation Type" },
  { key: "isValidated", label: "Validation", render: (r) => (r.isValidated ? "VALIDATED" : "") },
  {
    key: "linkedName",
    label: "Linked Name",
    render: (r) =>
      r.portalUrl ? (
        <a href={r.portalUrl} target="_blank" rel="noreferrer" className="text-primary underline">
          {r.linkedName || "Open"}
        </a>
      ) : (
        (r.linkedName ?? "")
      ),
  },
];

function displayValue(row: Collection, column: (typeof columns)[number]) {
  if (column.render) return column.render(row);
  const value = row[column.key];
  return value == null ? "" : String(value);
}

function dateFilterKey(value: string | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1] ?? "";
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy)
    return `${dmy[3] ?? ""}-${(dmy[2] ?? "").padStart(2, "0")}-${(dmy[1] ?? "").padStart(2, "0")}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime())
    ? ""
    : `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function shiftIsoDays(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function getPreviousMonthRange(today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  if (!y || !m) return { from: today, to: today };
  const lastDayPrevMonth = new Date(Date.UTC(y, m - 1, 0));
  const year = lastDayPrevMonth.getUTCFullYear();
  const month = String(lastDayPrevMonth.getUTCMonth() + 1).padStart(2, "0");
  const endDay = String(lastDayPrevMonth.getUTCDate()).padStart(2, "0");
  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${endDay}`,
  };
}

function toLoanCollectionRow(row: Collection): CollectionRow {
  return {
    executive: String(row.executive ?? ""),
    loanId: String(row.loanId ?? ""),
    amount: Number(row.amount ?? 0),
    date: dateFilterKey(row.date) || String(row.date ?? ""),
    entryType: row.entryType ?? "",
    settlement: row.settlement ?? row.settlementType === "Settlement",
    settlementType: row.settlementType,
    foreclosureEntry: row.foreclosureEntry ?? row.settlementType === "Foreclosure",
    bucket: row.bucket ?? "",
    city: row.city ?? "",
    emiAmount: row.emiAmount ?? null,
    pos: row.pos ?? null,
    foreclosure: row.foreclosure ?? null,
  };
}

function posBadgeForLoan(
  isExcluded: boolean,
  loan: LoanSummary | undefined,
): { label: string; className: string } {
  if (isExcluded) {
    return {
      label: "Excluded",
      className: "bg-stone-100 text-stone-600 border border-stone-200",
    };
  }
  if (!loan) {
    return {
      label: "POS Pending",
      className: "bg-slate-100 text-slate-700 border border-slate-200",
    };
  }
  if (loan.mainPaid) {
    return {
      label: `POS Cleared (${loan.status})`,
      className: "bg-emerald-50 text-emerald-800 border border-emerald-200",
    };
  }
  if (loan.posPaid) {
    return {
      label: "Full POS Covered",
      className: "bg-sky-50 text-sky-800 border border-sky-200",
    };
  }
  return {
    label: "POS Pending",
    className: "bg-amber-50 text-amber-900 border border-amber-200",
  };
}

function uniqueOptions(rows: Collection[], extract: (row: Collection) => string | undefined) {
  return [...new Set(rows.map((row) => String(extract(row) ?? "").trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, "en-IN", { numeric: true }),
  );
}

function CollectionSheetPage() {
  const fetchCollections = useServerFn(getCollections);
  const fetchExcludedLoanNumbers = useServerFn(getExcludedLoanNumbers);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [visibleCount, setVisibleCount] = useState(50);
  const [executiveFilter, setExecutiveFilter] = useState("__all__");
  const [bucketFilter, setBucketFilter] = useState("__all__");
  const [cityFilter, setCityFilter] = useState("__all__");
  const [categoryFilter, setCategoryFilter] = useState("__all__");
  const [allocationTypeFilter, setAllocationTypeFilter] = useState("__all__");
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [posStatusFilter, setPosStatusFilter] = useState<PosStatusFilter>("__all__");
  const [activeTab, setActiveTab] = useState<ActiveTab>("pos_cleared");
  const [selectedRecord, setSelectedRecord] = useState<Collection | null>(null);
  const [selectedLoanDetail, setSelectedLoanDetail] = useState<LoanSummary | null>(null);
  const [paymentDateFrom, setPaymentDateFrom] = useState("");
  const [paymentDateTo, setPaymentDateTo] = useState("");
  const [entryDateFrom, setEntryDateFrom] = useState("");
  const [entryDateTo, setEntryDateTo] = useState("");

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["collections"],
    queryFn: async () => {
      const rows = await fetchCollections();
      if (!Array.isArray(rows)) throw new Error("Unable to load the complete Collections sheet.");
      return rows as Collection[];
    },
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const allRows = useMemo(() => data ?? [], [data]);
  const {
    data: excludedRecords = [],
    isLoading: isExcludedLoading,
    error: excludedError,
  } = useQuery({
    queryKey: ["excluded-loan-numbers"],
    queryFn: async () => {
      const records = await fetchExcludedLoanNumbers();
      return Array.isArray(records) ? records : [];
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Active Excluded Loan Numbers are the sole source of truth for Small Cases.
  // Never infer exclusion from either EMI amount or the collection payment amount.
  const activeExcludedIds = useMemo(
    () =>
      new Set(
        excludedRecords
          .filter(
            (record) =>
              String(record.status ?? "Active")
                .trim()
                .toLowerCase() === "active",
          )
          .map((record) => normaliseLoanId(record.loanNumber))
          .filter(Boolean),
      ),
    [excludedRecords],
  );

  // Bulk IDs may be separated by newlines, commas, semicolons, or spaces.
  const requestedLoanIds = useMemo(
    () => [
      ...new Set(
        search
          .split(/[\s,;]+/)
          .map(normaliseLoanId)
          .filter(Boolean),
      ),
    ],
    [search],
  );
  const isBulkSearch = requestedLoanIds.length > 1;
  const normalizedQuery = normaliseLoanId(deferredSearch);

  const executives = useMemo(() => uniqueOptions(allRows, (r) => r.executive), [allRows]);
  const buckets = useMemo(() => uniqueOptions(allRows, (r) => r.bucket), [allRows]);
  const cities = useMemo(() => uniqueOptions(allRows, (r) => r.city), [allRows]);
  const categories = useMemo(() => uniqueOptions(allRows, (r) => r.allocationCategory), [allRows]);
  const allocationTypes = useMemo(() => uniqueOptions(allRows, (r) => r.allocationType), [allRows]);

  const statusFilteredRows = useMemo(
    () =>
      allRows.filter((row) => {
        const rowLoanId = normaliseLoanId(row.loanId);
        const matchesLoan =
          !deferredSearch.trim() ||
          (isBulkSearch
            ? requestedLoanIds.includes(rowLoanId)
            : rowLoanId.includes(normalizedQuery));
        const matchesExecutive =
          executiveFilter === "__all__" || String(row.executive ?? "").trim() === executiveFilter;
        const matchesBucket =
          bucketFilter === "__all__" || String(row.bucket ?? "").trim() === bucketFilter;
        const matchesCity =
          cityFilter === "__all__" || String(row.city ?? "").trim() === cityFilter;
        const matchesCategory =
          categoryFilter === "__all__" ||
          String(row.allocationCategory ?? "").trim() === categoryFilter;
        const matchesAllocationType =
          allocationTypeFilter === "__all__" ||
          String(row.allocationType ?? "").trim() === allocationTypeFilter;

        const rowStatus = row.alreadyPaid
          ? "Already Paid"
          : activeExcludedIds.has(rowLoanId)
            ? "Small Case"
            : row.isConflict
              ? "Duplicate / Conflict"
              : "Collection";
        const matchesStatus = statusFilter === "__all__" || rowStatus === statusFilter;

        const paymentDate = dateFilterKey(row.date);
        const entryDate = dateFilterKey(row.entryDate);
        const matchesPaymentDate =
          (!paymentDateFrom || (paymentDate && paymentDate >= paymentDateFrom)) &&
          (!paymentDateTo || (paymentDate && paymentDate <= paymentDateTo));
        const matchesEntryDate =
          (!entryDateFrom || (entryDate && entryDate >= entryDateFrom)) &&
          (!entryDateTo || (entryDate && entryDate <= entryDateTo));

        return (
          matchesLoan &&
          matchesExecutive &&
          matchesBucket &&
          matchesCity &&
          matchesCategory &&
          matchesAllocationType &&
          matchesStatus &&
          matchesPaymentDate &&
          matchesEntryDate
        );
      }),
    [
      allRows,
      deferredSearch,
      isBulkSearch,
      requestedLoanIds,
      normalizedQuery,
      executiveFilter,
      bucketFilter,
      cityFilter,
      categoryFilter,
      allocationTypeFilter,
      statusFilter,
      activeExcludedIds,
      paymentDateFrom,
      paymentDateTo,
      entryDateFrom,
      entryDateTo,
    ],
  );

  // Evaluate POS clearance on the eligible portion of statusFilteredRows so
  // multi-payment loans aggregate cleanly without double-counting POS before
  // applying the optional POS Status filter.
  const baseEligiblePosSummary = useMemo(() => {
    const eligibleBase = statusFilteredRows.filter(
      (row) =>
        !row.alreadyPaid && !activeExcludedIds.has(normaliseLoanId(row.loanId)) && !row.isConflict,
    );
    return summarizeCollectionSheetPos(eligibleBase.map(toLoanCollectionRow));
  }, [statusFilteredRows, activeExcludedIds]);

  const rows = useMemo(() => {
    if (posStatusFilter === "__all__") return statusFilteredRows;
    return statusFilteredRows.filter((row) => {
      const id = normaliseLoanId(row.loanId);
      const isExcluded = !!row.alreadyPaid || activeExcludedIds.has(id) || !!row.isConflict;
      if (isExcluded) return false;
      const loan = baseEligiblePosSummary.loanById.get(id);
      if (!loan) return false;
      if (posStatusFilter === "pos_cleared") return loan.mainPaid;
      if (posStatusFilter === "full_pos_paid") return loan.posPaid;
      if (posStatusFilter === "pos_pending") return !loan.mainPaid && !loan.posPaid;
      return true;
    });
  }, [statusFilteredRows, posStatusFilter, activeExcludedIds, baseEligiblePosSummary]);

  const visibleRows = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount]);

  // Apply the existing reporting rules to the currently visible/search-filtered rows.
  // Category priority avoids double-counting excluded rows in the summary.
  const summary = useMemo(() => {
    const alreadyPaidRows = rows.filter((row) => !!row.alreadyPaid);
    const smallCaseRows = rows.filter(
      (row) => !row.alreadyPaid && activeExcludedIds.has(normaliseLoanId(row.loanId)),
    );
    const duplicateRows = rows.filter(
      (row) =>
        !row.alreadyPaid && !activeExcludedIds.has(normaliseLoanId(row.loanId)) && !!row.isConflict,
    );
    const eligibleRows = rows.filter(
      (row) =>
        !row.alreadyPaid && !activeExcludedIds.has(normaliseLoanId(row.loanId)) && !row.isConflict,
    );
    const posSummary = summarizeCollectionSheetPos(eligibleRows.map(toLoanCollectionRow));
    return {
      eligibleRows,
      eligibleAmount: eligibleRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
      uniqueLoans: posSummary.loans.length,
      alreadyPaidCount: alreadyPaidRows.length,
      alreadyPaidAmount: alreadyPaidRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
      smallCaseCount: smallCaseRows.length,
      smallCaseAmount: smallCaseRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
      duplicateCount: duplicateRows.length,
      duplicateAmount: duplicateRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
      posSummary,
    };
  }, [rows, activeExcludedIds]);

  const { posSummary } = summary;
  const totalsReady = !isExcludedLoading && !excludedError;

  const notFoundLoanIds = useMemo(() => {
    if (!isBulkSearch) return [];
    const found = new Set(allRows.map((row) => normaliseLoanId(row.loanId)));
    return requestedLoanIds.filter((id) => !found.has(id));
  }, [allRows, isBulkSearch, requestedLoanIds]);

  const activeFilterCount = [
    search.trim() !== "",
    executiveFilter !== "__all__",
    bucketFilter !== "__all__",
    cityFilter !== "__all__",
    categoryFilter !== "__all__",
    allocationTypeFilter !== "__all__",
    statusFilter !== "__all__",
    posStatusFilter !== "__all__",
    paymentDateFrom !== "",
    paymentDateTo !== "",
    entryDateFrom !== "",
    entryDateTo !== "",
  ].filter(Boolean).length;

  const today = todayISO();
  const yesterday = shiftIsoDays(today, -1);
  const last7From = shiftIsoDays(today, -6);
  const thisMonthFrom = `${today.slice(0, 7)}-01`;
  const lastMonthRange = getPreviousMonthRange(today);

  const isPresetActive = (from: string, to: string) =>
    paymentDateFrom === from && paymentDateTo === to && !entryDateFrom && !entryDateTo;

  function applyPaymentPreset(from: string, to: string) {
    setPaymentDateFrom(from);
    setPaymentDateTo(to);
    setEntryDateFrom("");
    setEntryDateTo("");
    setVisibleCount(50);
  }

  function clearAllFilters() {
    setSearch("");
    setExecutiveFilter("__all__");
    setBucketFilter("__all__");
    setCityFilter("__all__");
    setCategoryFilter("__all__");
    setAllocationTypeFilter("__all__");
    setStatusFilter("__all__");
    setPosStatusFilter("__all__");
    setPaymentDateFrom("");
    setPaymentDateTo("");
    setEntryDateFrom("");
    setEntryDateTo("");
    setVisibleCount(50);
  }

  const activeDateRangeLabel = useMemo(() => {
    const parts: string[] = [];
    if (paymentDateFrom || paymentDateTo) {
      parts.push(`Payment: ${paymentDateFrom || "Start"} → ${paymentDateTo || "Latest"}`);
    }
    if (entryDateFrom || entryDateTo) {
      parts.push(`Entry: ${entryDateFrom || "Start"} → ${entryDateTo || "Latest"}`);
    }
    return parts.length > 0 ? parts.join(" · ") : "All Dates";
  }, [paymentDateFrom, paymentDateTo, entryDateFrom, entryDateTo]);

  function triggerCsvDownload(filename: string, lines: string[]) {
    const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadCsv() {
    const headers = ["#", ...columns.map((column) => column.label), "Paid Flag", "POS Status"];
    const csvValue = (row: Collection, key: keyof Collection): string | number => {
      const value = row[key];
      if (value == null) return "";
      if (key === "receiptLinks") return (row.receiptLinks ?? []).join(" | ");
      if (key === "isValidated") return row.isValidated ? "VALIDATED" : "";
      if (typeof value === "number") return value;
      return String(value);
    };
    const lines = [
      headers.map(sanitizeCsvCell).join(","),
      ...rows.map((row, index) => {
        const id = normaliseLoanId(row.loanId);
        const isExcluded = !!row.alreadyPaid || activeExcludedIds.has(id) || !!row.isConflict;
        const posLabel = posBadgeForLoan(isExcluded, posSummary.loanById.get(id)).label;
        return [
          row.row ?? index + 1,
          ...columns.map((column) => csvValue(row, column.key)),
          row.alreadyPaid ? "Already Paid" : "",
          posLabel,
        ]
          .map(sanitizeCsvCell)
          .join(",");
      }),
    ];
    triggerCsvDownload("collection-sheet.csv", lines);
  }

  function downloadPosClearedCsv() {
    const headers = [
      "Loan Number",
      "Executive",
      "Bucket",
      "City",
      "Principal Outstanding (POS)",
      "Total Collected in Range",
      "Payments Count",
      "Paid EMI Count",
      "Clearance Status",
      "Last Payment Date",
    ];
    const lines = [
      headers.map(sanitizeCsvCell).join(","),
      ...posSummary.clearedLoans.map((loan) =>
        [
          loan.loanId,
          loan.executive,
          loan.bucket,
          loan.city,
          loan.pos ?? 0,
          loan.totalPaid,
          loan.payments,
          loan.paidEmiCount,
          loan.status,
          loan.lastDate,
        ]
          .map(sanitizeCsvCell)
          .join(","),
      ),
    ];
    const dateSuffix =
      paymentDateFrom || paymentDateTo
        ? `-${paymentDateFrom || "start"}-to-${paymentDateTo || "latest"}`
        : "";
    triggerCsvDownload(`collection-sheet-pos-cleared${dateSuffix}.csv`, lines);
  }

  return (
    <main className="mx-auto w-full max-w-[1600px] px-3 pb-20 pt-5 sm:px-5 sm:pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
            Collections &amp; POS Tracker
          </p>
          <h1 className="mt-0.5 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Collection Sheet
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Filter by Payment or Entry date range to inspect eligible collections and Principal
            Outstanding (POS) cleared per unique loan.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {totalsReady && posSummary.clearedLoans.length > 0 && (
            <Button
              variant="outline"
              className="h-10 border-primary/25 bg-card text-primary hover:bg-primary/5"
              onClick={downloadPosClearedCsv}
            >
              <Download className="mr-2 h-4 w-4" />
              POS Cleared CSV
            </Button>
          )}
          <Button
            variant="outline"
            className="h-10"
            onClick={downloadCsv}
            disabled={rows.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Sheet CSV
          </Button>
          <Button
            variant="outline"
            className="h-10"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Filter Console: unified for both Desktop & Android Mobile */}
      <section
        className="mt-5 space-y-4 rounded-2xl border border-border bg-card p-3.5 shadow-sm sm:p-4"
        aria-label="Collection sheet search and filters"
      >
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setVisibleCount(50);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setSearch("");
              }}
              placeholder="Search loan numbers — paste single or multiple IDs separated by lines, commas or spaces"
              aria-label="Search by Loan Number"
              className="h-11 bg-background pl-9 pr-10"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground sm:text-sm">
            <span aria-live="polite" className="font-medium text-foreground">
              Showing {rows.length.toLocaleString("en-IN")} of{" "}
              {allRows.length.toLocaleString("en-IN")} rows
            </span>
            {activeFilterCount > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 text-primary hover:bg-primary/10 hover:text-primary"
                onClick={clearAllFilters}
              >
                <X className="mr-1.5 h-3.5 w-3.5" />
                Reset {activeFilterCount} {activeFilterCount === 1 ? "filter" : "filters"}
              </Button>
            )}
          </div>
        </div>

        {/* Quick Payment Date Presets + From-To Ranges */}
        <div className="rounded-xl border border-border/80 bg-muted/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
              <CalendarRange className="h-3.5 w-3.5" />
              <span>Quick Date Range (Payment Date)</span>
            </div>
            <span className="text-xs font-medium text-muted-foreground">
              {activeDateRangeLabel}
            </span>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {[
              { label: "Today", from: today, to: today },
              { label: "Yesterday", from: yesterday, to: yesterday },
              { label: "Last 7 Days", from: last7From, to: today },
              { label: "This Month", from: thisMonthFrom, to: today },
              { label: "Last Month", from: lastMonthRange.from, to: lastMonthRange.to },
            ].map((preset) => {
              const active = isPresetActive(preset.from, preset.to);
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyPaymentPreset(preset.from, preset.to)}
                  className={
                    "min-h-9 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors " +
                    (active
                      ? "border-primary bg-primary text-primary-foreground shadow-xs"
                      : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent")
                  }
                >
                  {preset.label}
                </button>
              );
            })}
            {(paymentDateFrom || paymentDateTo || entryDateFrom || entryDateTo) && (
              <button
                type="button"
                onClick={() => applyPaymentPreset("", "")}
                className="min-h-9 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                All Dates
              </button>
            )}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5 rounded-lg border border-border/70 bg-card p-2.5">
              <p className="text-xs font-semibold text-foreground">Payment Date Range</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
                  From Date
                  <Input
                    type="date"
                    value={paymentDateFrom}
                    max={paymentDateTo || undefined}
                    onChange={(event) => {
                      setPaymentDateFrom(event.target.value);
                      setVisibleCount(50);
                    }}
                    className="h-10 bg-background"
                    aria-label="Payment date from"
                  />
                </label>
                <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
                  To Date
                  <Input
                    type="date"
                    value={paymentDateTo}
                    min={paymentDateFrom || undefined}
                    onChange={(event) => {
                      setPaymentDateTo(event.target.value);
                      setVisibleCount(50);
                    }}
                    className="h-10 bg-background"
                    aria-label="Payment date to"
                  />
                </label>
              </div>
            </div>

            <div className="space-y-1.5 rounded-lg border border-border/70 bg-card p-2.5">
              <p className="text-xs font-semibold text-foreground">Entry Date Range</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
                  From Date
                  <Input
                    type="date"
                    value={entryDateFrom}
                    max={entryDateTo || undefined}
                    onChange={(event) => {
                      setEntryDateFrom(event.target.value);
                      setVisibleCount(50);
                    }}
                    className="h-10 bg-background"
                    aria-label="Entry date from"
                  />
                </label>
                <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
                  To Date
                  <Input
                    type="date"
                    value={entryDateTo}
                    min={entryDateFrom || undefined}
                    onChange={(event) => {
                      setEntryDateTo(event.target.value);
                      setVisibleCount(50);
                    }}
                    className="h-10 bg-background"
                    aria-label="Entry date to"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* All Dimension & POS Filters — visible on both Android & Desktop */}
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            <span>Slice by Executive, Location, Allocation &amp; POS Status</span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-7">
            <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
              Executive
              <select
                value={executiveFilter}
                onChange={(event) => {
                  setExecutiveFilter(event.target.value);
                  setVisibleCount(50);
                }}
                aria-label="Filter by Executive"
                className="h-10 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground"
              >
                <option value="__all__">All Executives</option>
                {executives.map((executive) => (
                  <option key={executive} value={executive}>
                    {executive}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
              Bucket
              <select
                value={bucketFilter}
                onChange={(event) => {
                  setBucketFilter(event.target.value);
                  setVisibleCount(50);
                }}
                aria-label="Filter by Bucket"
                className="h-10 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground"
              >
                <option value="__all__">All Buckets</option>
                {buckets.map((bucket) => (
                  <option key={bucket} value={bucket}>
                    {bucket}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
              City
              <select
                value={cityFilter}
                onChange={(event) => {
                  setCityFilter(event.target.value);
                  setVisibleCount(50);
                }}
                aria-label="Filter by City"
                className="h-10 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground"
              >
                <option value="__all__">All Cities</option>
                {cities.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
              Allocation Category
              <select
                value={categoryFilter}
                onChange={(event) => {
                  setCategoryFilter(event.target.value);
                  setVisibleCount(50);
                }}
                aria-label="Filter by Allocation Category"
                className="h-10 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground"
              >
                <option value="__all__">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
              Allocation Type
              <select
                value={allocationTypeFilter}
                onChange={(event) => {
                  setAllocationTypeFilter(event.target.value);
                  setVisibleCount(50);
                }}
                aria-label="Filter by Allocation Type"
                className="h-10 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground"
              >
                <option value="__all__">All Allocation Types</option>
                {allocationTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
              Row Status
              <select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  setVisibleCount(50);
                }}
                aria-label="Filter by Status"
                className="h-10 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground"
              >
                <option value="__all__">All Statuses</option>
                <option value="Collection">Collection</option>
                <option value="Already Paid">Already Paid</option>
                <option value="Small Case">Small Case</option>
                <option value="Duplicate / Conflict">Duplicate / Conflict</option>
              </select>
            </label>

            <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
              POS Clearance
              <select
                value={posStatusFilter}
                onChange={(event) => {
                  setPosStatusFilter(event.target.value as PosStatusFilter);
                  setVisibleCount(50);
                }}
                aria-label="Filter by POS Clearance"
                className="h-10 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground"
              >
                <option value="__all__">All POS States</option>
                <option value="pos_cleared">POS Cleared (Main Paid)</option>
                <option value="full_pos_paid">Full POS Paid (Amt &ge; POS)</option>
                <option value="pos_pending">POS Pending</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      {isLoading && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Loading complete Collection Sheet...
        </p>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error instanceof Error
            ? error.message
            : "Could not load the Collection Sheet. Please refresh."}
        </div>
      )}

      {/* Fail-closed Small Case Exclusion Notice if loading/errored */}
      {!isLoading && !error && isExcludedLoading && (
        <div className="mt-4 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          Loading active Small Case exclusion list before calculating POS Cleared and Eligible
          Collection totals…
        </div>
      )}
      {!isLoading && !error && excludedError && (
        <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          The exclusion list could not be loaded. POS Cleared and Eligible totals are withheld to
          avoid counting Small Cases incorrectly. Refresh and try again.
        </div>
      )}

      {/* Prominent POS Cleared & Collection KPI Strip — Full visibility on BOTH Android & Desktop */}
      {!isLoading && !error && totalsReady && (
        <section className="mt-5 space-y-3" aria-label="Principal Outstanding clearance summary">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {/* Primary Spotlight Card: POS Cleared */}
            <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-card to-accent/60 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-primary">
                  POS Cleared (Main Paid)
                </p>
                <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
              </div>
              <p className="mt-2 break-words font-display text-2xl font-extrabold tabular-nums text-foreground sm:text-3xl">
                {formatAmount(posSummary.mainPaidPosCleared)}
              </p>
              <p className="mt-1.5 text-xs font-medium text-foreground/80">
                {posSummary.mainPaidCount.toLocaleString("en-IN")} unique{" "}
                {posSummary.mainPaidCount === 1 ? "loan" : "loans"} cleared ·{" "}
                {posSummary.clearedPercent.toFixed(1)}% of filtered POS
              </p>
              {posSummary.posPaidNotMainCount > 0 && (
                <p className="mt-1 text-[11px] font-medium text-sky-800">
                  + {posSummary.posPaidNotMainCount} full-POS only (
                  {formatAmount(posSummary.posPaidNotMainAmount)}) · Combined:{" "}
                  {formatAmount(posSummary.anyPosClearedAmount)}
                </p>
              )}
              {posSummary.missingPosClearedCount > 0 && (
                <p className="mt-1 text-[11px] text-amber-800">
                  Note: {posSummary.missingPosClearedCount} cleared{" "}
                  {posSummary.missingPosClearedCount === 1 ? "loan has" : "loans have"} ₹0/blank POS
                  in sheet.
                </p>
              )}
            </div>

            {/* Card 2: Eligible Collection Amount */}
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Eligible Collection
                </p>
                <IndianRupee className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              <p className="mt-2 break-words font-display text-2xl font-bold tabular-nums text-foreground">
                {formatAmount(summary.eligibleAmount)}
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {summary.eligibleRows.length.toLocaleString("en-IN")} eligible entries across{" "}
                {summary.uniqueLoans.toLocaleString("en-IN")} unique loans
              </p>
            </div>

            {/* Card 3: Total POS in Filtered Loans */}
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Filtered Unique POS
                </p>
                <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              <p className="mt-2 break-words font-display text-2xl font-bold tabular-nums text-foreground">
                {formatAmount(posSummary.totalFilteredPos)}
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Pending POS: {formatAmount(posSummary.pendingPosAmount)} (
                {posSummary.pendingLoans.length.toLocaleString("en-IN")} loans)
              </p>
            </div>

            {/* Card 4: Exclusions */}
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Excluded Records
                </p>
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              </div>
              <p className="mt-2 font-display text-2xl font-bold tabular-nums text-foreground">
                {(
                  summary.alreadyPaidCount +
                  summary.smallCaseCount +
                  summary.duplicateCount
                ).toLocaleString("en-IN")}
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Already Paid: {summary.alreadyPaidCount} · Small Case: {summary.smallCaseCount} ·
                Conflict: {summary.duplicateCount}
              </p>
            </div>
          </div>

          {/* Bucket-wise & Executive-wise Quick POS Cleared Strip */}
          {posSummary.clearedLoans.length > 0 && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-border bg-card p-3.5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xs font-bold uppercase tracking-wide text-primary">
                    Bucket-wise POS Cleared
                  </h2>
                  <span className="text-xs text-muted-foreground">{activeDateRangeLabel}</span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {posSummary.byBucket.map((item) => (
                    <div
                      key={item.key}
                      className="rounded-xl border border-border/80 bg-muted/35 px-3 py-2 text-xs"
                    >
                      <p className="font-semibold text-foreground">
                        {item.label}{" "}
                        <span className="text-muted-foreground">({item.loanCount})</span>
                      </p>
                      <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-primary">
                        {formatAmount(item.clearedPos)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-3.5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xs font-bold uppercase tracking-wide text-primary">
                    Executive-wise POS Cleared
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {posSummary.byExecutive.length}{" "}
                    {posSummary.byExecutive.length === 1 ? "executive" : "executives"}
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {posSummary.byExecutive.map((item) => (
                    <div
                      key={item.key}
                      className="rounded-xl border border-border/80 bg-muted/35 px-3 py-2 text-xs"
                    >
                      <p className="font-semibold text-foreground">
                        {item.label}{" "}
                        <span className="text-muted-foreground">({item.loanCount})</span>
                      </p>
                      <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-primary">
                        {formatAmount(item.clearedPos)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {!isLoading && !error && search.trim() && rows.length === 0 && !isBulkSearch && (
        <div className="mt-4 rounded-xl border bg-card p-8 text-center">
          <p className="font-semibold">Loan Number Not Found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            No rows match the active Loan Number and date/filter selections.
          </p>
        </div>
      )}

      {!isLoading && !error && rows.length === 0 && !search.trim() && (
        <div className="mt-4 rounded-xl border bg-card p-8 text-center">
          <p className="font-semibold">No Matching Collection Records</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try expanding the date range or resetting active filters.
          </p>
        </div>
      )}

      {/* Results View Switcher: POS Cleared Loans vs Full Sheet Rows */}
      {!isLoading && !error && rows.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Collection sheet view mode"
            className="inline-flex rounded-xl border border-border bg-card p-1 shadow-xs"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "pos_cleared"}
              onClick={() => setActiveTab("pos_cleared")}
              className={
                "min-h-9 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors sm:text-sm " +
                (activeTab === "pos_cleared"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              POS Cleared Accounts ({totalsReady ? posSummary.clearedLoans.length : "—"})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "rows"}
              onClick={() => setActiveTab("rows")}
              className={
                "min-h-9 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors sm:text-sm " +
                (activeTab === "rows"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              Collection Sheet Rows ({rows.length.toLocaleString("en-IN")})
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {activeTab === "pos_cleared"
              ? "Each loan ID is counted once (no duplicate POS double-counting)."
              : "Showing original Google Sheet entries matching your filters."}
          </p>
        </div>
      )}

      {/* TAB 1: Deduplicated POS Cleared Loans View (Desktop Table + Android Mobile Cards) */}
      {!isLoading && !error && rows.length > 0 && activeTab === "pos_cleared" && totalsReady && (
        <section className="mt-4 space-y-3" aria-label="POS Cleared loan accounts">
          {posSummary.clearedLoans.length === 0 ? (
            <div className="rounded-xl border bg-card p-8 text-center">
              <p className="font-semibold">No POS Cleared Loans in Current Selection</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Matching entries did not reach Main Paid (1 full EMI, Settlement, or Foreclosure)
                within {activeDateRangeLabel}.
              </p>
            </div>
          ) : (
            <>
              {/* Android / Mobile Cards */}
              <div className="space-y-3 md:hidden">
                {posSummary.clearedLoans.map((loan) => (
                  <article
                    key={loan.loanId}
                    className="rounded-2xl border border-primary/20 bg-card p-3.5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-all font-mono text-sm font-bold text-foreground">
                          {loan.loanId}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {loan.executive || "Unassigned"}
                          {loan.bucket ? ` · ${loan.bucket}` : ""}
                          {loan.city ? ` · ${loan.city}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                        {loan.status}
                      </span>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border/70 pt-3">
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          POS Cleared
                        </dt>
                        <dd className="mt-0.5 font-mono text-base font-extrabold tabular-nums text-primary">
                          {loan.pos == null ? "—" : formatAmount(loan.pos)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Collected in Filter
                        </dt>
                        <dd className="mt-0.5 font-mono text-sm font-bold tabular-nums text-foreground">
                          {formatAmount(loan.totalPaid)} ({loan.payments})
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Paid EMIs
                        </dt>
                        <dd className="mt-0.5 text-xs font-semibold text-foreground">
                          {loan.paidEmiCount}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Last Payment Date
                        </dt>
                        <dd className="mt-0.5 text-xs font-semibold text-foreground">
                          {loan.lastDate || "—"}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex justify-end border-t border-border/60 pt-2.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 text-xs"
                        onClick={() => setSelectedLoanDetail(loan)}
                      >
                        <Eye className="mr-1.5 h-3.5 w-3.5" />
                        View Entries
                      </Button>
                    </div>
                  </article>
                ))}
              </div>

              {/* Desktop Table */}
              <div className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:block">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] border-collapse text-sm">
                    <thead className="bg-muted/60">
                      <tr>
                        {[
                          "Loan Number",
                          "Executive",
                          "Bucket",
                          "City",
                          "Principal Outstanding (POS)",
                          "Collected (Filtered)",
                          "Payments",
                          "Paid EMIs",
                          "Clearance Status",
                          "Last Payment Date",
                          "",
                        ].map((label) => (
                          <th
                            key={label}
                            className="whitespace-nowrap border-b px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {posSummary.clearedLoans.map((loan) => (
                        <tr key={loan.loanId} className="border-b last:border-0 hover:bg-primary/5">
                          <td className="whitespace-nowrap px-3 py-3 font-mono font-semibold text-foreground">
                            {loan.loanId}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">{loan.executive || "—"}</td>
                          <td className="whitespace-nowrap px-3 py-3">{loan.bucket || "—"}</td>
                          <td className="whitespace-nowrap px-3 py-3">{loan.city || "—"}</td>
                          <td className="whitespace-nowrap px-3 py-3 font-mono font-bold tabular-nums text-primary">
                            {loan.pos == null ? "—" : formatAmount(loan.pos)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 font-mono font-semibold tabular-nums">
                            {formatAmount(loan.totalPaid)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                            {loan.payments}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                            {loan.paidEmiCount}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">
                            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                              {loan.status}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">{loan.lastDate || "—"}</td>
                          <td className="whitespace-nowrap px-3 py-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => setSelectedLoanDetail(loan)}
                            >
                              <Eye className="mr-1.5 h-3.5 w-3.5" />
                              Entries
                            </Button>
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-primary/25 bg-accent/60 font-bold text-foreground">
                        <td className="px-3 py-3" colSpan={4}>
                          TOTAL ({posSummary.clearedLoans.length} Unique Cleared Loans)
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 font-mono tabular-nums text-primary">
                          {formatAmount(posSummary.mainPaidPosCleared)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 font-mono tabular-nums">
                          {formatAmount(
                            posSummary.clearedLoans.reduce((s, l) => s + l.totalPaid, 0),
                          )}
                        </td>
                        <td className="px-3 py-3 tabular-nums">
                          {posSummary.clearedLoans.reduce((s, l) => s + l.payments, 0)}
                        </td>
                        <td colSpan={4} />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {/* TAB 2: Original Collection Sheet Rows (Android Cards + Desktop Table) */}
      {!isLoading && !error && rows.length > 0 && activeTab === "rows" && (
        <>
          <div className="mt-4 space-y-3 md:hidden" aria-label="Collection records">
            {visibleRows.map((row, index) => {
              const primaryKeys = new Set<keyof Collection>([
                "executive",
                "loanId",
                "amount",
                "date",
                "time",
                "bucket",
                "city",
              ]);
              const detailColumns = columns.filter((column) => !primaryKeys.has(column.key));
              const id = normaliseLoanId(row.loanId);
              const isSmallCase = !row.alreadyPaid && activeExcludedIds.has(id);
              const isExcluded = !!row.alreadyPaid || isSmallCase || !!row.isConflict;
              const posBadge = posBadgeForLoan(isExcluded, posSummary.loanById.get(id));

              return (
                <article
                  key={row.row ?? String(row.loanId ?? "row") + "-" + index}
                  className={
                    "overflow-hidden rounded-2xl border bg-card shadow-sm " +
                    (row.alreadyPaid ? "border-red-200 bg-red-50/70" : "border-border")
                  }
                >
                  <div className="flex items-start justify-between gap-3 p-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="break-all font-mono text-[15px] font-bold tracking-tight text-foreground">
                        {row.loanId || "Loan number unavailable"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.executive || "Unassigned"}
                        {row.bucket ? " · " + row.bucket : ""}
                        {row.city ? " · " + row.city : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono text-lg font-extrabold tabular-nums">
                        {formatAmount(Number(row.amount ?? 0))}
                      </p>
                      <span
                        className={
                          "mt-1 inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold " +
                          (row.alreadyPaid
                            ? "bg-red-100 text-red-800"
                            : isSmallCase || row.isConflict
                              ? "bg-amber-100 text-amber-900"
                              : "bg-primary/10 text-primary")
                        }
                      >
                        {row.alreadyPaid
                          ? "ALREADY PAID"
                          : isSmallCase
                            ? "SMALL CASE"
                            : row.isConflict
                              ? "DUPLICATE / CONFLICT"
                              : "COLLECTION"}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 border-t border-border/70 px-3.5 py-2.5">
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Payment Date
                      </p>
                      <p className="mt-0.5 text-xs font-semibold">{row.date || "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        POS
                      </p>
                      <p className="mt-0.5 font-mono text-xs font-semibold tabular-nums">
                        {row.pos == null ? "—" : formatAmount(row.pos)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        POS Status
                      </p>
                      <span
                        className={`mt-0.5 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${posBadge.className}`}
                      >
                        {posBadge.label}
                      </span>
                    </div>
                  </div>
                  <details className="group border-t border-border/70">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3.5 text-xs font-semibold text-primary [&::-webkit-details-marker]:hidden">
                      <span>View all details</span>
                      <span className="text-base transition-transform group-open:rotate-45">
                        ＋
                      </span>
                    </summary>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-3 border-t border-border/60 bg-muted/40 p-3.5">
                      {detailColumns.map((column) => (
                        <div key={String(column.key)} className="min-w-0">
                          <dt className="text-[10px] font-medium text-muted-foreground">
                            {column.label}
                          </dt>
                          <dd className="mt-0.5 break-words text-xs font-medium text-foreground">
                            {displayValue(row, column) || "—"}
                          </dd>
                        </div>
                      ))}
                      <div className="col-span-2">
                        <dt className="text-[10px] font-medium text-muted-foreground">Paid Flag</dt>
                        <dd className="mt-0.5 text-xs font-semibold">
                          {row.alreadyPaid ? "Already Paid" : "—"}
                        </dd>
                      </div>
                    </dl>
                  </details>
                </article>
              );
            })}
          </div>

          <section className="mt-4 hidden space-y-4 md:block">
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1220px] border-collapse text-sm">
                  <thead className="bg-muted/60">
                    <tr>
                      {[
                        "Loan Number",
                        "Executive",
                        "Bucket",
                        "City",
                        "Principal Outstanding",
                        "EMI Amount",
                        "Amount",
                        "Payment Date",
                        "Entry Date",
                        "POS Status",
                        "Row Status",
                        "",
                      ].map((label) => (
                        <th
                          key={label}
                          className="whitespace-nowrap border-b px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, index) => {
                      const id = normaliseLoanId(row.loanId);
                      const isSmallCase = !row.alreadyPaid && activeExcludedIds.has(id);
                      const isExcluded = !!row.alreadyPaid || isSmallCase || !!row.isConflict;
                      const rowStatus = row.alreadyPaid
                        ? "Already Paid"
                        : isSmallCase
                          ? "Small Case"
                          : row.isConflict
                            ? "Duplicate / Conflict"
                            : "Collection";
                      const posBadge = posBadgeForLoan(isExcluded, posSummary.loanById.get(id));
                      const isSelected = selectedRecord === row;
                      return (
                        <tr
                          key={row.row ?? `${row.loanId ?? "row"}-${index}`}
                          className={`border-b last:border-0 hover:bg-primary/5 ${isSelected ? "bg-accent/50" : ""} ${row.alreadyPaid ? "bg-red-50/50" : ""}`}
                        >
                          <td className="whitespace-nowrap px-3 py-3 font-mono font-semibold">
                            {row.loanId || "—"}
                            <span className="mt-0.5 block font-sans text-[10px] font-normal text-muted-foreground">
                              {row.entryType || "Collection entry"}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">{row.executive || "—"}</td>
                          <td className="whitespace-nowrap px-3 py-3">{row.bucket || "—"}</td>
                          <td className="whitespace-nowrap px-3 py-3">{row.city || "—"}</td>
                          <td className="whitespace-nowrap px-3 py-3 font-mono tabular-nums">
                            {row.pos == null ? "—" : formatAmount(row.pos)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 font-mono tabular-nums">
                            {row.emiAmount == null ? "—" : formatAmount(row.emiAmount)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 font-mono font-bold tabular-nums">
                            {formatAmount(Number(row.amount ?? 0))}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">{row.date || "—"}</td>
                          <td className="whitespace-nowrap px-3 py-3">{row.entryDate || "—"}</td>
                          <td className="whitespace-nowrap px-3 py-3">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold ${posBadge.className}`}
                            >
                              {posBadge.label}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold ${rowStatus === "Collection" ? "bg-primary/10 text-primary" : rowStatus === "Already Paid" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}
                            >
                              {rowStatus}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">
                            <Button
                              type="button"
                              variant={isSelected ? "secondary" : "outline"}
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => setSelectedRecord(isSelected ? null : row)}
                            >
                              <Eye className="mr-1.5 h-3.5 w-3.5" />
                              {isSelected ? "Close" : "View"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {rows.length > visibleRows.length && (
            <div className="mt-3 flex justify-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => setVisibleCount((count) => count + 50)}
              >
                Load 50 more ({rows.length - visibleRows.length} remaining)
              </Button>
            </div>
          )}
        </>
      )}

      {/* Drawer for a single sheet row */}
      {selectedRecord && (
        <div className="fixed inset-0 z-[70] hidden md:block" role="presentation">
          <button
            type="button"
            aria-label="Close record details"
            className="absolute inset-0 h-full w-full cursor-default bg-black/30"
            onClick={() => setSelectedRecord(null)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="record-detail-title"
            className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col border-l border-border bg-card shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-border bg-primary/5 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
                  Complete record details
                </p>
                <h2 id="record-detail-title" className="mt-1 break-all font-mono text-lg font-bold">
                  {selectedRecord.loanId || "Loan details"}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedRecord.linkedName || "No linked name"} ·{" "}
                  {selectedRecord.executive || "Unassigned"}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0 bg-card"
                onClick={() => setSelectedRecord(null)}
                aria-label="Close record details"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {columns.map((column) => (
                  <div
                    key={String(column.key)}
                    className="min-w-0 rounded-lg border border-border bg-card p-3"
                  >
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {column.label}
                    </dt>
                    <dd className="mt-1 break-words text-sm font-medium text-foreground">
                      {displayValue(selectedRecord, column) || "—"}
                    </dd>
                  </div>
                ))}
                <div className="rounded-lg border border-border bg-card p-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Paid Flag
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-foreground">
                    {selectedRecord.alreadyPaid ? "Already Paid" : "—"}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="border-t border-border bg-card px-5 py-3">
              <p className="text-[11px] text-muted-foreground">
                Read-only record details · Google Sheet data is not modified.
              </p>
            </div>
          </aside>
        </div>
      )}

      {/* Drawer showing matching payment entries for a POS-cleared loan */}
      {selectedLoanDetail && (
        <div className="fixed inset-0 z-[70]" role="presentation">
          <button
            type="button"
            aria-label="Close loan payment entries"
            className="absolute inset-0 h-full w-full cursor-default bg-black/30"
            onClick={() => setSelectedLoanDetail(null)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="loan-pos-detail-title"
            className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col border-l border-border bg-card shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-border bg-primary/5 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
                  POS Cleared Account Breakdown
                </p>
                <h2
                  id="loan-pos-detail-title"
                  className="mt-1 break-all font-mono text-lg font-bold"
                >
                  {selectedLoanDetail.loanId}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedLoanDetail.executive} · POS:{" "}
                  {selectedLoanDetail.pos == null ? "—" : formatAmount(selectedLoanDetail.pos)} ·{" "}
                  {selectedLoanDetail.status}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0 bg-card"
                onClick={() => setSelectedLoanDetail(null)}
                aria-label="Close loan payment entries"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {summary.eligibleRows
                .filter((row) => normaliseLoanId(row.loanId) === selectedLoanDetail.loanId)
                .map((entry, idx) => (
                  <div
                    key={entry.row ?? idx}
                    className="rounded-xl border border-border bg-muted/30 p-3 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-foreground">{entry.executive}</span>
                      <span className="font-mono font-bold tabular-nums text-primary">
                        {formatAmount(Number(entry.amount ?? 0))}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Payment: {entry.date || "—"} · Entry: {entry.entryDate || "—"} ·{" "}
                      {entry.settlementType && entry.settlementType !== "No"
                        ? entry.settlementType
                        : entry.entryType || "Normal"}
                    </p>
                  </div>
                ))}
            </div>
          </aside>
        </div>
      )}

      {!isLoading && !error && isBulkSearch && (
        <section className="mt-5 rounded-2xl border bg-card p-4" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Bulk Search Results</h2>
            <span className="text-sm text-muted-foreground">
              {requestedLoanIds.length - notFoundLoanIds.length} found · {notFoundLoanIds.length}{" "}
              not found
            </span>
          </div>
          {notFoundLoanIds.length > 0 ? (
            <>
              <p className="mt-2 text-sm font-medium text-destructive">
                These Loan Numbers are not present in the Collection Sheet:
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {notFoundLoanIds.map((loanId) => (
                  <span
                    key={loanId}
                    className="rounded-md bg-destructive/10 px-2 py-1 font-mono text-sm text-destructive"
                  >
                    {loanId}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              All pasted Loan Numbers were found.
            </p>
          )}
        </section>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        This page does not edit the Google Sheet. POS Cleared counts Principal Outstanding once per
        unique eligible loan reaching Main Paid (1 complete EMI, Settlement, or Foreclosure) after
        Already Paid, Small Case, and Conflict exclusions.
      </p>
    </main>
  );
}
