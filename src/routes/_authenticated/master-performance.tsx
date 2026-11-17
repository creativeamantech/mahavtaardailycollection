import { Fragment, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Share2,
  Table2,
  Trash2,
} from "lucide-react";
import {
  getMasterPerformanceReport,
  saveMasterPerformanceTargets,
} from "@/lib/master-performance.functions";
import { ALL_ALLOCATION_TYPES } from "@/components/AllocationFilters";
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

export const Route = createFileRoute("/_authenticated/master-performance")({
  head: () => ({ meta: [{ title: "IDFC Main Performance — Mahavtaar Daily Collection" }] }),
  component: MasterPerformancePage,
});

type Rule = {
  id: string;
  allocationType: string;
  bucket: string;
  state: string;
  city: string;
  mainTarget: number;
  rollbackTarget: number;
};
type Metric = {
  totalCount: number;
  paidCount: number;
  unpaidCount: number;
  totalPos: number;
  collection: number;
  mainPaidPos: number;
  rollbackPos: number;
  mainPercent: number;
  rollbackPercent: number;
  mainTarget: number | null;
  targetPos: number | null;
  neededPos: number | null;
  rollbackTarget: number | null;
  targetRollbackPos: number | null;
  neededRollbackPos: number | null;
};
type Executive = Metric & { executive: string };
type City = Metric & { city: string; executives: Executive[] };
type PerformanceSlice = {
  rowCount: number;
  buckets: { bucket: string; cities: City[]; total: Metric }[];
  totals: Metric;
  positiveNeededPos: {
    bucket: string;
    city: string;
    totalCount: number;
    neededPos: number;
    mainPaidPos: number;
    targetPos: number;
  }[];
  positiveNeededRollback: {
    bucket: string;
    city: string;
    totalCount: number;
    neededRollbackPos: number;
    rollbackPos: number;
    targetRollbackPos: number;
  }[];
};

type Report = PerformanceSlice & {
  dimensionOptions: {
    allocationTypes: string[];
    buckets: string[];
    states: string[];
    cities: string[];
  };
  master: { name: string; url: string; modifiedTime: string | null };
  byAllocationType?: Record<string, PerformanceSlice>;
  rules: Rule[];
};

const ALL_CITIES = "__all_cities__";

const money = (n: number) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const pct = (n: number) => Number(n || 0).toFixed(2) + "%";
const emptyRule = (): Rule => ({
  id: globalThis.crypto?.randomUUID?.() ?? "rule-" + Date.now(),
  allocationType: "",
  bucket: "",
  state: "",
  city: "",
  mainTarget: 0,
  rollbackTarget: 0,
});

