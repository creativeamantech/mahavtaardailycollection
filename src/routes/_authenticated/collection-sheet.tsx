import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "@/lib/auth.functions";
import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, RefreshCw, X, Download, Eye } from "lucide-react";

import { getCollections } from "@/lib/mahavtaar.functions";
import { getExcludedLoanNumbers } from "@/lib/excluded-loans.functions";
import { normaliseLoanId } from "@/lib/loans";
import { formatAmount } from "@/lib/executives";
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
        content: "Read-only view of the complete Collections sheet with Loan Number search.",
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
  settlementType?: string;
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

function CollectionSheetPage() {
  const fetchCollections = useServerFn(getCollections);
  const fetchExcludedLoanNumbers = useServerFn(getExcludedLoanNumbers);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [visibleCount, setVisibleCount] = useState(50);
  const [executiveFilter, setExecutiveFilter] = useState("__all__");
  const [bucketFilter, setBucketFilter] = useState("__all__");
  const [cityFilter, setCityFilter] = useState("__all__");
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [selectedRecord, setSelectedRecord] = useState<Collection | null>(null);
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
  const executives = useMemo(
    () =>
      [...new Set(allRows.map((row) => String(row.executive ?? "").trim()).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [allRows],
  );
  const buckets = useMemo(
    () =>
      [...new Set(allRows.map((row) => String(row.bucket ?? "").trim()).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [allRows],
  );
  const cities = useMemo(
    () =>
      [...new Set(allRows.map((row) => String(row.city ?? "").trim()).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [allRows],
  );
  const rows = useMemo(
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
        const rowStatus = row.alreadyPaid
          ? "Already Paid"
          : activeExcludedIds.has(rowLoanId)
            ? "Small Case"
            : row.isConflict
              ? "Duplicate / Conflict"
              : "Collection";
        const matchesBucket =
          bucketFilter === "__all__" || String(row.bucket ?? "").trim() === bucketFilter;
        const matchesCity =
          cityFilter === "__all__" || String(row.city ?? "").trim() === cityFilter;
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
      statusFilter,
      activeExcludedIds,
      paymentDateFrom,
      paymentDateTo,
      entryDateFrom,
      entryDateTo,
    ],
  );
  const visibleRows = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount]);
  const desktopCollectionAmount = rows.reduce((sum, row) => {
    const id = normaliseLoanId(row.loanId);
    return row.alreadyPaid || activeExcludedIds.has(id) || row.isConflict
      ? sum
      : sum + Number(row.amount ?? 0);
  }, 0);

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
    return {
      eligibleRows,
      eligibleAmount: eligibleRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
      uniqueLoans: new Set(eligibleRows.map((row) => normaliseLoanId(row.loanId)).filter(Boolean))
        .size,
      alreadyPaidCount: alreadyPaidRows.length,
      alreadyPaidAmount: alreadyPaidRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
      smallCaseCount: smallCaseRows.length,
      smallCaseAmount: smallCaseRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
      duplicateCount: duplicateRows.length,
      duplicateAmount: duplicateRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
    };
  }, [rows, activeExcludedIds]);

  const notFoundLoanIds = useMemo(() => {
    if (!isBulkSearch) return [];
    const found = new Set(allRows.map((row) => normaliseLoanId(row.loanId)));
    return requestedLoanIds.filter((id) => !found.has(id));
  }, [allRows, isBulkSearch, requestedLoanIds]);

  function downloadCsv() {
    const headers = ["#", ...columns.map((column) => column.label), "Paid Flag"];
    const csvValue = (row: Collection, key: keyof Collection): string | number => {
      const value = row[key];
      if (value == null) return "";
      if (key === "receiptLinks") return (row.receiptLinks ?? []).join(" | ");
      if (key === "isValidated") return row.isValidated ? "VALIDATED" : "";
      if (typeof value === "number") return value;
      return String(value);
    };
    const escapeCsv = sanitizeCsvCell;
    const lines = [
      headers.map(escapeCsv).join(","),
      ...rows.map((row, index) =>
        [
          row.row ?? index + 1,
          ...columns.map((column) => csvValue(row, column.key)),
          row.alreadyPaid ? "Already Paid" : "",
        ]
          .map(escapeCsv)
          .join(","),
      ),
    ];
    const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "collection-sheet.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto w-full max-w-[1600px] px-3 pb-16 pt-6 sm:px-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Collection Sheet</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete read-only view of the original Collections sheet. Already Paid rows are
            highlighted in red.
          </p>
        </div>
        <Button variant="outline" className="h-10" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          {isFetching ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSearch("");
            }}
            placeholder="Search loan numbers — paste multiple IDs separated by lines, commas or spaces"
            aria-label="Search by Loan Number"
            className="h-11 pl-9 pr-10"
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
        <select
          value={executiveFilter}
          onChange={(event) => setExecutiveFilter(event.target.value)}
          aria-label="Filter by Executive"
          className="h-11 min-w-[190px] rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="__all__">All Executives</option>
          {executives.map((executive) => (
            <option key={executive} value={executive}>
              {executive}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          className="h-11"
          onClick={downloadCsv}
          disabled={rows.length === 0}
        >
          <Download className="mr-2 h-4 w-4" />
          Download CSV
        </Button>
        <div className="flex items-center text-sm text-muted-foreground" aria-live="polite">
          {rows.length} of {allRows.length} rows
        </div>
      </div>

      <section
        className="mt-3 grid grid-cols-1 gap-3 rounded-xl border p-3 sm:grid-cols-2"
        aria-label="Date range filters"
      >
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Payment Date Range</h2>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              From
              <Input
                type="date"
                value={paymentDateFrom}
                max={paymentDateTo || undefined}
                onChange={(event) => setPaymentDateFrom(event.target.value)}
                className="h-10"
                aria-label="Payment date from"
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              To
              <Input
                type="date"
                value={paymentDateTo}
                min={paymentDateFrom || undefined}
                onChange={(event) => setPaymentDateTo(event.target.value)}
                className="h-10"
                aria-label="Payment date to"
              />
            </label>
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Entry Date Range</h2>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              From
              <Input
                type="date"
                value={entryDateFrom}
                max={entryDateTo || undefined}
                onChange={(event) => setEntryDateFrom(event.target.value)}
                className="h-10"
                aria-label="Entry date from"
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              To
              <Input
                type="date"
                value={entryDateTo}
                min={entryDateFrom || undefined}
                onChange={(event) => setEntryDateTo(event.target.value)}
                className="h-10"
                aria-label="Entry date to"
              />
            </label>
          </div>
        </div>
        {(paymentDateFrom || paymentDateTo || entryDateFrom || entryDateTo) && (
          <div className="sm:col-span-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setPaymentDateFrom("");
                setPaymentDateTo("");
                setEntryDateFrom("");
                setEntryDateTo("");
              }}
            >
              Clear date filters
            </Button>
          </div>
        )}
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
      {!isLoading && !error && search.trim() && rows.length === 0 && !isBulkSearch && (
        <div className="mt-4 rounded-lg border p-8 text-center">
          <p className="font-semibold">Loan Number Not Found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            No rows match the current Loan Number and Executive filters.
          </p>
        </div>
      )}
      {!isLoading && !error && rows.length > 0 && (
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
            const isSmallCase =
              !row.alreadyPaid && activeExcludedIds.has(normaliseLoanId(row.loanId));
            return (
              <article
                key={row.row ?? String(row.loanId ?? "row") + "-" + index}
                className={
                  "overflow-hidden rounded-xl border bg-white shadow-sm " +
                  (row.alreadyPaid ? "border-red-200 bg-red-50/70" : "border-amber-200/70")
                }
              >
                <div className="flex items-start justify-between gap-3 p-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-[15px] font-bold tracking-tight text-foreground">
                      {row.loanId || "Loan number unavailable"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.executive || "Unassigned"}
                      {row.bucket ? " · " + row.bucket : ""}
                      {row.city ? " · " + row.city : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-extrabold tabular-nums">
                      {formatAmount(Number(row.amount ?? 0))}
                    </p>
                    <span
                      className={
                        "mt-1 inline-flex rounded-md px-2 py-1 text-[10px] font-bold " +
                        (row.alreadyPaid
                          ? "bg-red-100 text-red-800"
                          : isSmallCase || row.isConflict
                            ? "bg-amber-100 text-amber-900"
                            : "bg-yellow-100 text-yellow-900")
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
                <div className="grid grid-cols-2 gap-3 border-t border-border/70 px-3.5 py-3">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Payment Date
                    </p>
                    <p className="mt-0.5 text-xs font-semibold">{row.date || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Entry Time
                    </p>
                    <p className="mt-0.5 text-xs font-semibold">{row.time || "—"}</p>
                  </div>
                </div>
                <details className="group border-t border-border/70">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3.5 text-xs font-semibold text-amber-800 [&::-webkit-details-marker]:hidden">
                    <span>View all details</span>
                    <span className="text-base transition-transform group-open:rotate-45">＋</span>
                  </summary>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-3 border-t border-border/60 bg-stone-50/70 p-3.5">
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
      )}
      {!isLoading && !error && rows.length > 0 && (
        <section className="mt-5 hidden space-y-4 md:block">
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium text-muted-foreground">Eligible Collection</p>
              <p className="mt-2 text-xl font-bold tabular-nums">
                {formatAmount(desktopCollectionAmount)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                After paid, small-case and conflict exclusions
              </p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium text-muted-foreground">Matching Records</p>
              <p className="mt-2 text-xl font-bold tabular-nums">
                {rows.length.toLocaleString("en-IN")}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">Current filter result</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium text-muted-foreground">Unique Loan Accounts</p>
              <p className="mt-2 text-xl font-bold tabular-nums">
                {new Set(
                  rows
                    .filter(
                      (row) =>
                        !row.alreadyPaid &&
                        !activeExcludedIds.has(normaliseLoanId(row.loanId)) &&
                        !row.isConflict,
                    )
                    .map((row) => normaliseLoanId(row.loanId))
                    .filter(Boolean),
                ).size.toLocaleString("en-IN")}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">Eligible unique loan numbers</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium text-muted-foreground">Needs Attention</p>
              <p className="mt-2 text-xl font-bold tabular-nums">
                {rows
                  .filter(
                    (row) =>
                      !row.alreadyPaid &&
                      (activeExcludedIds.has(normaliseLoanId(row.loanId)) || row.isConflict),
                  )
                  .length.toLocaleString("en-IN")}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">Small cases and conflicts</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3">
            <div>
              <h2 className="text-sm font-bold">Collection Records</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Scan key payment information and open any row for its complete record.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={bucketFilter}
                onChange={(event) => setBucketFilter(event.target.value)}
                aria-label="Filter by Bucket"
                className="h-9 min-w-[130px] rounded-md border border-input bg-white px-2.5 text-xs"
              >
                <option value="__all__">All Buckets</option>
                {buckets.map((bucket) => (
                  <option key={bucket} value={bucket}>
                    {bucket}
                  </option>
                ))}
              </select>
              <select
                value={cityFilter}
                onChange={(event) => setCityFilter(event.target.value)}
                aria-label="Filter by City"
                className="h-9 min-w-[130px] rounded-md border border-input bg-white px-2.5 text-xs"
              >
                <option value="__all__">All Cities</option>
                {cities.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                aria-label="Filter by Status"
                className="h-9 min-w-[150px] rounded-md border border-input bg-white px-2.5 text-xs"
              >
                <option value="__all__">All Statuses</option>
                <option value="Collection">Collection</option>
                <option value="Already Paid">Already Paid</option>
                <option value="Small Case">Small Case</option>
                <option value="Duplicate / Conflict">Duplicate / Conflict</option>
              </select>
              {(bucketFilter !== "__all__" ||
                cityFilter !== "__all__" ||
                statusFilter !== "__all__") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setBucketFilter("__all__");
                    setCityFilter("__all__");
                    setStatusFilter("__all__");
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] border-collapse text-sm">
                <thead className="bg-stone-50">
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
                      "Entry Time",
                      "Status",
                      "",
                    ].map((label) => (
                      <th
                        key={label}
                        className="whitespace-nowrap border-b px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, index) => {
                    const rowStatus = row.alreadyPaid
                      ? "Already Paid"
                      : activeExcludedIds.has(normaliseLoanId(row.loanId))
                        ? "Small Case"
                        : row.isConflict
                          ? "Duplicate / Conflict"
                          : "Collection";
                    const isSelected = selectedRecord === row;
                    return (
                      <tr
                        key={row.row ?? `${row.loanId ?? "row"}-${index}`}
                        className={`border-b last:border-0 hover:bg-amber-50/50 ${isSelected ? "bg-amber-50" : ""} ${row.alreadyPaid ? "bg-stone-50" : ""}`}
                      >
                        <td className="whitespace-nowrap px-3 py-3 font-semibold">
                          {row.loanId || "—"}
                          <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                            {row.entryType || "Collection entry"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">{row.executive || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-3">{row.bucket || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-3">{row.city || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                          {row.pos == null ? "—" : formatAmount(row.pos)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                          {row.emiAmount == null ? "—" : formatAmount(row.emiAmount)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 font-bold tabular-nums">
                          {formatAmount(Number(row.amount ?? 0))}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">{row.date || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-3">
                          {row.time || row.createdAt || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${rowStatus === "Collection" ? "bg-amber-100 text-amber-900" : rowStatus === "Already Paid" ? "bg-stone-200 text-stone-700" : "bg-yellow-50 text-yellow-900"}`}
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
      )}
      {!isLoading && !error && rows.length > visibleRows.length && (
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
            className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col border-l border-amber-200 bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-amber-200 bg-amber-50/70 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                  Complete record details
                </p>
                <h2 id="record-detail-title" className="mt-1 break-all text-lg font-bold">
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
                className="h-9 w-9 shrink-0 border-amber-300 bg-white"
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
                    className="min-w-0 rounded-lg border border-amber-100 bg-white p-3"
                  >
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {column.label}
                    </dt>
                    <dd className="mt-1 break-words text-sm font-medium text-foreground">
                      {displayValue(selectedRecord, column) || "—"}
                    </dd>
                  </div>
                ))}
                <div className="rounded-lg border border-amber-100 bg-white p-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Paid Flag
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-foreground">
                    {selectedRecord.alreadyPaid ? "Already Paid" : "—"}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="border-t border-amber-100 bg-white px-5 py-3">
              <p className="text-[11px] text-muted-foreground">
                Read-only record details · Google Sheet data is not modified.
              </p>
            </div>
          </aside>
        </div>
      )}
      {!isLoading && !error && isBulkSearch && (
        <section className="mt-5 rounded-xl border p-4" aria-live="polite">
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
      {rows.length > 0 && (
        <section className="mt-5 rounded-xl border p-4" aria-label="Filtered collection totals">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Filtered Collection Summary</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Totals apply Already Paid, Active Excluded Loan Numbers (Small Cases), and
                unvalidated duplicate/conflict exclusions.
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Eligible Collection Amount</p>
              <p className="text-xl font-bold tabular-nums">
                {isExcludedLoading
                  ? "Loading…"
                  : excludedError
                    ? "Unavailable"
                    : formatAmount(summary.eligibleAmount)}
              </p>
            </div>
          </div>
          {isExcludedLoading ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Loading the active Small Case exclusion list before calculating totals…
            </p>
          ) : excludedError ? (
            <p className="mt-3 text-sm text-destructive">
              The exclusion list could not be loaded. Totals are withheld to avoid counting Small
              Cases incorrectly. Refresh and try again.
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Eligible Entries</p>
                <p className="text-lg font-semibold tabular-nums">{summary.eligibleRows.length}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Unique Loan Numbers</p>
                <p className="text-lg font-semibold tabular-nums">{summary.uniqueLoans}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Already Paid Excluded</p>
                <p className="text-lg font-semibold tabular-nums">
                  {summary.alreadyPaidCount} · {formatAmount(summary.alreadyPaidAmount)}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Small Cases Excluded</p>
                <p className="text-lg font-semibold tabular-nums">
                  {summary.smallCaseCount} · {formatAmount(summary.smallCaseAmount)}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Duplicate / Conflict Excluded</p>
                <p className="text-lg font-semibold tabular-nums">
                  {summary.duplicateCount} · {formatAmount(summary.duplicateAmount)}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Total Visible Rows</p>
                <p className="text-lg font-semibold tabular-nums">{rows.length}</p>
              </div>
            </div>
          )}
        </section>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        This page does not edit the Google Sheet. Red highlighting uses the existing Already Paid
        flag from the app's collection-data parser.
      </p>
    </main>
  );
}
