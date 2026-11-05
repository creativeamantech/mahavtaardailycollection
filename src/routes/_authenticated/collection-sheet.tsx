import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, RefreshCw, X, Download } from "lucide-react";

import { getCollections } from "@/lib/mahavtaar.functions";
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

function CollectionSheetPage() {
  const fetchCollections = useServerFn(getCollections);
  const [search, setSearch] = useState("");
  const [executiveFilter, setExecutiveFilter] = useState("__all__");
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
  const normalizedQuery = normaliseLoanId(search);
  const executives = useMemo(
    () => [...new Set(allRows.map((row) => String(row.executive ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [allRows],
  );
  const rows = useMemo(() => allRows.filter((row) => {
    const matchesLoan = !normalizedQuery || normaliseLoanId(row.loanId).includes(normalizedQuery);
    const matchesExecutive = executiveFilter === "__all__" || String(row.executive ?? "").trim() === executiveFilter;
    return matchesLoan && matchesExecutive;
  }), [allRows, normalizedQuery, executiveFilter]);

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
            placeholder="Search by Loan Number (full or partial)"
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

      {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">Loading complete Collection Sheet...</p>}
      {error && (
        <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load the Collection Sheet. Please refresh."}
        </div>
      )}
      {!isLoading && !error && normalizedQuery && rows.length === 0 && (
        <div className="mt-4 rounded-lg border p-8 text-center">
          <p className="font-semibold">{normalizedQuery ? "Loan Number Not Found" : "No matching rows"}</p>
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
      <p className="mt-3 text-xs text-muted-foreground">
        This page does not edit the Google Sheet. Red highlighting uses the existing Already Paid flag from the app's collection-data parser.
      </p>
    </main>
  );
}
