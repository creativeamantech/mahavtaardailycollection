import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, RotateCw, Search, Users, MapPin, TrendingUp, Receipt, Calendar } from "lucide-react";
import { getCollections } from "@/lib/mahavtaar.functions";
import { getExcludedLoanNumbers } from "@/lib/excluded-loans.functions";
import { summariseLoans, type CollectionRow } from "@/lib/loans";
import { EXECUTIVES, formatAmount, todayISO } from "@/lib/executives";
import { currentMonthKey, monthKey, monthOptions } from "@/lib/months";
import { useCategoryFilter, categoryMatches, uniqueCategories, ALL_CATEGORIES } from "@/components/AllocationFilters";
import { MonthSelect } from "@/components/MonthSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toCsv, downloadCsv } from "@/lib/export";

export const Route = createFileRoute("/_authenticated/executive-cities")({
  head: () => ({
    meta: [
      { title: "Executive City Report — Mahavtaar Daily Collection" },
      { name: "description", content: "Bucket-wise city comparison across executives." },
      { property: "og:title", content: "Executive City Report — Mahavtaar Daily Collection" },
      { property: "og:description", content: "Bucket-wise city comparison across executives." },
    ],
  }),
  component: ExecutiveCitiesPage,
});

const ALL = "__all__";
type DateFilterMode = "month" | "date" | "all";
type MetricKey = "collection" | "cases" | "mainPaid" | "paidEmi" | "posPaidNotMain" | "paidPos";

type CityMetrics = {
  collection: number;
  cases: number;
  mainPaid: number;
  paidEmi: number;
  posPaidNotMain: number;
  paidPos: number;
};
type CityRow = { city: string; executives: Record<string, CityMetrics>; total: CityMetrics };
type BucketTable = { bucket: string; rows: CityRow[]; executiveTotals: Record<string, CityMetrics>; total: CityMetrics };

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "collection", label: "Collection" },
  { key: "cases", label: "Cases" },
  { key: "mainPaid", label: "Main Paid" },
  { key: "paidEmi", label: "EMI Count" },
  { key: "posPaidNotMain", label: "POS*" },
  { key: "paidPos", label: "Paid POS" },
];

function emptyMetrics(): CityMetrics {
  return { collection: 0, cases: 0, mainPaid: 0, paidEmi: 0, posPaidNotMain: 0, paidPos: 0 };
}

function addMetrics(target: CityMetrics, source: CityMetrics) {
  target.collection += source.collection;
  target.cases += source.cases;
  target.mainPaid += source.mainPaid;
  target.paidEmi += source.paidEmi;
  target.posPaidNotMain += source.posPaidNotMain;
  target.paidPos += source.paidPos;
}

function metricText(metrics: CityMetrics, metric: MetricKey) {
  return metric === "collection" || metric === "paidPos"
    ? formatAmount(metrics[metric])
    : String(metrics[metric]);
}

