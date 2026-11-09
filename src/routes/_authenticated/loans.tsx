import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "@/lib/auth.functions";
import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getCollections } from "@/lib/mahavtaar.functions";
import { getExcludedLoanNumbers } from "@/lib/excluded-loans.functions";
import { formatAmount, todayISO } from "@/lib/executives";
import {
  summariseLoans,
  shortEmiRows,
  executiveSections,
  type ExecutiveMetrics,
  type ReportSection,
  type LoanSummary,
} from "@/lib/loans";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ALL_CATEGORIES,
  CategoryFilter,
  AllocationTypeFilter,
  allocationTypeMatches,
  uniqueAllocationTypes,
  useAllocationTypeFilter,
  categoryMatches,
  uniqueCategories,
  useCategoryFilter,
} from "@/components/AllocationFilters";
import { MonthSelect } from "@/components/MonthSelect";
import { currentMonthKey, monthKey, monthOptions } from "@/lib/months";

export const Route = createFileRoute("/_authenticated/loans")({
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
      { title: "Loan Search & EMI Status — Mahavtaar Daily Collection" },
      {
        name: "description",
        content:
          "Search a Loan ID to check sequential EMI status, short amount, POS and settlement, plus EMI count and city/bucket executive reports.",
      },
      { property: "og:title", content: "Loan Search & EMI Status" },
      {
        property: "og:description",
        content: "Loan ID search, sequential EMI short tracking and bucket/city executive reports.",
      },
    ],
  }),
  component: LoansPage,
});

const ALL = "__all__";

function statusClass(status: string) {
  if (status === "Settlement Paid") return "bg-violet-100 text-violet-800";
  if (status === "EMI Paid") return "bg-emerald-100 text-emerald-800";
  if (status.startsWith("POS Paid") || status === "Foreclosure Paid")
    return "bg-sky-100 text-sky-800";
  if (status === "EMI Short Amount") return "bg-amber-100 text-amber-900";
  return "bg-muted text-muted-foreground";
}

function money(v: number | null) {
  return v === null ? "" : formatAmount(v);
}

