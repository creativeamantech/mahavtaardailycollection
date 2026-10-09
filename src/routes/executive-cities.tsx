import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Download,
  RotateCw,
  Search,
  Users,
  MapPin,
  TrendingUp,
  Receipt,
  Layers,
  Calendar,
  Filter,
} from "lucide-react";
import { getCollections } from "@/lib/mahavtaar.functions";
import {
  summariseLoans,
  executiveCitySections,
  type CollectionRow,
  type ExecutiveCitySection,
  type ExecutiveCityRow,
} from "@/lib/loans";
import { EXECUTIVES, formatAmount, todayISO } from "@/lib/executives";
import { currentMonthKey, monthKey, monthOptions } from "@/lib/months";
import {
  useCategoryFilter,
  categoryMatches,
  uniqueCategories,
  ALL_CATEGORIES,
} from "@/components/AllocationFilters";
import { MonthSelect } from "@/components/MonthSelect";
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
import { toCsv, downloadCsv } from "@/lib/export";

export const Route = createFileRoute("/executive-cities")({
  head: () => ({
    meta: [
      { title: "Executive-wise City Report — Mahavtaar Daily Collection" },
      {
        name: "description",
        content:
          "Executive-wise and city-wise breakdown tables showing collection, cases, EMIs and POS metrics.",
      },
      { property: "og:title", content: "Executive-wise City Report — Mahavtaar Daily Collection" },
      {
        property: "og:description",
        content:
          "Executive-wise and city-wise breakdown tables showing collection, cases, EMIs and POS metrics.",
      },
    ],
  }),
  component: ExecutiveCitiesPage,
});

const ALL = "__all__";

type DateFilterMode = "month" | "date" | "all";