export function ExecutiveCitiesPage() {
  const fetchCollections = useServerFn(getCollections);
  const fetchExcludedLoans = useServerFn(getExcludedLoanNumbers);
  const { data: excludedLoanRecords = [] } = useQuery({
    queryKey: ["excluded-loan-numbers"],
    queryFn: () => fetchExcludedLoans(),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const excludedLoanIds = useMemo(
    () => new Set(
      excludedLoanRecords
        .filter((record) => record.status.toLowerCase() === "active")
        .map((record) => record.loanNumber.trim().toUpperCase()),
    ),
    [excludedLoanRecords],
  );

  const {
    data: rawData = [],
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["collections"],
    queryFn: async () => {
      const result = await fetchCollections();
      if (Array.isArray(result)) return result;
      if (result && typeof result === "object" && "message" in result) {
        throw new Error(String((result as { message?: unknown }).message || "Failed to load collections"));
      }
      if (result && typeof result === "object" && "error" in result) {
        throw new Error(String((result as { error?: unknown }).error || "Failed to load collections"));
      }
      return [];
    },
    staleTime: 30_000,
  });

  const data = useMemo(() => (Array.isArray(rawData) ? rawData : []), [rawData]);
  const [dateMode, setDateMode] = useState<DateFilterMode>("date");
  const [selectedDate, setSelectedDate] = useState(() => todayISO());
  const userChangedDate = useRef(false);

  useEffect(() => {
    if (userChangedDate.current || data.length === 0) return;
    if (!data.some((row) => row.date === selectedDate)) {
      const dates = [...new Set(data.map((row) => row.date).filter(Boolean))].sort().reverse();
      if (dates[0]) setSelectedDate(dates[0]);
    }
  }, [data, selectedDate]);

  const months = useMemo(() => monthOptions(data.map((row) => row.date)), [data]);
  const [month, setMonth] = useState(() => currentMonthKey());
  useEffect(() => {
    if (months.length > 0 && !months.includes(month)) setMonth(months[0]!);
  }, [months, month]);

  const categories = useMemo(() => uniqueCategories(data), [data]);
  const [category, setCategory] = useCategoryFilter();
  const [bucket, setBucket] = useState(ALL);
  const buckets = useMemo(
    () => [...new Set(data.map((row) => row.bucket).filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true }),
    ),
    [data],
  );
  const [citySearch, setCitySearch] = useState("");
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>("collection");

  const filteredRows = useMemo(() => data.filter((row) => {
    if (excludedLoanIds.has(String(row.loanId ?? "").trim().toUpperCase())) return false;
    // Already Paid cases are intentionally excluded from this report.
    if (row.alreadyPaid) return false;
    if (dateMode === "month" && month && monthKey(row.date) !== month) return false;
    if (dateMode === "date" && selectedDate && row.date !== selectedDate) return false;
    if (bucket !== ALL && (row.bucket ?? "") !== bucket) return false;
    if (!categoryMatches(row.allocationCategory, category)) return false;
    return true;
  }), [data, excludedLoanIds, dateMode, month, selectedDate, bucket, category]);

  const loanSummaries = useMemo(() => {
    const rows: CollectionRow[] = filteredRows.map((row) => ({
      executive: row.executive,
      loanId: row.loanId ?? "",
      amount: row.amount,
      date: row.date,
      entryType: row.entryType ?? "",
      settlement: row.settlement ?? false,
      settlementType: row.settlementType,
      foreclosureEntry: row.foreclosureEntry,
      bucket: row.bucket ?? "",
      city: row.city ?? "",
      emiAmount: row.emiAmount ?? null,
      pos: row.pos ?? null,
      foreclosure: row.foreclosure ?? null,
    }));
    return summariseLoans(rows);
  }, [filteredRows]);

  const executiveNames = useMemo(
    () => [...new Set([...EXECUTIVES, ...loanSummaries.flatMap((loan) => loan.executives)])].filter(Boolean),
    [loanSummaries],
  );

  const bucketTables = useMemo(() => {
    const groups = new Map<string, Map<string, Record<string, CityMetrics>>>();
    for (const loan of loanSummaries) {
      const bucketName = loan.bucket || "Unassigned";
      const cityName = loan.city || "—";
      let cityMap = groups.get(bucketName);
      if (!cityMap) {
        cityMap = new Map();
        groups.set(bucketName, cityMap);
      }
      let execMap = cityMap.get(cityName);
      if (!execMap) {
        execMap = {};
        cityMap.set(cityName, execMap);
      }

      for (const executive of loan.executives) {
        const metrics = execMap[executive] ?? emptyMetrics();
        metrics.collection += loan.totalPaid;
        metrics.cases += 1;
        if (loan.mainPaid) {
          metrics.mainPaid += 1;
          metrics.paidEmi += loan.paidEmiCount;
          metrics.paidPos += loan.pos ?? 0;
        } else if (loan.posPaid) {
          metrics.posPaidNotMain += 1;
        }
        execMap[executive] = metrics;
      }
    }

    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([bucketName, cityMap]) => {
        const executiveTotals = Object.fromEntries(executiveNames.map((name) => [name, emptyMetrics()])) as Record<string, CityMetrics>;
        const total = emptyMetrics();
        const rows: CityRow[] = [...cityMap.entries()]
          .filter(([city]) => !citySearch.trim() || city.toLowerCase().includes(citySearch.trim().toLowerCase()))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([city, execMap]) => {
            const rowTotal = emptyMetrics();
            for (const [name, metrics] of Object.entries(execMap)) {
              if (!executiveTotals[name]) executiveTotals[name] = emptyMetrics();
              addMetrics(executiveTotals[name]!, metrics);
              addMetrics(rowTotal, metrics);
            }
            addMetrics(total, rowTotal);
            return { city, executives: execMap, total: rowTotal };
          });
        return { bucket: bucketName, rows, executiveTotals, total };
      })
      .filter((table) => table.rows.length > 0);
  }, [loanSummaries, executiveNames, citySearch]);

  const overall = useMemo(() => {
    const metrics = emptyMetrics();
    const cities = new Set<string>();
    for (const loan of loanSummaries) {
      metrics.collection += loan.totalPaid;
      metrics.cases += 1;
      if (loan.mainPaid) {
        metrics.mainPaid += 1;
        metrics.paidEmi += loan.paidEmiCount;
      } else if (loan.posPaid) {
        metrics.posPaidNotMain += 1;
      }
      if (loan.city) cities.add(loan.city);
    }
    metrics.paidPos = loanSummaries.filter((loan) => loan.mainPaid).reduce((sum, loan) => sum + (loan.pos ?? 0), 0);
    return { ...metrics, cityCount: cities.size };
  }, [loanSummaries]);

  const handleExportCsv = () => {
    const rows: (string | number)[][] = [];
    for (const table of bucketTables) {
      for (const row of table.rows) {
        for (const executive of executiveNames) {
          const metrics = row.executives[executive];
          if (!metrics) continue;
          rows.push([table.bucket, row.city, executive, metrics.collection, metrics.cases, metrics.mainPaid, metrics.paidEmi, metrics.posPaidNotMain, metrics.paidPos]);
        }
      }
    }
    const csv = toCsv(
      ["Bucket", "City", "Executive", "Collection", "Cases", "Main Paid", "EMI Count", "POS*", "Paid POS"],
      rows,
    );
    const dateLabel = dateMode === "month" ? month : dateMode === "date" ? selectedDate : "all-time";
    downloadCsv(`executive-city-bucket-comparison-${dateLabel}.csv`, csv);
  };

  return (
    <main className="mx-auto w-full max-w-[1600px] px-3 pb-20 pt-4 sm:px-6 sm:pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Executive City Report</h1>
          <p className="mt-1 text-sm text-muted-foreground">Bucket-wise city comparison across all executives</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-10" onClick={() => refetch()} disabled={isFetching}>
            <RotateCw className={`mr-1.5 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Syncing..." : "Refresh"}
          </Button>
          <Button size="sm" className="h-10" onClick={handleExportCsv} disabled={bucketTables.length === 0}>
            <Download className="mr-1.5 h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryCard icon={<TrendingUp className="h-4 w-4" />} label="Total Collection" value={formatAmount(overall.collection)} detail={`${overall.cases} cases`} />
        <SummaryCard icon={<Receipt className="h-4 w-4" />} label="Main Paid" value={String(overall.mainPaid)} detail={`${overall.paidEmi} EMI count`} />
        <SummaryCard icon={<MapPin className="h-4 w-4" />} label="Active Cities" value={String(overall.cityCount)} detail="Across selected buckets" />
        <SummaryCard icon={<Users className="h-4 w-4" />} label="Executives" value={String(executiveNames.length)} detail="Side-by-side comparison" />
      </div>

      <section className="mt-5 rounded-xl border bg-card p-3 sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Period</Label>
            <div className="flex rounded-lg border bg-muted/40 p-1">
              {(["date", "month", "all"] as DateFilterMode[]).map((mode) => (
                <button key={mode} type="button" className={`flex-1 rounded-md px-2 py-2 text-xs font-semibold ${dateMode === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`} onClick={() => setDateMode(mode)}>
                  {mode === "date" ? "Date-wise" : mode === "month" ? "Month-wise" : "All Time"}
                </button>
              ))}
            </div>
          </div>
          {dateMode === "date" && (
            <div className="space-y-1.5">
              <Label htmlFor="exec-city-date">Date</Label>
              <Input id="exec-city-date" type="date" className="h-11" value={selectedDate} onChange={(event) => { userChangedDate.current = true; setSelectedDate(event.target.value); }} />
            </div>
          )}
          {dateMode === "month" && <div className="space-y-1.5"><MonthSelect value={month} onChange={setMonth} options={months} /></div>}
          {dateMode === "all" && (
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <div className="flex h-11 items-center rounded-md border bg-muted/20 px-3 text-sm text-muted-foreground"><Calendar className="mr-2 h-4 w-4" />All dates recorded</div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Bucket</Label>
            <Select value={bucket} onValueChange={setBucket}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All Buckets</SelectItem>
                {buckets.map((value) => <SelectItem key={value} value={value}>Bucket {value}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Allocation Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CATEGORIES}>All Categories</SelectItem>
                {categories.map((value) => <SelectItem key={value} value={value}>Category {value}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-2">
            <Label>Search City</Label>
            <div className="relative">
              <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
              <Input value={citySearch} onChange={(event) => setCitySearch(event.target.value)} placeholder="Type a city name..." className="h-11 pl-9" />
            </div>
          </div>
        </div>
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">Already Paid cases are always excluded from this report.</p>
      </section>

      <section className="mt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">City-wise Executive Comparison</h2>
            <p className="text-xs text-muted-foreground">हर Bucket की अलग टेबल — City की एक row में सभी executives का comparison</p>
          </div>
          <span className="text-xs text-muted-foreground">{executiveNames.length} executives · {bucketTables.reduce((sum, table) => sum + table.rows.length, 0)} city rows</span>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {METRICS.map((item) => (
            <button key={item.key} type="button" onClick={() => setSelectedMetric(item.key)} className={`rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${selectedMetric === item.key ? "border-amber-400 bg-amber-100 text-amber-950" : "bg-background text-muted-foreground hover:bg-muted"}`}>
              {item.label}
            </button>
          ))}
        </div>

        {isLoading && <div className="rounded-xl border p-10 text-center text-sm text-muted-foreground"><RotateCw className="mx-auto mb-2 h-5 w-5 animate-spin" />Loading city comparison...</div>}
        {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-center text-sm text-destructive"><p className="font-semibold">Could not load collection data</p><p className="mt-1">{error instanceof Error ? error.message : "An error occurred while fetching data."}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Try Again</Button></div>}
        {!isLoading && !error && bucketTables.length === 0 && <div className="rounded-xl border p-10 text-center text-sm text-muted-foreground">No city records found for the selected filters.</div>}

        <div className="space-y-5">
          {bucketTables.map((table) => (
            <BucketComparisonTable key={table.bucket} table={table} executives={executiveNames} metric={selectedMetric} />
          ))}
        </div>
      </section>
    </main>
  );
}

function SummaryCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}<span>{label}</span></div>
      <p className="mt-1 text-lg font-bold tabular-nums sm:text-xl">{value}</p>
      <p className="text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function BucketComparisonTable({ table, executives, metric }: { table: BucketTable; executives: string[]; metric: MetricKey }) {
  const cellClass = "whitespace-nowrap border-b px-3 py-2.5 text-right tabular-nums";
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b bg-amber-50 px-4 py-3">
        <div>
          <h3 className="font-bold text-amber-950">{table.bucket === "Unassigned" ? table.bucket : `Bucket ${table.bucket}`}</h3>
          <p className="text-[11px] text-amber-900/75">{table.rows.length} cities · comparing {metric === "posPaidNotMain" ? "POS*" : METRICS.find((item) => item.key === metric)?.label}</p>
        </div>
        <span className="text-xs font-semibold text-amber-950">{metricText(table.total, metric)} total</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs sm:text-sm">
          <thead>
            <tr className="bg-muted/50 text-muted-foreground">
              <th className="sticky left-0 z-20 min-w-[125px] border-b bg-muted/90 px-3 py-3 text-left font-bold">City</th>
              {executives.map((executive) => (
                <th key={executive} className="min-w-[112px] border-b px-3 py-3 text-right font-bold">{executive}</th>
              ))}
              <th className="min-w-[112px] border-b bg-amber-50 px-3 py-3 text-right font-bold text-amber-950">City Total</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.city} className="hover:bg-muted/30">
                <th className="sticky left-0 z-10 border-b bg-background px-3 py-3 text-left font-semibold">{row.city}</th>
                {executives.map((executive) => {
                  const value = row.executives[executive];
                  return (
                    <td key={executive} className={cellClass}>
                      {value ? <><span className="font-semibold text-foreground">{metricText(value, metric)}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{value.cases} cases</span></> : <span className="text-muted-foreground">—</span>}
                    </td>
                  );
                })}
                <td className="border-b bg-amber-50/60 px-3 py-2.5 text-right font-bold tabular-nums text-amber-950">{metricText(row.total, metric)}<span className="mt-0.5 block text-[10px] font-normal text-amber-900/70">{row.total.cases} cases</span></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-muted/60 font-bold">
              <th className="sticky left-0 z-10 bg-muted/90 px-3 py-3 text-left">BUCKET TOTAL</th>
              {executives.map((executive) => {
                const value = table.executiveTotals[executive];
                return <td key={executive} className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{value ? metricText(value, metric) : "—"}<span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">{value?.cases ?? 0} cases</span></td>;
              })}
              <td className="bg-amber-100 px-3 py-3 text-right tabular-nums text-amber-950">{metricText(table.total, metric)}<span className="mt-0.5 block text-[10px] font-normal">{table.total.cases} cases</span></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="border-t bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground">Swipe horizontally to compare all executives. POS* = POS Paid but not Main Paid.</div>
    </div>
  );
}
