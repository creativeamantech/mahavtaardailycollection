import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, RefreshCw, X, Download } from "lucide-react";

import { getCollections } from "@/lib/mahavtaar.functions";
import { getExcludedLoanNumbers } from "@/lib/excluded-loans.functions";
import { normaliseLoanId } from "@/lib/loans";
import { formatAmount } from "@/lib/executives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/collection-sheet")({
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
  alreadyPaid?: boolean;
  isValidated?: boolean;
  isConflict?: boolean;
  linkedName?: string;
  portalUrl?: string;
};

const columns: { key: keyof Collection; label: string; render?: (row: Collection) => React.ReactNode }[] = [
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
  { key: "emiAmount", label: "EMI Amount", render: (r) => r.emiAmount == null ? "" : formatAmount(r.emiAmount) },
  { key: "pos", label: "Principal Outstanding", render: (r) => r.pos == null ? "" : formatAmount(r.pos) },
  { key: "foreclosure", label: "Approx. Foreclosure", render: (r) => r.foreclosure == null ? "" : formatAmount(r.foreclosure) },
  { key: "receiptLinks", label: "Receipt", render: (r) => (r.receiptLinks ?? []).map((url, i) => <a key={url + i} href={url} target="_blank" rel="noreferrer" className="text-primary underline">Open {i + 1}</a>) },
  { key: "remark", label: "Remark" },
  { key: "actualId", label: "Active ID" },
  { key: "amansRemarks", label: "Aman's Remarks" },
  { key: "allocationCategory", label: "Allocation Category" },
  { key: "allocationDate", label: "Allocation Date" },
  { key: "isValidated", label: "Validation", render: (r) => r.isValidated ? "VALIDATED" : "" },
  { key: "linkedName", label: "Linked Name", render: (r) => r.portalUrl ? <a href={r.portalUrl} target="_blank" rel="noreferrer" className="text-primary underline">{r.linkedName || "Open"}</a> : (r.linkedName ?? "") },
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
  if (iso) return iso[1];
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function CollectionSheetPage() {
  const fetchCollections = useServerFn(getCollections);
  const fetchExcludedLoanNumbers = useServerFn(getExcludedLoanNumbers);
  const [search, setSearch] = useState("");
  const [executiveFilter, setExecutiveFilter] = useState("__all__");
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
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const allRows = useMemo(() => data ?? [], [data]);
  const { data: excludedRecords = [], isLoading: isExcludedLoading, error: excludedError } = useQuery({
    queryKey: ["excluded-loan-numbers"],
    queryFn: async () => {
      const records = await fetchExcludedLoanNumbers();
      return Array.isArray(records) ? records : [];
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  // Active Excluded Loan Numbers are the sole source of truth for Small Cases.
  // Never infer exclusion from either EMI amount or the collection payment amount.
  const activeExcludedIds = useMemo(
    () => new Set(
      excludedRecords
        .filter((record) => String(record.status ?? "Active").trim().toLowerCase() === "active")
        .map((record) => normaliseLoanId(record.loanNumber))
        .filter(Boolean),
    ),
    [excludedRecords],
  );
  // Bulk IDs may be separated by newlines, commas, semicolons, or spaces.
  const requestedLoanIds = useMemo(
    () => [...new Set(search.split(/[\s,;]+/).map(normaliseLoanId).filter(Boolean))],
    [search],
  );
  const isBulkSearch = requestedLoanIds.length > 1;
  const normalizedQuery = normaliseLoanId(search);
  const executives = useMemo(
    () => [...new Set(allRows.map((row) => String(row.executive ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [allRows],
  );
  const rows = useMemo(() => allRows.filter((row) => {
    const rowLoanId = normaliseLoanId(row.loanId);
    const matchesLoan = !search.trim()
      || (isBulkSearch ? requestedLoanIds.includes(rowLoanId) : rowLoanId.includes(normalizedQuery));
    const matchesExecutive = executiveFilter === "__all__" || String(row.executive ?? "").trim() === executiveFilter;
    const paymentDate = dateFilterKey(row.date);
    const entryDate = dateFilterKey(row.entryDate);
    const matchesPaymentDate = (!paymentDateFrom || (paymentDate && paymentDate >= paymentDateFrom))
      && (!paymentDateTo || (paymentDate && paymentDate <= paymentDateTo));
    const matchesEntryDate = (!entryDateFrom || (entryDate && entryDate >= entryDateFrom))
      && (!entryDateTo || (entryDate && entryDate <= entryDateTo));
    return matchesLoan && matchesExecutive && matchesPaymentDate && matchesEntryDate;
  }), [allRows, search, isBulkSearch, requestedLoanIds, normalizedQuery, executiveFilter, paymentDateFrom, paymentDateTo, entryDateFrom, entryDateTo]);

  // Apply the existing reporting rules to the currently visible/search-filtered rows.
  // Category priority avoids double-counting excluded rows in the summary.
  const summary = useMemo(() => {
    const alreadyPaidRows = rows.filter((row) => !!row.alreadyPaid);
    const smallCaseRows = rows.filter((row) =>
      !row.alreadyPaid && activeExcludedIds.has(normaliseLoanId(row.loanId)),
    );
    const duplicateRows = rows.filter((row) =>
      !row.alreadyPaid &&
      !activeExcludedIds.has(normaliseLoanId(row.loanId)) &&
      !!row.isConflict,
    );
    const eligibleRows = rows.filter((row) =>
      !row.alreadyPaid &&
      !activeExcludedIds.has(normaliseLoanId(row.loanId)) &&
      !row.isConflict,
    );
    return {
      eligibleRows,
      eligibleAmount: eligibleRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
      uniqueLoans: new Set(eligibleRows.map((row) => normaliseLoanId(row.loanId)).filter(Boolean)).size,
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
    const escapeCsv = (value: unknown) => {
      let text = String(value ?? "");
      if (typeof value === "string" && /^[=+@\-\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    const lines = [
      headers.map(escapeCsv).join(","),
      ...rows.map((row, index) => [
        row.row ?? index + 1,
        ...columns.map((column) => csvValue(row, column.key)),
        row.alreadyPaid ? "Already Paid" : "",
      ].map(escapeCsv).join(",")),
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
            Complete read-only view of the original Collections sheet. Already Paid rows are highlighted in red.
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
            onKeyDown={(event) => { if (event.key === "Escape") setSearch(""); }}
            placeholder="Search loan numbers — paste multiple IDs separated by lines, commas or spaces"
            aria-label="Search by Loan Number"
            className="h-11 pl-9 pr-10"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
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
          {executives.map((executive) => <option key={executive} value={executive}>{executive}</option>)}
        </select>
        <Button variant="outline" className="h-11" onClick={downloadCsv} disabled={rows.length === 0}>
          <Download className="mr-2 h-4 w-4" />
          Download CSV
        </Button>
        <div className="flex items-center text-sm text-muted-foreground" aria-live="polite">
          {rows.length} of {allRows.length} rows
        </div>
      </div>

      <section className="mt-3 grid grid-cols-1 gap-3 rounded-xl border p-3 sm:grid-cols-2" aria-label="Date range filters">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Payment Date Range</h2>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-muted-foreground">From
              <Input type="date" value={paymentDateFrom} max={paymentDateTo || undefined} onChange={(event) => setPaymentDateFrom(event.target.value)} className="h-10" aria-label="Payment date from" />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">To
              <Input type="date" value={paymentDateTo} min={paymentDateFrom || undefined} onChange={(event) => setPaymentDateTo(event.target.value)} className="h-10" aria-label="Payment date to" />
            </label>
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Entry Date Range</h2>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-muted-foreground">From
              <Input type="date" value={entryDateFrom} max={entryDateTo || undefined} onChange={(event) => setEntryDateFrom(event.target.value)} className="h-10" aria-label="Entry date from" />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">To
              <Input type="date" value={entryDateTo} min={entryDateFrom || undefined} onChange={(event) => setEntryDateTo(event.target.value)} className="h-10" aria-label="Entry date to" />
            </label>
          </div>
        </div>
        {(paymentDateFrom || paymentDateTo || entryDateFrom || entryDateTo) && (
          <div className="sm:col-span-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => {
              setPaymentDateFrom(""); setPaymentDateTo(""); setEntryDateFrom(""); setEntryDateTo("");
            }}>Clear date filters</Button>
          </div>
        )}
      </section>

      {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">Loading complete Collection Sheet...</p>}
      {error && (
        <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load the Collection Sheet. Please refresh."}
        </div>
      )}
      {!isLoading && !error && search.trim() && rows.length === 0 && !isBulkSearch && (
        <div className="mt-4 rounded-lg border p-8 text-center">
          <p className="font-semibold">Loan Number Not Found</p>
          <p className="mt-1 text-sm text-muted-foreground">No rows match the current Loan Number and Executive filters.</p>
        </div>
      )}
      {!isLoading && !error && rows.length > 0 && (
        <div className="mt-4 overflow-auto rounded-xl border">
          <table className="min-w-max w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr>
                <th className="whitespace-nowrap border-b px-3 py-3 text-left font-semibold">#</th>
                {columns.map((column) => (
                  <th key={String(column.key)} className="whitespace-nowrap border-b px-3 py-3 text-left font-semibold">{column.label}</th>
                ))}
                <th className="whitespace-nowrap border-b px-3 py-3 text-left font-semibold">Paid Flag</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.row ?? `${row.loanId ?? "row"}-${index}`} className={row.alreadyPaid ? "border-b bg-red-100 text-red-950 hover:bg-red-200" : "border-b hover:bg-muted/50"}>
                  <td className="whitespace-nowrap px-3 py-2">{row.row ?? index + 1}</td>
                  {columns.map((column) => (
                    <td key={String(column.key)} className="max-w-[320px] whitespace-nowrap px-3 py-2">
                      {displayValue(row, column)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-2 font-semibold">{row.alreadyPaid ? "Already Paid" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!isLoading && !error && isBulkSearch && (
        <section className="mt-5 rounded-xl border p-4" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Bulk Search Results</h2>
            <span className="text-sm text-muted-foreground">
              {requestedLoanIds.length - notFoundLoanIds.length} found · {notFoundLoanIds.length} not found
            </span>
          </div>
          {notFoundLoanIds.length > 0 ? (
            <>
              <p className="mt-2 text-sm font-medium text-destructive">These Loan Numbers are not present in the Collection Sheet:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {notFoundLoanIds.map((loanId) => (
                  <span key={loanId} className="rounded-md bg-destructive/10 px-2 py-1 font-mono text-sm text-destructive">{loanId}</span>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">All pasted Loan Numbers were found.</p>
          )}
        </section>
      )}
      {rows.length > 0 && (
        <section className="mt-5 rounded-xl border p-4" aria-label="Filtered collection totals">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Filtered Collection Summary</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Totals apply Already Paid, Active Excluded Loan Numbers (Small Cases), and unvalidated duplicate/conflict exclusions.
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Eligible Collection Amount</p>
              <p className="text-xl font-bold tabular-nums">
                {isExcludedLoading ? "Loading…" : excludedError ? "Unavailable" : formatAmount(summary.eligibleAmount)}
              </p>
            </div>
          </div>
          {isExcludedLoading ? (
            <p className="mt-3 text-sm text-muted-foreground">Loading the active Small Case exclusion list before calculating totals…</p>
          ) : excludedError ? (
            <p className="mt-3 text-sm text-destructive">The exclusion list could not be loaded. Totals are withheld to avoid counting Small Cases incorrectly. Refresh and try again.</p>
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
              <p className="text-lg font-semibold tabular-nums">{summary.alreadyPaidCount} · {formatAmount(summary.alreadyPaidAmount)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Small Cases Excluded</p>
              <p className="text-lg font-semibold tabular-nums">{summary.smallCaseCount} · {formatAmount(summary.smallCaseAmount)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Duplicate / Conflict Excluded</p>
              <p className="text-lg font-semibold tabular-nums">{summary.duplicateCount} · {formatAmount(summary.duplicateAmount)}</p>
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
        This page does not edit the Google Sheet. Red highlighting uses the existing Already Paid flag from the app's collection-data parser.
      </p>
    </main>
  );
}