export function ExecutiveCitiesPage() {
  const fetchCollections = useServerFn(getCollections);
  const {
    data: rawData = [],
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["collections"],
    queryFn: async () => {
      const res = await fetchCollections();
      if (Array.isArray(res)) return res;
      if (res && typeof res === "object" && "message" in res) {
        throw new Error(
          String((res as { message?: unknown }).message || "Failed to load collections"),
        );
      }
      if (res && typeof res === "object" && "error" in res) {
        throw new Error(String((res as { error?: unknown }).error || "Failed to load collections"));
      }
      return [];
    },
    staleTime: 30_000,
  });

  const data = useMemo(() => (Array.isArray(rawData) ? rawData : []), [rawData]);

  const [dateMode, setDateMode] = useState<DateFilterMode>("date");
  const [selectedDate, setSelectedDate] = useState(() => todayISO());
  const userChangedDate = useRef(false);

  // If today has no records in the dataset, fallback to the latest available date
  useEffect(() => {
    if (userChangedDate.current || data.length === 0) return;
    const hasCurrent = data.some((r) => r.date === selectedDate);
    if (!hasCurrent) {
      const datesWithData = [...new Set(data.map((r) => r.date).filter(Boolean))].sort().reverse();
      if (datesWithData.length > 0 && datesWithData[0]) {
        setSelectedDate(datesWithData[0]);
      }
    }
  }, [data, selectedDate]);

  const months = useMemo(() => monthOptions(data.map((r) => r.date)), [data]);
  const [month, setMonth] = useState(() => currentMonthKey());

  // If current month has no data yet, automatically switch to first available month
  useEffect(() => {
    if (months.length > 0 && !months.some((m) => m.key === month)) {
      setMonth(months[0]!.key);
    }
  }, [months, month]);

  const categories = useMemo(() => uniqueCategories(data), [data]);
  const [category, setCategory] = useCategoryFilter();

  const [bucket, setBucket] = useState(ALL);
  const buckets = useMemo(
    () => [...new Set(data.map((r) => r.bucket).filter(Boolean))].sort(),
    [data],
  );

  const [selectedExecutive, setSelectedExecutive] = useState<string>(ALL);
  const [citySearch, setCitySearch] = useState("");
  const [includeBucket, setIncludeBucket] = useState(false);
  const [excludeAlreadyPaid, setExcludeAlreadyPaid] = useState(true);

  // Count already paid cases in total dataset
  const alreadyPaidCount = useMemo(() => data.filter((r) => r.alreadyPaid).length, [data]);

  // Filter raw collection rows based on selected filters
  const filteredRows = useMemo(() => {
    return data.filter((r) => {
      // Exclude Already Paid (matching loans.tsx city table by default)
      if (excludeAlreadyPaid && r.alreadyPaid) return false;

      // Date filter
      if (dateMode === "month") {
        if (month && monthKey(r.date) !== month) return false;
      } else if (dateMode === "date") {
        if (selectedDate && r.date !== selectedDate) return false;
      }

      // Bucket filter
      if (bucket !== ALL && (r.bucket ?? "") !== bucket) return false;

      // Category filter
      if (!categoryMatches(r.allocationCategory, category)) return false;

      return true;
    });
  }, [data, excludeAlreadyPaid, dateMode, month, selectedDate, bucket, category]);

  // Summarise loans for the filtered scope
  const loanSummaries = useMemo(() => {
    const rows: CollectionRow[] = filteredRows.map((r) => ({
      executive: r.executive,
      loanId: r.loanId ?? "",
      amount: r.amount,
      date: r.date,
      entryType: r.entryType ?? "",
      settlement: r.settlement ?? false,
      settlementType: r.settlementType,
      foreclosureEntry: r.foreclosureEntry,
      bucket: r.bucket ?? "",
      city: r.city ?? "",
      emiAmount: r.emiAmount ?? null,
      pos: r.pos ?? null,
      foreclosure: r.foreclosure ?? null,
    }));
    return summariseLoans(rows);
  }, [filteredRows]);

  // Compute executive-wise city sections
  const sections = useMemo(() => {
    return executiveCitySections(loanSummaries, { includeBucket });
  }, [loanSummaries, includeBucket]);

  // Filter sections by selected executive & search term
  const displayedSections = useMemo(() => {
    const q = citySearch.trim().toLowerCase();

    return sections
      .filter((s) => selectedExecutive === ALL || s.executive === selectedExecutive)
      .map((s) => {
        if (!q) return s;
        const matchingRows = s.rows.filter((r) => r.city.toLowerCase().includes(q));
        const total: ExecutiveCityRow = {
          city: "TOTAL",
          collection: 0,
          cases: 0,
          mainPaid: 0,
          paidEmi: 0,
          posPaidNotMain: 0,
          paidPos: 0,
        };
        for (const r of matchingRows) {
          total.collection += r.collection;
          total.cases += r.cases;
          total.mainPaid += r.mainPaid;
          total.paidEmi += r.paidEmi;
          total.posPaidNotMain += r.posPaidNotMain;
          total.paidPos += r.paidPos;
        }
        return {
          ...s,
          rows: matchingRows,
          total,
        };
      })
      .filter((s) => s.rows.length > 0 || selectedExecutive !== ALL);
  }, [sections, selectedExecutive, citySearch]);

  // Overall metrics across all displayed sections
  const overallMetrics = useMemo(() => {
    let totalCollection = 0;
    let totalCases = 0;
    let totalMainPaid = 0;
    let totalEmi = 0;
    const activeCities = new Set<string>();
    let topExec = { name: "—", collection: 0 };

    for (const s of sections) {
      if (s.total.collection > topExec.collection) {
        topExec = { name: s.executive, collection: s.total.collection };
      }
      totalCollection += s.total.collection;
      totalCases += s.total.cases;
      totalMainPaid += s.total.mainPaid;
      totalEmi += s.total.paidEmi;
      for (const r of s.rows) {
        activeCities.add(r.city.split(" (")[0].trim());
      }
    }

    return {
      totalCollection,
      totalCases,
      totalMainPaid,
      totalEmi,
      cityCount: activeCities.size,
      topExecutive: topExec,
    };
  }, [sections]);

  // CSV Export handler
  const handleExportCsv = () => {
    const exportRows: (string | number)[][] = [];

    for (const s of displayedSections) {
      for (const r of s.rows) {
        exportRows.push([
          s.executive,
          r.city,
          r.bucket ?? "",
          r.collection,
          r.cases,
          r.mainPaid,
          r.paidEmi,
          r.posPaidNotMain,
          r.paidPos,
        ]);
      }
      // Add executive total line
      exportRows.push([
        s.executive,
        "TOTAL",
        "",
        s.total.collection,
        s.total.cases,
        s.total.mainPaid,
        s.total.paidEmi,
        s.total.posPaidNotMain,
        s.total.paidPos,
      ]);
    }

    const headers = [
      "Executive Name",
      "City",
      "Bucket",
      "Collection Amount",
      "Cases Count",
      "Main Paid Cases",
      "Paid EMI Count",
      "POS* Cases",
      "Paid POS Amount",
    ];

    const csv = toCsv(headers, exportRows);
    const dateLabel =
      dateMode === "month" ? month : dateMode === "date" ? selectedDate : "all-time";
    downloadCsv(`executive-cities-report-${dateLabel}.csv`, csv);
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-3 pb-20 pt-6 sm:px-6">
      {/* Page Title & Controls */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Executive City Report</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            हर एक एग्जीक्यूटिव की सिटी-वाइज कलेक्शन और परफॉर्मेंस टेबल
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-10 text-sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RotateCw className={`mr-1.5 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Syncing..." : "Refresh"}
          </Button>
          <Button
            variant="default"
            size="sm"
            className="h-10 text-sm"
            onClick={handleExportCsv}
            disabled={displayedSections.length === 0}
          >
            <Download className="mr-1.5 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Top Stat Cards */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-3 sm:p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span>Total Collection</span>
          </div>
          <p className="mt-1 text-lg font-bold sm:text-2xl">
            {formatAmount(overallMetrics.totalCollection)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {overallMetrics.totalCases} cases across {overallMetrics.cityCount} cities
          </p>
        </div>

        <div className="rounded-xl border bg-card p-3 sm:p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
            <Receipt className="h-4 w-4 text-emerald-600" />
            <span>Main Paid Cases</span>
          </div>
          <p className="mt-1 text-lg font-bold text-emerald-700 sm:text-2xl">
            {overallMetrics.totalMainPaid}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {overallMetrics.totalEmi} EMIs cleared
          </p>
        </div>

        <div className="rounded-xl border bg-card p-3 sm:p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
            <MapPin className="h-4 w-4 text-blue-600" />
            <span>Active Cities</span>
          </div>
          <p className="mt-1 text-lg font-bold sm:text-2xl">{overallMetrics.cityCount}</p>
          <p className="text-[11px] text-muted-foreground">Cities with collections</p>
        </div>

        <div className="rounded-xl border bg-card p-3 sm:p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
            <Users className="h-4 w-4 text-amber-600" />
            <span>Top Executive</span>
          </div>
          <p className="mt-1 text-lg font-bold truncate sm:text-2xl">
            {overallMetrics.topExecutive.name}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {formatAmount(overallMetrics.topExecutive.collection)}
          </p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <section className="mt-6 rounded-xl border bg-card p-4 space-y-4">
        {/* Date Filter Selection */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Period Type
            </Label>
            <div className="flex rounded-lg border bg-muted/40 p-1">
              <button
                type="button"
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-all ${
                  dateMode === "date"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setDateMode("date")}
              >
                Date-wise
              </button>
              <button
                type="button"
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-all ${
                  dateMode === "month"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setDateMode("month")}
              >
                Month-wise
              </button>
              <button
                type="button"
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-all ${
                  dateMode === "all"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setDateMode("all")}
              >
                All Time
              </button>
            </div>
          </div>

          {dateMode === "date" && (
            <div className="space-y-1.5">
              <Label className="text-base" htmlFor="exec-city-date">
                Date
              </Label>
              <Input
                id="exec-city-date"
                type="date"
                className="h-12 text-base"
                value={selectedDate}
                onChange={(e) => {
                  userChangedDate.current = true;
                  setSelectedDate(e.target.value);
                }}
              />
            </div>
          )}

          {dateMode === "month" && (
            <div className="space-y-1.5">
              <MonthSelect value={month} onChange={setMonth} options={months} />
            </div>
          )}

          {dateMode === "all" && (
            <div className="space-y-1.5">
              <Label className="text-base">Scope</Label>
              <div className="flex h-12 items-center rounded-lg border bg-muted/20 px-3 text-sm text-muted-foreground">
                <Calendar className="mr-2 h-4 w-4" />
                All Dates Recorded
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-base">Bucket</Label>
            <Select value={bucket} onValueChange={setBucket}>
              <SelectTrigger className="h-12 text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL} className="text-base">
                  All Buckets
                </SelectItem>
                {buckets.map((b) => (
                  <SelectItem key={b} value={b} className="text-base">
                    Bucket {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Secondary filters: Category, City Search, and Bucket Grouping toggle */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-base">Allocation Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-12 text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CATEGORIES} className="text-base">
                  All Categories
                </SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c} className="text-base">
                    Category {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-base">Search City</Label>
            <div className="relative">
              <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Filter by city name..."
                className="h-12 pl-9 text-base"
                value={citySearch}
                onChange={(e) => setCitySearch(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5 flex flex-col justify-end gap-2 sm:flex-row">
            <Button
              type="button"
              variant={includeBucket ? "default" : "outline"}
              className="h-12 flex-1 text-sm font-medium"
              onClick={() => setIncludeBucket((prev) => !prev)}
            >
              <Layers className="mr-2 h-4 w-4" />
              {includeBucket ? "Breakdown: City + Bucket" : "Breakdown: City Only"}
            </Button>

            {alreadyPaidCount > 0 && (
              <Button
                type="button"
                variant={excludeAlreadyPaid ? "outline" : "secondary"}
                className={`h-12 text-sm font-medium ${
                  excludeAlreadyPaid
                    ? "text-muted-foreground"
                    : "border-red-300 bg-red-50 text-red-700"
                }`}
                onClick={() => setExcludeAlreadyPaid((prev) => !prev)}
              >
                <Filter className="mr-2 h-4 w-4 text-red-600" />
                {excludeAlreadyPaid ? "Exclude Already Paid" : "Include Already Paid"}
                <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-800">
                  {alreadyPaidCount}
                </span>
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Executive Quick Filter Tabs */}
      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground sm:text-lg">
            Executives List ({sections.length})
          </h2>
          {selectedExecutive !== ALL && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-primary"
              onClick={() => setSelectedExecutive(ALL)}
            >
              Show All Executives
            </Button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className={`rounded-lg border px-3 py-2 text-xs font-semibold sm:text-sm transition-all ${
              selectedExecutive === ALL
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "bg-background text-foreground hover:bg-muted"
            }`}
            onClick={() => setSelectedExecutive(ALL)}
          >
            All Executives
          </button>
          {EXECUTIVES.map((exec) => {
            const sec = sections.find((s) => s.executive === exec);
            const count = sec?.rows.length ?? 0;
            const amount = sec?.total.collection ?? 0;
            const isSelected = selectedExecutive === exec;

            return (
              <button
                key={exec}
                type="button"
                className={`rounded-lg border px-3 py-1.5 text-left transition-all ${
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "bg-background text-foreground hover:bg-muted"
                }`}
                onClick={() => setSelectedExecutive(isSelected ? ALL : exec)}
              >
                <div className="text-xs font-semibold sm:text-sm">{exec}</div>
                <div
                  className={`text-[10px] sm:text-xs font-medium ${
                    isSelected ? "text-primary-foreground/90 font-bold" : "text-muted-foreground"
                  }`}
                >
                  {count > 0 ? `${count} cities · ${formatAmount(amount)}` : "No data"}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* All Executives Summary Comparison Table (when All Executives selected) */}
      {selectedExecutive === ALL && !isLoading && sections.length > 0 && (
        <section className="mt-6 rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold text-foreground sm:text-base">
                Executive Comparison Summary Table
              </h3>
            </div>
            <span className="text-xs text-muted-foreground">
              Total:{" "}
              <strong className="text-primary font-bold">
                {formatAmount(overallMetrics.totalCollection)}
              </strong>
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="border-b bg-muted/20 text-muted-foreground font-semibold">
                  <th className="px-3 py-2.5 text-left">Executive</th>
                  <th className="px-3 py-2.5 text-right">Cities</th>
                  <th className="px-3 py-2.5 text-right font-bold text-foreground">
                    Collection Amount
                  </th>
                  <th className="px-3 py-2.5 text-right">Cases</th>
                  <th className="px-3 py-2.5 text-right text-emerald-700">Main Paid</th>
                  <th className="px-3 py-2.5 text-right">EMI Count</th>
                  <th className="px-3 py-2.5 text-right">POS*</th>
                  <th className="px-3 py-2.5 text-right text-sky-700">Paid POS</th>
                  <th className="px-3 py-2.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {sections.map((sec) => (
                  <tr key={sec.executive} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium text-foreground text-left">
                      <div className="flex items-center gap-1.5">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold">
                          {sec.executive.charAt(0)}
                        </span>
                        <span>{sec.executive}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {sec.rows.length}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-primary">
                      {formatAmount(sec.total.collection)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {sec.total.cases}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-700">
                      {sec.total.mainPaid}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{sec.total.paidEmi}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {sec.total.posPaidNotMain}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-sky-700">
                      {formatAmount(sec.total.paidPos)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-primary hover:bg-primary/10"
                        onClick={() => setSelectedExecutive(sec.executive)}
                      >
                        View Cities
                      </Button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 bg-muted/60 font-bold text-foreground">
                  <td className="px-3 py-2.5 text-left font-bold">TOTAL OVERALL</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold">
                    {overallMetrics.cityCount}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold text-primary text-sm sm:text-base">
                    {formatAmount(overallMetrics.totalCollection)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold">
                    {overallMetrics.totalCases}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold text-emerald-700">
                    {overallMetrics.totalMainPaid}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold">
                    {overallMetrics.totalEmi}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold text-muted-foreground">
                    {sections.reduce((acc, s) => acc + s.total.posPaidNotMain, 0)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold text-sky-700">
                    {formatAmount(sections.reduce((acc, s) => acc + s.total.paidPos, 0))}
                  </td>
                  <td className="px-3 py-2.5" />
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Main Content: Tables */}
      <section className="mt-8 space-y-6">
        {isLoading && (
          <div className="rounded-xl border p-12 text-center text-muted-foreground">
            <RotateCw className="mx-auto h-6 w-6 animate-spin mb-2" />
            Loading Executive City data...
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center text-destructive">
            <p className="font-semibold text-base">Could not load collection data</p>
            <p className="mt-1 text-sm opacity-90">
              {error instanceof Error
                ? error.message
                : "An error occurred while fetching from server."}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 bg-background text-foreground hover:bg-muted"
              onClick={() => refetch()}
            >
              <RotateCw className="mr-2 h-4 w-4" /> Try Again
            </Button>
          </div>
        )}

        {!isLoading && displayedSections.length === 0 && (
          <div className="rounded-xl border p-10 text-center text-muted-foreground">
            No collection cases found for the selected filter combination.
          </div>
        )}

        {!isLoading &&
          displayedSections.map((sec) => (
            <ExecutiveCityTableCard key={sec.executive} section={sec} />
          ))}
      </section>
    </main>
  );
}

const METRIC_COLUMNS = [
  { label: "Collection", get: (r: ExecutiveCityRow) => formatAmount(r.collection) },
  { label: "Cases", get: (r: ExecutiveCityRow) => String(r.cases) },
  { label: "Main", get: (r: ExecutiveCityRow) => String(r.mainPaid) },
  { label: "EMI", get: (r: ExecutiveCityRow) => String(r.paidEmi) },
  { label: "POS*", get: (r: ExecutiveCityRow) => String(r.posPaidNotMain) },
  { label: "Paid POS", get: (r: ExecutiveCityRow) => formatAmount(r.paidPos) },
] as const;

function ExecutiveCityTableCard({ section }: { section: ExecutiveCitySection }) {
  const cell = "whitespace-nowrap px-2 py-2 sm:px-3 sm:py-2.5";
  const hasData = section.rows.length > 0;

  return (
    <div className="rounded-xl border bg-card shadow-sm transition-all overflow-hidden">
      {/* Executive Header Banner */}
      <div className="flex flex-wrap items-center justify-between border-b bg-muted/40 px-4 py-3 gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
            {section.executive.charAt(0)}
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground sm:text-lg">{section.executive}</h3>
            <p className="text-xs text-muted-foreground">
              {section.rows.length} {section.rows.length === 1 ? "City" : "Cities"} with active
              collections
            </p>
          </div>
        </div>

        {/* Executive summary pill stats */}
        <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm">
          <div className="text-right">
            <span className="text-xs text-muted-foreground">Total: </span>
            <span className="font-bold text-primary">{formatAmount(section.total.collection)}</span>
          </div>
          <div className="hidden sm:block text-muted-foreground">·</div>
          <div className="text-right">
            <span className="text-xs text-muted-foreground">Cases: </span>
            <span className="font-semibold">{section.total.cases}</span>
          </div>
          <div className="hidden sm:block text-muted-foreground">·</div>
          <div className="text-right">
            <span className="text-xs text-muted-foreground">Main Paid: </span>
            <span className="font-semibold text-emerald-600">{section.total.mainPaid}</span>
          </div>
        </div>
      </div>

      {/* Table */}
      {!hasData ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No city records for {section.executive} under current filters.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="border-b bg-muted/20 text-muted-foreground">
                <th className={`${cell} text-left font-semibold`}>City</th>
                {METRIC_COLUMNS.map((c) => (
                  <th key={c.label} className={`${cell} text-right font-semibold`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.rows.map((r, idx) => (
                <tr
                  key={`${r.city}-${idx}`}
                  className="border-b last:border-b-0 hover:bg-muted/30 transition-colors"
                >
                  <td className={`${cell} font-medium text-foreground text-left`}>
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span>{r.city}</span>
                    </div>
                  </td>
                  {METRIC_COLUMNS.map((c) => (
                    <td key={c.label} className={`${cell} text-right tabular-nums`}>
                      {c.get(r)}
                    </td>
                  ))}
                </tr>
              ))}

              {/* Total row for this executive */}
              <tr className="border-t-2 bg-muted/60 font-bold text-foreground">
                <td className={`${cell} text-left`}>TOTAL ({section.executive})</td>
                {METRIC_COLUMNS.map((c) => (
                  <td
                    key={c.label}
                    className={`${cell} text-right tabular-nums font-bold text-primary`}
                  >
                    {c.get(section.total)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Footnote */}
      <div className="border-t bg-muted/10 px-4 py-2 text-[11px] text-muted-foreground flex justify-between items-center">
        <span>POS* = POS Paid but not Main Paid.</span>
        {hasData && (
          <span>
            {section.rows.length} {section.rows.length === 1 ? "entry" : "entries"}
          </span>
        )}
      </div>
    </div>
  );
}