function MasterPerformancePage() {
  const fetchReport = useServerFn(getMasterPerformanceReport);
  const saveTargets = useServerFn(saveMasterPerformanceTargets);
  const qc = useQueryClient();
  const { data, isLoading, isFetching, error, refetch } = useQuery<Report>({
    queryKey: ["master-performance-report"],
    queryFn: () => fetchReport() as Promise<Report>,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const [bucket, setBucket] = useState("Bucket 1");
  const [allocationType, setAllocationType] = useState<string>(ALL_ALLOCATION_TYPES);
  const [cityFilter, setCityFilter] = useState<string>(ALL_CITIES);
  const [isFullWidth, setIsFullWidth] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [saving, setSaving] = useState(false);
  const activeRules = rules ?? data?.rules ?? [];

  useEffect(() => {
    if (!isFullWidth) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullWidth(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullWidth]);

  const resolvedAllocationType = useMemo(() => {
    if (
      allocationType === ALL_ALLOCATION_TYPES ||
      !data?.dimensionOptions.allocationTypes.includes(allocationType)
    ) {
      return ALL_ALLOCATION_TYPES;
    }
    return allocationType;
  }, [allocationType, data]);

  const activeSlice: PerformanceSlice | undefined = useMemo(() => {
    if (!data) return undefined;
    if (resolvedAllocationType === ALL_ALLOCATION_TYPES) return data;
    return data.byAllocationType?.[resolvedAllocationType] ?? data;
  }, [data, resolvedAllocationType]);

  const selected = activeSlice?.buckets.find((b) => b.bucket === bucket) ?? activeSlice?.buckets[0];

  const cityOptions = useMemo(
    () =>
      [...(selected?.cities.map((c) => c.city) ?? [])].sort((a, b) =>
        a.localeCompare(b, "en-IN", { sensitivity: "base" }),
      ),
    [selected],
  );

  const resolvedCityFilter = useMemo(() => {
    if (cityFilter === ALL_CITIES || !cityOptions.includes(cityFilter)) return ALL_CITIES;
    return cityFilter;
  }, [cityFilter, cityOptions]);

  const displayedCities = useMemo(() => {
    if (!selected) return [];
    if (resolvedCityFilter === ALL_CITIES) return selected.cities;
    return selected.cities.filter((c) => c.city === resolvedCityFilter);
  }, [selected, resolvedCityFilter]);

  const displayedTotal = useMemo(() => {
    if (!selected) return undefined;
    if (resolvedCityFilter === ALL_CITIES) return selected.total;
    return displayedCities[0] ?? selected.total;
  }, [selected, resolvedCityFilter, displayedCities]);

  const mainShareRows = useMemo(
    () => (activeSlice?.positiveNeededPos ?? []).filter((r) => r.bucket === bucket),
    [activeSlice, bucket],
  );
  const rollbackShareRows = useMemo(
    () =>
      (activeSlice?.positiveNeededRollback ?? []).filter(
        (r) => r.bucket === bucket && r.neededRollbackPos > 0,
      ),
    [activeSlice, bucket],
  );
  const allocationSuffix =
    resolvedAllocationType !== ALL_ALLOCATION_TYPES ? ` (${resolvedAllocationType})` : "";

  async function share(title: string, lines: string[]) {
    const text = [title, ...lines].join("\n");
    try {
      if (navigator.share) await navigator.share({ title, text });
      else {
        await navigator.clipboard.writeText(text);
        toast.success("Table copied to clipboard");
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(text);
        toast.success("Table copied to clipboard");
      } catch {
        toast.error("Could not share or copy this table.");
      }
    }
  }
  async function persistRules() {
    setSaving(true);
    try {
      await saveTargets({ data: { rules: activeRules } });
      setRules(null);
      await qc.invalidateQueries({ queryKey: ["master-performance-report"] });
      toast.success("Target rules saved in Master Allocation");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save target rules");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1800px] space-y-5 px-3 pb-20 pt-5 sm:px-5 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[#6e287f]">
            Admin · Master Allocation
          </p>
          <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-[#28145e] sm:text-3xl">
            IDFC Main Performance
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            City-wise and executive-wise performance, targets and required POS.
          </p>
        </div>
        <div className="flex gap-2">
          {data && (
            <Button variant="outline" asChild>
              <a href={data.master.url} target="_blank" rel="noreferrer">
                Master File <ExternalLink className="ml-2 size-4" />
              </a>
            </Button>
          )}
          <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={"mr-2 size-4 " + (isFetching ? "animate-spin" : "")} />
            Refresh
          </Button>
        </div>
      </header>

      {isLoading && (
        <p className="rounded-xl border bg-white p-5">Loading live Master Allocation data…</p>
      )}
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error instanceof Error ? error.message : "Could not load Master Allocation report."}
        </p>
      )}
      {data && activeSlice && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Summary
              label="Allocated cases"
              value={activeSlice.rowCount.toLocaleString("en-IN")}
              sub={
                resolvedAllocationType !== ALL_ALLOCATION_TYPES
                  ? `of ${data.rowCount.toLocaleString("en-IN")} total`
                  : undefined
              }
            />
            <Summary
              label="Allocation Type"
              value={
                resolvedAllocationType === ALL_ALLOCATION_TYPES
                  ? "All Types"
                  : resolvedAllocationType
              }
            />
            <Summary label="Total Collection" value={money(activeSlice.totals.collection)} />
            <Summary label="Overall Main Paid %" value={pct(activeSlice.totals.mainPercent)} />
          </div>
          <div
            className={
              isFullWidth
                ? "fixed inset-0 z-40 flex flex-col bg-[#242236]/40 p-1.5 backdrop-blur-[2px] sm:p-4"
                : ""
            }
          >
            <section
              className={
                isFullWidth
                  ? "flex h-full min-h-0 w-full flex-col rounded-xl border border-border bg-card p-2.5 shadow-2xl sm:rounded-2xl sm:p-5"
                  : "rounded-2xl border border-border bg-card p-3 shadow-[0_4px_18px_rgba(40,20,94,0.038)] sm:p-5"
              }
            >
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2.5 sm:gap-3">
                <div className={isFullWidth ? "flex items-center gap-3" : ""}>
                  <h2 className="font-display text-base font-bold text-[#28145e] sm:text-lg">
                    Bucket performance
                  </h2>
                  <p
                    className={
                      "text-xs text-muted-foreground sm:text-sm " +
                      (isFullWidth ? "hidden md:block" : "")
                    }
                  >
                    All cities start expanded with executive rows visible. Swipe or scroll sideways
                    for all metrics.
                  </p>
                </div>
                <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto sm:gap-2.5">
                  <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-end sm:gap-2.5">
                    <div className="space-y-1 sm:w-44">
                      <Label
                        htmlFor="idfc-allocation-type-filter"
                        className="text-xs font-semibold text-[#28145e]"
                      >
                        Allocation Type
                      </Label>
                      <Select value={resolvedAllocationType} onValueChange={setAllocationType}>
                        <SelectTrigger
                          id="idfc-allocation-type-filter"
                          className="h-9 bg-background text-xs font-medium sm:text-sm"
                        >
                          <SelectValue placeholder="All Allocation Types" />
                        </SelectTrigger>
                        <SelectContent className="z-50">
                          <SelectItem value={ALL_ALLOCATION_TYPES}>All Allocation Types</SelectItem>
                          {data.dimensionOptions.allocationTypes.map((type) => (
                            <SelectItem key={type} value={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1 sm:w-44">
                      <Label
                        htmlFor="idfc-city-filter"
                        className="text-xs font-semibold text-[#28145e]"
                      >
                        City Filter
                      </Label>
                      <Select value={resolvedCityFilter} onValueChange={setCityFilter}>
                        <SelectTrigger
                          id="idfc-city-filter"
                          className="h-9 bg-background text-xs font-medium sm:text-sm"
                        >
                          <SelectValue placeholder="All Cities" />
                        </SelectTrigger>
                        <SelectContent className="z-50">
                          <SelectItem value={ALL_CITIES}>
                            All Cities ({selected?.cities.length ?? 0})
                          </SelectItem>
                          {cityOptions.map((cityName) => (
                            <SelectItem key={cityName} value={cityName}>
                              {cityName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    {activeSlice.buckets.map((b) => (
                      <Button
                        key={b.bucket}
                        size="sm"
                        variant={bucket === b.bucket ? "default" : "outline"}
                        className="h-8 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm"
                        onClick={() => setBucket(b.bucket)}
                      >
                        {b.bucket}
                      </Button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
                      <button
                        type="button"
                        onClick={() => setViewMode("table")}
                        className={
                          "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors " +
                          (viewMode === "table"
                            ? "bg-primary text-primary-foreground shadow-xs"
                            : "text-muted-foreground hover:text-foreground")
                        }
                      >
                        <Table2 className="size-3.5" />
                        Table
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewMode("cards")}
                        className={
                          "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors " +
                          (viewMode === "cards"
                            ? "bg-primary text-primary-foreground shadow-xs"
                            : "text-muted-foreground hover:text-foreground")
                        }
                      >
                        <LayoutGrid className="size-3.5" />
                        Cards
                      </button>
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      variant={isFullWidth ? "default" : "outline"}
                      onClick={() => setIsFullWidth((v) => !v)}
                      className="h-8 gap-1.5 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm"
                      title={isFullWidth ? "Exit full-width view (Esc)" : "Expand table full width"}
                    >
                      {isFullWidth ? (
                        <>
                          <Minimize2 className="size-3.5 sm:size-4" />
                          Exit
                        </>
                      ) : (
                        <>
                          <Maximize2 className="size-3.5 sm:size-4" />
                          Full Width
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
              {selected && displayedTotal && (
                <PerformanceTable
                  cities={displayedCities}
                  total={displayedTotal}
                  totalLabel={
                    resolvedCityFilter === ALL_CITIES
                      ? "GRAND TOTAL"
                      : `CITY TOTAL · ${resolvedCityFilter}`
                  }
                  isCityFiltered={resolvedCityFilter !== ALL_CITIES}
                  onClearCityFilter={() => setCityFilter(ALL_CITIES)}
                  showTargets={activeRules.length > 0}
                  isFullWidth={isFullWidth}
                  viewMode={viewMode}
                />
              )}
            </section>
          </div>

          {activeRules.length > 0 && (
            <div className="grid gap-4 xl:grid-cols-2">
              <ShareTable
                title="City-wise Needed POS"
                rows={mainShareRows.map((r) => ({
                  city: r.city,
                  cases: r.totalCount,
                  need: r.neededPos,
                  paid: r.mainPaidPos,
                  target: r.targetPos,
                }))}
                onShare={() =>
                  void share(
                    "City-wise Needed POS — " + bucket + allocationSuffix,
                    mainShareRows.map((r) =>
                      [
                        r.city,
                        "Cases " + r.totalCount,
                        "Needed POS " + money(r.neededPos),
                        "Main Paid POS " + money(r.mainPaidPos),
                        "Target POS " + money(r.targetPos),
                      ].join(" | "),
                    ),
                  )
                }
              />
              <ShareTable
                title="City-wise Needed Rollback POS"
                rows={rollbackShareRows.map((r) => ({
                  city: r.city,
                  cases: r.totalCount,
                  need: r.neededRollbackPos,
                  paid: r.rollbackPos,
                  target: r.targetRollbackPos,
                }))}
                compact
                onShare={() =>
                  void share("City-wise Needed Rollback POS — " + bucket + allocationSuffix, [
                    "City | Needed Rollback POS",
                    ...rollbackShareRows.map((r) =>
                      [r.city, money(r.neededRollbackPos)].join(" | "),
                    ),
                  ])
                }
              />
            </div>
          )}

          <section className="space-y-3 rounded-xl border bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-bold">Target Manager</h2>
                <p className="text-xs text-muted-foreground">
                  Options are loaded from the current Master Allocation file. Blank dimensions mean
                  “all”; more specific rules override broader rules.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRules([...activeRules, emptyRule()])}
              >
                <Plus className="mr-1 size-4" />
                Add rule
              </Button>
            </div>
            <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Configured Rules</h3>
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">
                  {activeRules.length} {activeRules.length === 1 ? "rule" : "rules"}
                </span>
              </div>
              {activeRules.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No rules saved yet. Add a rule below to define Main and Rollback targets.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="px-2 py-2 font-semibold">#</th>
                        <th className="px-2 py-2 font-semibold">Allocation Type</th>
                        <th className="px-2 py-2 font-semibold">Bucket</th>
                        <th className="px-2 py-2 font-semibold">State</th>
                        <th className="px-2 py-2 font-semibold">City</th>
                        <th className="px-2 py-2 text-right font-semibold">Main Target</th>
                        <th className="px-2 py-2 text-right font-semibold">Rollback Target</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeRules.map((rule, i) => (
                        <tr key={rule.id} className="border-b last:border-0">
                          <td className="px-2 py-2 font-medium tabular-nums">{i + 1}</td>
                          <td className="px-2 py-2">{rule.allocationType || "All"}</td>
                          <td className="px-2 py-2">{rule.bucket || "All"}</td>
                          <td className="px-2 py-2">{rule.state || "All"}</td>
                          <td className="px-2 py-2">{rule.city || "All"}</td>
                          <td className="px-2 py-2 text-right font-semibold tabular-nums">
                            {pct(rule.mainTarget)}
                          </td>
                          <td className="px-2 py-2 text-right font-semibold tabular-nums">
                            {pct(rule.rollbackTarget)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {activeRules.map((rule, i) => (
              <div
                key={rule.id}
                className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-7"
              >
                <Field label="Allocation Type">
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                    value={rule.allocationType}
                    onChange={(e) => updateRule(i, { allocationType: e.target.value })}
                  >
                    <option value="">All</option>
                    {data.dimensionOptions.allocationTypes.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Bucket">
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                    value={rule.bucket}
                    onChange={(e) => updateRule(i, { bucket: e.target.value })}
                  >
                    <option value="">All</option>
                    {data.dimensionOptions.buckets.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="State">
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                    value={rule.state}
                    onChange={(e) => updateRule(i, { state: e.target.value })}
                  >
                    <option value="">All</option>
                    {data.dimensionOptions.states.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="City">
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                    value={rule.city}
                    onChange={(e) => updateRule(i, { city: e.target.value })}
                  >
                    <option value="">All</option>
                    {data.dimensionOptions.cities.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Main Target %">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={rule.mainTarget}
                    onChange={(e) => updateRule(i, { mainTarget: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Rollback Target %">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={rule.rollbackTarget}
                    onChange={(e) => updateRule(i, { rollbackTarget: Number(e.target.value) })}
                  />
                </Field>
                <div className="flex items-end">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Delete target rule"
                    onClick={() => setRules(activeRules.filter((_, n) => n !== i))}
                  >
                    <Trash2 className="size-4 text-red-600" />
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex justify-end">
              <Button onClick={() => void persistRules()} disabled={saving}>
                {saving ? "Saving…" : "Save Target Rules"}
              </Button>
            </div>
          </section>
          <p className="text-xs text-muted-foreground">
            Source: {data.master.name} · {activeSlice.rowCount.toLocaleString("en-IN")} allocated
            loan rows{allocationSuffix} · Target rules stored in the “Performance Targets” tab.
          </p>
        </>
      )}
    </main>
  );

  function updateRule(index: number, patch: Partial<Rule>) {
    setRules((current) =>
      (current ?? data?.rules ?? []).map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
function Summary({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | undefined;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-3 shadow-[0_4px_18px_rgba(40,20,94,0.038)]">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-[15px] leading-snug font-extrabold text-[#28145e] tabular-nums sm:text-xl">
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
function ShareTable({
  title,
  rows,
  onShare,
  compact = false,
}: {
  title: string;
  rows: { city: string; cases: number; need: number; paid: number; target: number }[];
  compact?: boolean;
  onShare: () => void;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border bg-white">
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <h2 className="font-bold">{title}</h2>
        <Button size="sm" variant="outline" onClick={onShare}>
          <Share2 className="mr-1 size-4" />
          Share
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className={"w-full text-sm " + (compact ? "min-w-[280px]" : "min-w-[520px]")}>
          <thead className="bg-muted/60">
            <tr>
              {(compact
                ? ["City", "Needed Rollback POS"]
                : ["City", "Cases", "Target POS", "Achieved POS", "Needed POS"]
              ).map((v) => (
                <th key={v} className="px-3 py-2 text-right first:text-left">
                  {v}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.city} className="border-t">
                <td className="px-3 py-2 font-medium">{r.city}</td>
                {compact ? (
                  <td className="px-3 py-2 text-right font-bold">{money(r.need)}</td>
                ) : (
                  <>
                    <td className="px-3 py-2 text-right">{r.cases}</td>
                    <td className="px-3 py-2 text-right">{money(r.target)}</td>
                    <td className="px-3 py-2 text-right">{money(r.paid)}</td>
                    <td className="px-3 py-2 text-right font-bold">{money(r.need)}</td>
                  </>
                )}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={compact ? 2 : 5} className="p-5 text-center text-muted-foreground">
                  No positive requirement for this bucket.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
type PerformanceColumn = {
  key: string;
  label: string;
  minWidthClass: string;
  group: "hierarchy" | "core" | "main" | "rollback";
  groupDividerLeft?: boolean;
};

const CORE_COLUMNS: PerformanceColumn[] = [
  {
    key: "hierarchy",
    label: "City / Executive",
    minWidthClass: "min-w-[155px] sm:min-w-[205px] md:min-w-[240px]",
    group: "hierarchy",
  },
  {
    key: "collection",
    label: "Collection",
    minWidthClass: "min-w-[115px] sm:min-w-[140px]",
    group: "core",
  },
  {
    key: "mainPercent",
    label: "Total %",
    minWidthClass: "min-w-[90px] sm:min-w-[105px]",
    group: "core",
  },
  {
    key: "rollbackPercent",
    label: "Sum of RB %",
    minWidthClass: "min-w-[105px] sm:min-w-[120px]",
    group: "core",
  },
  {
    key: "totalCount",
    label: "Total Count",
    minWidthClass: "min-w-[98px] sm:min-w-[115px]",
    group: "core",
  },
  {
    key: "paidCount",
    label: "Paid Count",
    minWidthClass: "min-w-[95px] sm:min-w-[110px]",
    group: "core",
  },
  {
    key: "unpaidCount",
    label: "Unpaid Count",
    minWidthClass: "min-w-[106px] sm:min-w-[122px]",
    group: "core",
  },
  {
    key: "totalPos",
    label: "Total POS",
    minWidthClass: "min-w-[122px] sm:min-w-[145px]",
    group: "core",
  },
  {
    key: "mainPaidPos",
    label: "Total Paid POS",
    minWidthClass: "min-w-[125px] sm:min-w-[145px]",
    group: "core",
  },
];

const TARGET_COLUMNS: PerformanceColumn[] = [
  {
    key: "mainTarget",
    label: "Main Target %",
    minWidthClass: "min-w-[115px] sm:min-w-[130px]",
    group: "main",
    groupDividerLeft: true,
  },
  {
    key: "targetPos",
    label: "Target POS",
    minWidthClass: "min-w-[122px] sm:min-w-[145px]",
    group: "main",
  },
  {
    key: "neededPos",
    label: "Needed POS",
    minWidthClass: "min-w-[122px] sm:min-w-[145px]",
    group: "main",
  },
  {
    key: "rollbackTarget",
    label: "Rollback Target %",
    minWidthClass: "min-w-[135px] sm:min-w-[155px]",
    group: "rollback",
    groupDividerLeft: true,
  },
  {
    key: "targetRollbackPos",
    label: "Target Rollback POS",
    minWidthClass: "min-w-[145px] sm:min-w-[165px]",
    group: "rollback",
  },
  {
    key: "neededRollbackPos",
    label: "Needed Rollback POS",
    minWidthClass: "min-w-[150px] sm:min-w-[170px]",
    group: "rollback",
  },
];

function MetricGrid({ m, showTargets }: { m: Metric; showTargets: boolean }) {
  const items: { label: string; value: string; toneClass?: string }[] = [
    { label: "Collection", value: money(m.collection) },
    { label: "Total %", value: pct(m.mainPercent) },
    { label: "Sum of RB %", value: pct(m.rollbackPercent) },
    {
      label: "Cases (Tot/Paid/Unp)",
      value: `${m.totalCount.toLocaleString("en-IN")} / ${m.paidCount.toLocaleString("en-IN")} / ${m.unpaidCount.toLocaleString("en-IN")}`,
    },
    { label: "Total POS", value: money(m.totalPos) },
    { label: "Total Paid POS", value: money(m.mainPaidPos) },
    ...(showTargets
      ? [
          { label: "Main Target %", value: m.mainTarget === null ? "—" : pct(m.mainTarget) },
          { label: "Target POS", value: m.targetPos === null ? "—" : money(m.targetPos) },
          {
            label: "Needed POS",
            value: m.neededPos === null ? "—" : money(m.neededPos),
            toneClass:
              m.neededPos === null ? "" : m.neededPos > 0 ? "text-[#b42318]" : "text-[#157f3d]",
          },
          {
            label: "Rollback Target %",
            value: m.rollbackTarget === null ? "—" : pct(m.rollbackTarget),
          },
          {
            label: "Target RB POS",
            value: m.targetRollbackPos === null ? "—" : money(m.targetRollbackPos),
          },
          {
            label: "Needed RB POS",
            value: m.neededRollbackPos === null ? "—" : money(m.neededRollbackPos),
            toneClass:
              m.neededRollbackPos === null
                ? ""
                : m.neededRollbackPos > 0
                  ? "text-[#b42318]"
                  : "text-[#157f3d]",
          },
        ]
      : []),
  ];

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <p className="text-[11px] leading-tight text-muted-foreground">{item.label}</p>
          <p
            className={
              "break-words font-mono text-xs leading-snug font-bold tabular-nums sm:text-sm " +
              (item.toneClass || "text-foreground")
            }
          >
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function PerformanceTable({
  cities,
  total,
  totalLabel,
  isCityFiltered,
  onClearCityFilter,
  showTargets,
  isFullWidth,
  viewMode,
}: {
  cities: City[];
  total: Metric;
  totalLabel: string;
  isCityFiltered: boolean;
  onClearCityFilter: () => void;
  showTargets: boolean;
  isFullWidth: boolean;
  viewMode: "table" | "cards";
}) {
  // Expand all cities by default; track only cities the user explicitly collapses.
  const [collapsedCities, setCollapsedCities] = useState<Set<string>>(() => new Set());
  const isCityExpanded = (cityName: string) => !collapsedCities.has(cityName);
  const allExpanded = cities.length > 0 && cities.every((city) => isCityExpanded(city.city));
  const allCollapsed = cities.length > 0 && cities.every((city) => !isCityExpanded(city.city));
  const totalExecutivesCount = useMemo(
    () => cities.reduce((sum, city) => sum + city.executives.length, 0),
    [cities],
  );

  const toggleCity = (cityName: string) =>
    setCollapsedCities((current) => {
      const next = new Set(current);
      if (next.has(cityName)) next.delete(cityName);
      else next.add(cityName);
      return next;
    });

  const columns = useMemo(
    () => (showTargets ? [...CORE_COLUMNS, ...TARGET_COLUMNS] : CORE_COLUMNS),
    [showTargets],
  );

  type MetricCell = {
    text: string;
    toneClass?: string;
    groupDividerLeft?: boolean;
  };

  const metricCells = (m: Metric): MetricCell[] => [
    { text: money(m.collection) },
    { text: pct(m.mainPercent) },
    { text: pct(m.rollbackPercent) },
    { text: m.totalCount.toLocaleString("en-IN") },
    { text: m.paidCount.toLocaleString("en-IN") },
    { text: m.unpaidCount.toLocaleString("en-IN") },
    { text: money(m.totalPos) },
    { text: money(m.mainPaidPos) },
    ...(showTargets
      ? [
          {
            text: m.mainTarget === null ? "—" : pct(m.mainTarget),
            groupDividerLeft: true,
          },
          { text: m.targetPos === null ? "—" : money(m.targetPos) },
          {
            text: m.neededPos === null ? "—" : money(m.neededPos),
            toneClass:
              m.neededPos === null ? "" : m.neededPos > 0 ? "text-[#b42318]" : "text-[#157f3d]",
          },
          {
            text: m.rollbackTarget === null ? "—" : pct(m.rollbackTarget),
            groupDividerLeft: true,
          },
          { text: m.targetRollbackPos === null ? "—" : money(m.targetRollbackPos) },
          {
            text: m.neededRollbackPos === null ? "—" : money(m.neededRollbackPos),
            toneClass:
              m.neededRollbackPos === null
                ? ""
                : m.neededRollbackPos > 0
                  ? "text-[#b42318]"
                  : "text-[#157f3d]",
          },
        ]
      : []),
  ];

  return (
    <div className={isFullWidth ? "flex min-h-0 flex-1 flex-col" : ""}>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground sm:text-sm">
        <p>
          Showing <strong className="text-[#28145e]">{cities.length}</strong>{" "}
          {cities.length === 1 ? "city" : "cities"} ·{" "}
          <strong className="text-[#28145e]">{totalExecutivesCount}</strong> executives
          {viewMode === "table" && (
            <>
              {" · "}
              <span>Swipe sideways for all {columns.length} columns</span>
            </>
          )}
        </p>
        <div className="flex items-center gap-1.5">
          {isCityFiltered && (
            <Button size="sm" variant="outline" onClick={onClearCityFilter}>
              Show All Cities
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={allExpanded}
            onClick={() => setCollapsedCities(new Set())}
          >
            Expand all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={allCollapsed}
            onClick={() => setCollapsedCities(new Set(cities.map((city) => city.city)))}
          >
            Collapse all
          </Button>
        </div>
      </div>

      {cities.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
          <p className="text-sm font-medium text-foreground">
            No performance records match the current filter.
          </p>
          {isCityFiltered && (
            <Button size="sm" variant="outline" className="mt-3" onClick={onClearCityFilter}>
              Show All Cities
            </Button>
          )}
        </div>
      ) : viewMode === "cards" ? (
        <div className={"space-y-3 " + (isFullWidth ? "min-h-0 flex-1 overflow-y-auto pr-1" : "")}>
          <div className="rounded-xl border border-[#d8cfe8] bg-[#efeaf7] p-3.5">
            <p className="mb-2 text-xs font-extrabold tracking-wider text-[#28145e] uppercase">
              {totalLabel}
            </p>
            <MetricGrid m={total} showTargets={showTargets} />
          </div>

          {cities.map((city) => {
            const expanded = isCityExpanded(city.city);
            return (
              <div
                key={city.city}
                className="overflow-hidden rounded-xl border border-border bg-card"
              >
                <div className="border-b border-border bg-[#fef8e2]/85 p-3.5">
                  <button
                    type="button"
                    className="mb-2.5 flex w-full items-center justify-between gap-2 text-left"
                    aria-expanded={expanded}
                    onClick={() => toggleCity(city.city)}
                  >
                    <span className="flex items-center gap-2 text-sm font-bold text-[#28145e]">
                      {expanded ? (
                        <ChevronDown className="size-4 shrink-0 text-[#5d2172]" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-[#5d2172]" />
                      )}
                      <span>{city.city}</span>
                      <span className="text-xs font-medium text-[#6e287f]">
                        ({city.executives.length} execs)
                      </span>
                    </span>
                    <span className="text-xs font-semibold text-[#5d2172]">
                      {expanded ? "Hide" : "Show"}
                    </span>
                  </button>
                  <MetricGrid m={city} showTargets={showTargets} />
                </div>

                {expanded && (
                  <div className="divide-y divide-border">
                    {city.executives.map((ex) => (
                      <div key={city.city + "-" + ex.executive} className="p-3.5">
                        <p className="mb-2 text-sm font-semibold text-[#28145e]">{ex.executive}</p>
                        <MetricGrid m={ex} showTargets={showTargets} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div
          className={
            "overscroll-x-contain rounded-xl border border-border bg-card " +
            (isFullWidth
              ? "min-h-0 flex-1 overflow-auto"
              : "overflow-x-auto md:max-h-[72vh] md:overflow-auto")
          }
        >
          <table
            className={
              "w-full border-separate border-spacing-0 text-[13px] sm:text-sm " +
              (showTargets
                ? "min-w-[1780px] sm:min-w-[2080px]"
                : "min-w-[1040px] sm:min-w-[1220px]")
            }
          >
            <thead className={isFullWidth ? "sticky top-0 z-20" : "md:sticky md:top-0 md:z-20"}>
              {showTargets && (
                <tr>
                  <th
                    scope="col"
                    className="border-b border-r border-border bg-[#efeaf7] px-2.5 py-2 text-left text-[11px] font-bold tracking-wider text-[#28145e] uppercase sm:px-3.5 md:sticky md:left-0 md:z-30 md:shadow-[2px_0_8px_-2px_rgba(40,20,94,0.08)]"
                  >
                    Location &amp; Team
                  </th>
                  <th
                    scope="colgroup"
                    colSpan={8}
                    className="border-b border-border bg-[#f4f1fa] px-2.5 py-2 text-center text-[11px] font-bold tracking-wider text-[#28145e] uppercase sm:px-3.5"
                  >
                    Core Portfolio Metrics
                  </th>
                  <th
                    scope="colgroup"
                    colSpan={3}
                    className="border-b border-l border-border bg-[#fef8e2] px-2.5 py-2 text-center text-[11px] font-bold tracking-wider text-[#5d2172] uppercase sm:px-3.5"
                  >
                    Main Target
                  </th>
                  <th
                    scope="colgroup"
                    colSpan={3}
                    className="border-b border-l border-border bg-[#eef6fb] px-2.5 py-2 text-center text-[11px] font-bold tracking-wider text-[#15698f] uppercase sm:px-3.5"
                  >
                    Rollback Target
                  </th>
                </tr>
              )}
              <tr>
                {columns.map((col, idx) => (
                  <th
                    key={col.key}
                    scope="col"
                    className={
                      "border-b border-border px-2.5 py-2.5 text-xs font-bold whitespace-nowrap sm:px-3.5 sm:py-3 sm:text-[13px] " +
                      col.minWidthClass +
                      " " +
                      (idx === 0
                        ? "border-r bg-[#f7f6fa] text-left text-[#28145e] md:sticky md:left-0 md:z-30 md:shadow-[2px_0_8px_-2px_rgba(40,20,94,0.08)]"
                        : "bg-[#f7f6fa] text-right text-[#28145e] " +
                          (col.groupDividerLeft ? "border-l border-border" : ""))
                    }
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cities.map((city) => {
                const expanded = isCityExpanded(city.city);
                return (
                  <Fragment key={city.city}>
                    <tr className="bg-[#fef8e2] font-bold text-[#28145e]">
                      <td className="border-b border-r border-border bg-[#fef8e2] px-2.5 py-2 text-left whitespace-nowrap sm:px-3.5 sm:py-2.5 md:sticky md:left-0 md:z-10 md:shadow-[2px_0_8px_-2px_rgba(40,20,94,0.08)]">
                        <button
                          type="button"
                          className="flex min-h-[34px] w-full items-center gap-1.5 text-left text-[13px] font-bold text-[#28145e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-2 sm:text-sm"
                          aria-expanded={expanded}
                          aria-label={
                            (expanded ? "Collapse " : "Expand ") + city.city + " executives"
                          }
                          onClick={() => toggleCity(city.city)}
                        >
                          {expanded ? (
                            <ChevronDown className="size-4 shrink-0 text-[#5d2172]" />
                          ) : (
                            <ChevronRight className="size-4 shrink-0 text-[#5d2172]" />
                          )}
                          <span>{city.city}</span>
                          <span className="shrink-0 text-xs font-medium text-[#6e287f]">
                            ({city.executives.length})
                          </span>
                        </button>
                      </td>
                      {metricCells(city).map((cell, i) => (
                        <td
                          key={i}
                          className={
                            "border-b border-border px-2.5 py-2 text-right font-mono text-[13px] font-bold whitespace-nowrap tabular-nums sm:px-3.5 sm:py-2.5 sm:text-[13.5px] " +
                            (cell.groupDividerLeft ? "border-l border-border " : "") +
                            (cell.toneClass ?? "")
                          }
                        >
                          {cell.text}
                        </td>
                      ))}
                    </tr>
                    {expanded &&
                      city.executives.map((ex) => (
                        <tr
                          key={city.city + "-" + ex.executive}
                          className="group bg-card transition-colors hover:bg-[#f7f6fa]"
                        >
                          <td className="border-b border-r border-border bg-card px-2.5 py-2 pl-7 text-left text-[13px] font-medium text-foreground whitespace-nowrap transition-colors group-hover:bg-[#f7f6fa] sm:px-3.5 sm:py-2.5 sm:pl-9 sm:text-[13.5px] md:sticky md:left-0 md:z-10 md:shadow-[2px_0_8px_-2px_rgba(40,20,94,0.06)]">
                            {ex.executive}
                          </td>
                          {metricCells(ex).map((cell, i) => (
                            <td
                              key={i}
                              className={
                                "border-b border-border px-2.5 py-2 text-right font-mono text-[13px] text-foreground whitespace-nowrap tabular-nums sm:px-3.5 sm:py-2.5 sm:text-[13.5px] " +
                                (cell.groupDividerLeft ? "border-l border-border " : "") +
                                (cell.toneClass ?? "")
                              }
                            >
                              {cell.text}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot
              className={isFullWidth ? "sticky bottom-0 z-20" : "md:sticky md:bottom-0 md:z-20"}
            >
              <tr className="bg-[#efeaf7] font-extrabold text-[#28145e]">
                <td className="border-t-2 border-r border-[#d8cfe8] bg-[#efeaf7] px-2.5 py-2.5 text-left text-[13px] whitespace-nowrap sm:px-3.5 sm:py-3 sm:text-sm md:sticky md:left-0 md:z-30 md:shadow-[2px_0_8px_-2px_rgba(40,20,94,0.1)]">
                  {totalLabel}
                </td>
                {metricCells(total).map((cell, i) => (
                  <td
                    key={i}
                    className={
                      "border-t-2 border-[#d8cfe8] bg-[#efeaf7] px-2.5 py-2.5 text-right font-mono text-[13px] font-extrabold whitespace-nowrap tabular-nums sm:px-3.5 sm:py-3 sm:text-sm " +
                      (cell.groupDividerLeft ? "border-l border-border " : "") +
                      (cell.toneClass ?? "")
                    }
                  >
                    {cell.text}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