function LoansPage() {
  const fetchCollections = useServerFn(getCollections);
  const fetchExcludedLoans = useServerFn(getExcludedLoanNumbers);
  const { data: excludedLoanRecords = [] } = useQuery({
    queryKey: ["excluded-loan-numbers"],
    queryFn: () => fetchExcludedLoans(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const excludedLoanIds = useMemo(
    () =>
      new Set(
        excludedLoanRecords
          .filter((r) => r.status.toLowerCase() === "active")
          .map((r) => r.loanNumber.trim().toUpperCase()),
      ),
    [excludedLoanRecords],
  );
  // One batch read of the whole dataset — search, EMI maths and every report
  // below reuse this single result. No per-loan or per-filter API calls.
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["collections"],
    queryFn: async () => {
      const res = await fetchCollections();
      if (!Array.isArray(res)) {
        if (res && typeof res === "object" && "message" in res) {
          throw new Error(
            String((res as { message?: unknown }).message || "Failed to load collections"),
          );
        }
        if (res && typeof res === "object" && "error" in res) {
          throw new Error(
            String((res as { error?: unknown }).error || "Failed to load collections"),
          );
        }
        throw new Error("Unable to load collections from server");
      }
      return res;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const collections = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  // Already Paid payments (before Allocation Date) never count as collection.
  const [category, setCategory] = useCategoryFilter();
  const [allocationType, setAllocationType] = useAllocationTypeFilter();
  const allocationTypes = useMemo(() => uniqueAllocationTypes(collections), [collections]);
  const categories = useMemo(() => uniqueCategories(collections), [collections]);
  const allRows = useMemo(
    () =>
      collections.filter(
        (r) =>
          !r.alreadyPaid &&
          !excludedLoanIds.has(
            String(r.loanId ?? "")
              .trim()
              .toUpperCase(),
          ) &&
          categoryMatches(r.allocationCategory, category) &&
          allocationTypeMatches(r.allocationType, allocationType),
      ),
    [collections, category, allocationType, excludedLoanIds],
  );
  const [month, setMonth] = useState(currentMonthKey());
  const months = useMemo(() => monthOptions(collections.map((r) => r.date)), [collections]);
  // Month-scoped dataset — searches and every report below reuse it.
  const rows = useMemo(() => allRows.filter((r) => monthKey(r.date) === month), [allRows, month]);
  const loans = useMemo(() => summariseLoans(rows), [rows]);

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const results = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return [];
    const filtered = loans.filter((l) => l.loanId.toLowerCase().includes(q));
    const seen = new Set<string>();
    return filtered.filter((l) => {
      if (seen.has(l.loanId)) return false;
      seen.add(l.loanId);
      return true;
    });
  }, [loans, deferredQuery]);

  const [showShort, setShowShort] = useState(false);
  const shorts = useMemo(() => shortEmiRows(loans), [loans]);

  // Date-wise city report
  const [date, setDate] = useState(todayISO());
  const [dateBucket, setDateBucket] = useState(ALL);
  const buckets = useMemo(
    () => [...new Set(loans.map((l) => l.bucket))].filter(Boolean).sort(),
    [loans],
  );
  const dateSections = useMemo(() => {
    const scoped = rows.filter(
      (r) => r.date === date && (dateBucket === ALL || (r.bucket ?? "") === dateBucket),
    );
    return executiveSections(summariseLoans(scoped));
  }, [rows, date, dateBucket]);

  // The two report views reuse the same already-fetched month dataset.
  const [reportTab, setReportTab] = useState<"date" | "overall">("date");
  const [overallBucket, setOverallBucket] = useState(ALL);
  const overallSections = useMemo(
    () =>
      reportTab === "overall"
        ? [
            ...executiveSections(
              overallBucket === ALL ? loans : loans.filter((loan) => loan.bucket === overallBucket),
            ),
          ].sort(
            (a, b) => a.bucket.localeCompare(b.bucket) || a.city.localeCompare(b.city),
          )
        : [],
    [loans, reportTab, overallBucket],
  );

  return (
    <main className="mx-auto w-full max-w-[1440px] bg-white px-4 pb-16 pt-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Loan Details</h1>
          <p className="mt-1 text-base text-muted-foreground">
            Search a Loan ID to verify its payment and EMI status.
          </p>
        </div>
        <Button
          variant="outline"
          className="h-11 border-amber-300 bg-white text-slate-800 hover:bg-amber-50"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/40 p-3 [&_button]:border-amber-200 [&_button]:bg-white">
        <MonthSelect value={month} onChange={setMonth} options={months} />
      </div>
      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3 [&_button]:border-amber-200 [&_button]:bg-white">
        <CategoryFilter value={category} onChange={setCategory} options={categories} />
      </div>
      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3 [&_button]:border-amber-200 [&_button]:bg-white">
        <AllocationTypeFilter value={allocationType} onChange={setAllocationType} options={allocationTypes} />
      </div>

      {isLoading && <p className="mt-6 text-base">Loading loan details...</p>}
      {error && (
        <p className="mt-6 text-base text-destructive">
          Could not load loan details. Tap Refresh to try again.
        </p>
      )}

      <form
        className="mt-6 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search);
        }}
      >
        <div className="w-full min-w-0 flex-1 space-y-2 sm:min-w-[200px]">
          <Label className="text-base" htmlFor="loan-search">
            Loan ID / Loan Number
          </Label>
          <Input
            id="loan-search"
            className="h-12 border-amber-200 bg-white text-base focus-visible:ring-amber-300"
            placeholder="Enter Loan ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button type="submit" className="h-12 bg-amber-300 text-amber-950 hover:bg-amber-400">
          Search
        </Button>
      </form>

      {query.trim() !== "" && (
        <div className="mt-4 space-y-3">
          {results.length === 0 ? (
            <p className="rounded-xl border p-6 text-center text-base">
              No loan found for "{query}".
            </p>
          ) : (
            results.map((l, idx) => <LoanCard key={`${l.loanId}-${idx}`} loan={l} />)
          )}
        </div>
      )}

      <section className="mt-10">
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button
            variant="outline"
            className="h-11 border-amber-300 bg-white text-slate-800 hover:bg-amber-50"
            onClick={() => setShowShort((s) => !s)}
          >
            {showShort ? "Hide Short EMIs" : "View Short EMIs"}
          </Button>
        </div>

        {showShort && (
          <div className="mt-3 overflow-x-auto rounded-xl border">
            <table className="w-full text-xs sm:text-base">
              <thead className="bg-muted/50">
                <tr>
                  <Th>Executive</Th>
                  <Th>Loan ID</Th>
                  <Th>Short EMI</Th>
                  <Th right>Short Amount</Th>
                  <Th>POS Status</Th>
                </tr>
              </thead>
              <tbody>
                {shorts.length === 0 ? (
                  <tr className="border-t">
                    <td className="p-3 text-center" colSpan={5}>
                      No short EMIs.
                    </td>
                  </tr>
                ) : (
                  shorts.map((s, idx) => (
                    <tr key={`${s.loanId}-${s.shortEmi}-${idx}`} className="border-t">
                      <Td>{s.executive}</Td>
                      <Td>{s.loanId}</Td>
                      <Td>{s.shortEmi}</Td>
                      <Td right>{formatAmount(s.shortAmount)}</Td>
                      <Td>{s.posStatus}</Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <div
          role="tablist"
          aria-label="Loan reports"
          className="grid grid-cols-2 rounded-xl border border-amber-200 bg-amber-50 p-1"
        >
          <button
            type="button"
            role="tab"
            id="date-report-tab"
            aria-selected={reportTab === "date"}
            aria-controls="date-report-panel"
            onClick={() => setReportTab("date")}
            className={`min-h-12 rounded-lg px-3 py-2 text-sm font-semibold transition-colors sm:text-base ${
              reportTab === "date"
                ? "bg-amber-300 text-amber-950 shadow-sm"
                : "text-slate-600 hover:bg-amber-100"
            }`}
          >
            Date-wise
          </button>
          <button
            type="button"
            role="tab"
            id="overall-report-tab"
            aria-selected={reportTab === "overall"}
            aria-controls="overall-report-panel"
            onClick={() => setReportTab("overall")}
            className={`min-h-12 rounded-lg px-3 py-2 text-sm font-semibold transition-colors sm:text-base ${
              reportTab === "overall"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            Overall
          </button>
        </div>

        {reportTab === "date" ? (
          <div
            id="date-report-panel"
            role="tabpanel"
            aria-labelledby="date-report-tab"
            className="pt-4"
          >
            <h2 className="text-xl font-bold tracking-tight">Date-wise City &amp; Bucket Report</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-base" htmlFor="report-date">
                  Date
                </Label>
                <Input
                  id="report-date"
                  type="date"
                  className="h-12 border-amber-200 bg-white text-base focus-visible:ring-amber-300"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-base">Bucket</Label>
                <Select value={dateBucket} onValueChange={setDateBucket}>
                  <SelectTrigger className="h-12 border-amber-200 bg-white text-base focus:ring-amber-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL} className="text-base">
                      All Buckets
                    </SelectItem>
                    {buckets.map((b) => (
                      <SelectItem key={b} value={b} className="text-base">
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {dateSections.length === 0 ? (
              <p className="mt-3 rounded-xl border p-6 text-center text-base">
                No paid cases for this date.
              </p>
            ) : (
              <div className="mt-4 space-y-5">
                {dateSections.map((s) => (
                  <SectionTable key={s.key} title={`${s.bucket} — ${s.city}`} section={s} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div
            id="overall-report-panel"
            role="tabpanel"
            aria-labelledby="overall-report-tab"
            className="pt-4"
          >
            <h2 className="text-xl font-bold tracking-tight">Overall Bucket &amp; City Report</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              All dates in {month} for the selected allocation category.
            </p>
            <div className="mt-3 max-w-sm space-y-2">
              <Label className="text-base" htmlFor="overall-bucket-filter">
                Bucket
              </Label>
              <Select value={overallBucket} onValueChange={setOverallBucket}>
                <SelectTrigger
                  id="overall-bucket-filter"
                  className="h-12 border-amber-200 bg-white text-base focus:ring-amber-300"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL} className="text-base">
                    All Buckets
                  </SelectItem>
                  {buckets.map((b) => (
                    <SelectItem key={b} value={b} className="text-base">
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {overallSections.length === 0 ? (
              <p className="mt-3 rounded-xl border p-6 text-center text-base">No data yet.</p>
            ) : (
              <div className="mt-4 space-y-5">
                {overallSections.map((s) => (
                  <SectionTable key={s.key} title={`${s.bucket} — ${s.city}`} section={s} />
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

const METRIC_COLS = [
  { label: "Collection", get: (m: ExecutiveMetrics) => formatAmount(m.collection) },
  { label: "Cases", get: (m: ExecutiveMetrics) => String(m.cases) },
  { label: "Main", get: (m: ExecutiveMetrics) => String(m.mainPaid) },
  { label: "EMI", get: (m: ExecutiveMetrics) => String(m.paidEmi) },
  { label: "POS*", get: (m: ExecutiveMetrics) => String(m.posPaidNotMain) },
  { label: "Paid POS", get: (m: ExecutiveMetrics) => formatAmount(m.paidPos) },
] as const;

function SectionTable({ title, section }: { title: string; section: ReportSection }) {
  const cell = "whitespace-nowrap px-1 py-1.5 sm:px-2 sm:py-2";
  return (
    <div className="rounded-xl border border-amber-200 bg-white shadow-sm">
      <p className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold break-words text-slate-900 sm:text-base">
        {title}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] leading-tight sm:text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className={`${cell} max-w-[72px] truncate text-left font-semibold sm:max-w-none`}>
                Exec
              </th>
              {METRIC_COLS.map((c) => (
                <th key={c.label} className={`${cell} text-right font-semibold`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((r, idx) => (
              <tr key={`${r.executive}-${idx}`} className="border-b last:border-b-0">
                <td className={`${cell} max-w-[72px] truncate text-left sm:max-w-none`}>
                  {r.executive}
                </td>
                {METRIC_COLS.map((c) => (
                  <td key={c.label} className={`${cell} text-right tabular-nums`}>
                    {c.get(r)}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t-2 border-amber-300 bg-amber-100 font-bold text-slate-900">
              <td className={`${cell} text-left`}>TOTAL</td>
              {METRIC_COLS.map((c) => (
                <td key={c.label} className={`${cell} text-right tabular-nums`}>
                  {c.get(section.total)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="border-t px-3 py-1.5 text-[10px] text-muted-foreground sm:text-xs">
        POS* = POS Paid but not Main Paid.
      </p>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`whitespace-nowrap px-2 py-2 text-xs font-semibold sm:p-3 sm:text-sm ${right ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <td className={`whitespace-nowrap px-2 py-2 sm:p-3 ${right ? "text-right" : "text-left"}`}>
      {children}
    </td>
  );
}

function LoanCard({ loan }: { loan: LoanSummary }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-lg font-bold">{loan.loanId}</p>
          <p className="text-sm text-muted-foreground">{loan.executive}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${statusClass(loan.status)}`}
        >
          {loan.status}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-base">
        <Field k="Bucket" v={loan.bucket} />
        <Field k="City" v={loan.city} />
        <Field k="EMI Amount" v={money(loan.emiAmount)} />
        <Field
          k="Applicable EMI Count"
          v={loan.applicableEmiCount === null ? "" : `${loan.applicableEmiCount} EMI`}
        />
        <Field k="Total EMI Required" v={money(loan.totalEmiRequired)} />
        <Field k="Total Amount Paid" v={`${formatAmount(loan.totalPaid)} (${loan.payments})`} />
        <Field
          k="Current / Next Short EMI"
          v={loan.currentShortEmi === null ? "" : `EMI ${loan.currentShortEmi}`}
        />
        <Field k="Short Amount" v={money(loan.shortAmount)} />
        <Field k="Principal Outstanding" v={money(loan.pos)} />
        <Field k="POS Status" v={loan.pos === null ? "" : loan.posPaid ? "Paid" : "Not Paid"} />
        <Field k="Approx. Foreclosure" v={money(loan.foreclosure)} />
        <Field k="Payment Status" v={loan.status} />
        <Field k="Main Paid" v={loan.mainPaid ? "Yes" : "No"} />
        <Field k="Paid EMI Count" v={`${loan.paidEmiCount}`} />
        <Field k="Settlement" v={loan.settlement ? "Settlement Paid" : ""} />
        <Field k="Last Payment" v={loan.lastDate} />
      </dl>

      <div className="mt-3 flex flex-wrap gap-1">
        {loan.settlement && <Tag className="bg-violet-100 text-violet-800">Settlement Paid</Tag>}
        {loan.emiPaid && <Tag className="bg-emerald-100 text-emerald-800">EMI Paid</Tag>}
        {loan.mainPaid && <Tag className="bg-emerald-100 text-emerald-800">Main Paid</Tag>}
        {loan.posPaid && (
          <Tag className="bg-sky-100 text-sky-800">
            {loan.mainPaid ? "POS Paid" : "POS Paid — Not Main Paid"}
          </Tag>
        )}
        {loan.foreclosurePaid && <Tag className="bg-sky-100 text-sky-800">Foreclosure Paid</Tag>}
      </div>
    </div>
  );
}

function Tag({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>
      {children}
    </span>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{k}</dt>
      <dd className="font-semibold">{v || "—"}</dd>
    </div>
  );
}
