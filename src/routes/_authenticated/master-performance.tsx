import { Fragment, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Columns3,
  Download,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Share2,
  SlidersHorizontal,
  Target,
  Trash2,
  X,
} from "lucide-react";
import {
  getMasterPerformanceReport,
  saveMasterPerformanceTargets,
} from "@/lib/master-performance.functions";
import { downloadCsv, toCsv } from "@/lib/export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  mainTarget: number;
  targetPos: number;
  neededPos: number;
  rollbackTarget: number;
  targetRollbackPos: number;
  neededRollbackPos: number;
};

type Executive = Metric & { executive: string };
type City = Metric & { city: string; executives: Executive[] };

type Report = {
  dimensionOptions: {
    allocationTypes: string[];
    buckets: string[];
    states: string[];
    cities: string[];
  };
  master: { id: string; name: string; url: string; modifiedTime: string | null };
  rowCount: number;
  buckets: { bucket: string; cities: City[]; total: Metric }[];
  totals: Metric;
  rules: Rule[];
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
  defaults: { mainTarget: number; rollbackTarget: number };
};

type WorkspaceTab = "performance" | "needed_pos" | "targets";
type SortKey = "neededPos" | "mainPercentAsc" | "totalCount" | "name";

const money = (n: number) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const pct = (n: number) => Number(n || 0).toFixed(2) + "%";

const formatModifiedTime = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
};

const emptyRule = (): Rule => ({
  id: globalThis.crypto?.randomUUID?.() ?? "rule-" + Date.now(),
  allocationType: "",
  bucket: "",
  state: "",
  city: "",
  mainTarget: 60,
  rollbackTarget: 18,
});

function achievementTone(actual: number, target: number) {
  if (actual >= target) {
    return {
      text: "text-emerald-700 dark:text-emerald-400",
      bar: "bg-emerald-600",
      badge: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
      label: "On Target",
    };
  }
  if (actual >= target * 0.75) {
    return {
      text: "text-amber-700 dark:text-amber-400",
      bar: "bg-amber-500",
      badge: "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
      label: "Near Target",
    };
  }
  return {
    text: "text-red-700 dark:text-red-400",
    bar: "bg-red-600",
    badge: "bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300",
    label: "Behind Target",
  };
}

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
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("performance");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("neededPos");
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [saving, setSaving] = useState(false);

  const activeRules = rules ?? data?.rules ?? [];
  const rulesDirty = rules !== null;

  const selected = useMemo(
    () => data?.buckets.find((b) => b.bucket === bucket) ?? data?.buckets[0],
    [data, bucket],
  );

  const activeBucketName = selected?.bucket ?? bucket;

  const mainShareRows = useMemo(
    () => (data?.positiveNeededPos ?? []).filter((r) => r.bucket === activeBucketName),
    [data, activeBucketName],
  );

  const rollbackShareRows = useMemo(
    () => (data?.positiveNeededRollback ?? []).filter((r) => r.bucket === activeBucketName),
    [data, activeBucketName],
  );

  const totalNeededPosCount = mainShareRows.length + rollbackShareRows.length;

  async function shareText(title: string, lines: string[]) {
    const text = [title, ...lines].join("\n");
    try {
      if (navigator.share) {
        await navigator.share({ title, text });
      } else {
        await navigator.clipboard.writeText(text);
        toast.success("Formatted summary copied for WhatsApp");
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(text);
        toast.success("Formatted summary copied for WhatsApp");
      } catch {
        toast.error("Could not share or copy this report.");
      }
    }
  }

  async function persistRules() {
    setSaving(true);
    try {
      const sanitized = activeRules.map((r) => ({
        ...r,
        mainTarget: Math.min(100, Math.max(0, Number.isFinite(r.mainTarget) ? r.mainTarget : 0)),
        rollbackTarget: Math.min(
          100,
          Math.max(0, Number.isFinite(r.rollbackTarget) ? r.rollbackTarget : 0),
        ),
      }));
      await saveTargets({ data: { rules: sanitized } });
      setRules(null);
      await qc.invalidateQueries({ queryKey: ["master-performance-report"] });
      toast.success("Target rules saved in Master Allocation");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save target rules");
    } finally {
      setSaving(false);
    }
  }

  function updateRule(index: number, patch: Partial<Rule>) {
    setRules((current) =>
      (current ?? data?.rules ?? []).map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }

  function exportBucketCsv() {
    if (!selected) return;
    const rows: (string | number)[][] = [];
    for (const city of selected.cities) {
      rows.push([
        "City",
        city.city,
        "",
        city.collection,
        Number(city.mainPercent.toFixed(2)),
        Number(city.rollbackPercent.toFixed(2)),
        city.totalCount,
        city.paidCount,
        city.unpaidCount,
        city.totalPos,
        city.mainPaidPos,
        Number(city.mainTarget.toFixed(2)),
        city.targetPos,
        city.neededPos,
        Number(city.rollbackTarget.toFixed(2)),
        city.targetRollbackPos,
        city.neededRollbackPos,
      ]);
      for (const ex of city.executives) {
        rows.push([
          "Executive",
          city.city,
          ex.executive,
          ex.collection,
          Number(ex.mainPercent.toFixed(2)),
          Number(ex.rollbackPercent.toFixed(2)),
          ex.totalCount,
          ex.paidCount,
          ex.unpaidCount,
          ex.totalPos,
          ex.mainPaidPos,
          Number(ex.mainTarget.toFixed(2)),
          ex.targetPos,
          ex.neededPos,
          Number(ex.rollbackTarget.toFixed(2)),
          ex.targetRollbackPos,
          ex.neededRollbackPos,
        ]);
      }
    }
    const t = selected.total;
    rows.push([
      "GRAND TOTAL",
      selected.bucket,
      "ALL",
      t.collection,
      Number(t.mainPercent.toFixed(2)),
      Number(t.rollbackPercent.toFixed(2)),
      t.totalCount,
      t.paidCount,
      t.unpaidCount,
      t.totalPos,
      t.mainPaidPos,
      Number(t.mainTarget.toFixed(2)),
      t.targetPos,
      t.neededPos,
      Number(t.rollbackTarget.toFixed(2)),
      t.targetRollbackPos,
      t.neededRollbackPos,
    ]);

    const slug = selected.bucket.toLowerCase().replace(/\s+/g, "-");
    downloadCsv(
      `idfc-performance-${slug}.csv`,
      toCsv(
        [
          "Level",
          "City",
          "Executive",
          "Collection",
          "Main %",
          "Rollback %",
          "Total Count",
          "Paid Count",
          "Unpaid Count",
          "Total POS",
          "Main Paid POS",
          "Main Target %",
          "Target POS",
          "Needed POS",
          "Rollback Target %",
          "Target Rollback POS",
          "Needed Rollback POS",
        ],
        rows,
      ),
    );
  }

  function shareBucketSummary() {
    if (!selected) return;
    const t = selected.total;
    const headerLines = [
      `Cases: ${t.totalCount} (${t.paidCount} Paid / ${t.unpaidCount} Unpaid)`,
      `Collection: ${money(t.collection)} | Total POS: ${money(t.totalPos)}`,
      `Main: ${pct(t.mainPercent)} (Target ${pct(t.mainTarget)}) | Needed POS: ${money(Math.max(0, t.neededPos))}`,
      `Rollback: ${pct(t.rollbackPercent)} (Target ${pct(t.rollbackTarget)}) | Needed RB: ${money(Math.max(0, t.neededRollbackPos))}`,
      "",
      "City Breakdown:",
      ...selected.cities.map(
        (c) =>
          `• ${c.city}: Main ${pct(c.mainPercent)} | Need ${money(Math.max(0, c.neededPos))} | RB ${pct(c.rollbackPercent)}`,
      ),
    ];
    void shareText(`IDFC Main Performance — ${selected.bucket}`, headerLines);
  }

  const modifiedLabel = formatModifiedTime(data?.master.modifiedTime ?? null);

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-5 px-3.5 pb-12 pt-4 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
            Admin · Master Allocation
          </p>
          <h1 className="mt-0.5 text-xl font-bold tracking-tight text-foreground sm:text-2xl lg:text-3xl">
            IDFC Main Performance
          </h1>
          <p className="mt-1 truncate text-xs text-muted-foreground sm:text-sm">
            {data
              ? `${data.master.name}${modifiedLabel ? ` · Updated ${modifiedLabel} IST` : ""}`
              : "City-wise and executive-wise collection targets, Needed POS, and rule controls."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {data && (
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 flex-1 whitespace-nowrap sm:min-h-9 sm:flex-initial"
              asChild
            >
              <a href={data.master.url} target="_blank" rel="noreferrer">
                Master Sheet
                <ExternalLink className="ml-1.5 size-3.5" />
              </a>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 flex-1 whitespace-nowrap sm:min-h-9 sm:flex-initial"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={"mr-1.5 size-3.5 " + (isFetching ? "animate-spin" : "")} />
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </header>

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="space-y-4" aria-busy="true" aria-label="Loading performance report">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl border bg-card p-4">
                <div className="h-3 w-24 rounded bg-muted" />
                <div className="mt-3 h-7 w-32 rounded bg-muted" />
                <div className="mt-3 h-2.5 w-40 rounded bg-muted" />
              </div>
            ))}
          </div>
          <div className="h-96 animate-pulse rounded-2xl border bg-card p-5">
            <div className="h-5 w-48 rounded bg-muted" />
            <div className="mt-4 space-y-3">
              {[0, 1, 2, 3, 4].map((row) => (
                <div key={row} className="h-10 rounded-lg bg-muted/60" />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <section className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-600" />
            <div className="text-xs sm:text-sm">
              <p className="font-semibold">Could not load Master Allocation performance</p>
              <p className="mt-0.5 opacity-90">
                {error instanceof Error ? error.message : "Unknown error while loading report."}
              </p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11 shrink-0 whitespace-nowrap bg-white text-red-700 hover:bg-red-50 sm:min-h-9"
            onClick={() => void refetch()}
          >
            Try Again
          </Button>
        </section>
      )}

      {data && (
        <>
          {/* Portfolio KPI Strip (Live Overall Totals across all Buckets) */}
          <section
            aria-label="Overall portfolio performance"
            className="grid grid-cols-2 gap-2.5 sm:gap-3.5 lg:grid-cols-4"
          >
            <KpiCard
              label="Allocated Cases"
              value={data.rowCount.toLocaleString("en-IN")}
              sub={`${data.totals.paidCount.toLocaleString("en-IN")} paid · ${data.totals.unpaidCount.toLocaleString("en-IN")} unpaid`}
            />
            <KpiCard
              label="Total Collection"
              value={money(data.totals.collection)}
              sub={`Total POS ${money(data.totals.totalPos)}`}
            />
            <KpiProgressCard
              label="Overall Main Paid %"
              percent={data.totals.mainPercent}
              target={data.totals.mainTarget}
              achievedPos={data.totals.mainPaidPos}
              neededPos={data.totals.neededPos}
            />
            <KpiProgressCard
              label="Overall Rollback %"
              percent={data.totals.rollbackPercent}
              target={data.totals.rollbackTarget}
              achievedPos={data.totals.rollbackPos}
              neededPos={data.totals.neededRollbackPos}
            />
          </section>

          {/* Bucket Switcher Strip + Clean 3-Tab Navigation */}
          <section className="space-y-3 rounded-2xl border bg-card p-3.5 shadow-2xs sm:p-5">
            {/* Horizontal Swipeable Bucket Selector */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Select Allocation Bucket
                </span>
                {selected && (
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {selected.bucket}: {selected.total.totalCount.toLocaleString("en-IN")} cases ·
                    Main{" "}
                    <strong className="text-foreground">{pct(selected.total.mainPercent)}</strong> ·
                    Needed POS{" "}
                    <strong
                      className={
                        selected.total.neededPos > 0
                          ? "text-amber-700 dark:text-amber-400"
                          : "text-emerald-700 dark:text-emerald-400"
                      }
                    >
                      {money(Math.max(0, selected.total.neededPos))}
                    </strong>
                  </span>
                )}
              </div>

              <div
                role="group"
                aria-label="Bucket filter"
                className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1"
              >
                {data.buckets.map((b) => {
                  const isActive = activeBucketName === b.bucket;
                  const tone = achievementTone(b.total.mainPercent, b.total.mainTarget);
                  return (
                    <button
                      key={b.bucket}
                      type="button"
                      onClick={() => setBucket(b.bucket)}
                      className={`flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-left transition-colors whitespace-nowrap ${
                        isActive
                          ? "border-[#e5b83b] bg-[#fff6d9] text-[#292820] shadow-2xs"
                          : "border-border bg-background text-foreground hover:bg-muted/40"
                      }`}
                    >
                      <span className="text-xs font-bold">{b.bucket}</span>
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {b.total.totalCount.toLocaleString("en-IN")}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums ${
                          isActive ? "bg-white/80 text-[#292820]" : tone.badge
                        }`}
                      >
                        {pct(b.total.mainPercent)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Primary Workspace Tabs: Performance | Needed POS | Targets */}
            <div
              role="tablist"
              aria-label="Performance workspace sections"
              className="grid grid-cols-3 gap-1.5 rounded-xl border bg-muted/40 p-1 sm:inline-flex"
            >
              <TabButton
                active={activeTab === "performance"}
                onClick={() => setActiveTab("performance")}
                icon={<BarChart3 className="size-4 shrink-0" />}
                label="Performance"
              />
              <TabButton
                active={activeTab === "needed_pos"}
                onClick={() => setActiveTab("needed_pos")}
                icon={<Target className="size-4 shrink-0" />}
                label="Needed POS"
                count={totalNeededPosCount}
              />
              <TabButton
                active={activeTab === "targets"}
                onClick={() => setActiveTab("targets")}
                icon={<SlidersHorizontal className="size-4 shrink-0" />}
                label="Targets"
                count={activeRules.length}
                highlightDot={rulesDirty}
              />
            </div>

            {/* TAB 1: PERFORMANCE (City & Executive Drill-Down) */}
            {activeTab === "performance" && selected && (
              <PerformanceTabPanel
                bucketName={selected.bucket}
                cities={selected.cities}
                total={selected.total}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                sortKey={sortKey}
                onSortChange={setSortKey}
                onShare={shareBucketSummary}
                onExportCsv={exportBucketCsv}
              />
            )}

            {/* TAB 2: NEEDED POS (Main & Rollback Shortfalls) */}
            {activeTab === "needed_pos" && (
              <div className="space-y-4 pt-1">
                <div className="flex flex-col gap-2 rounded-xl border bg-muted/20 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs text-muted-foreground">
                    Cities in <strong className="text-foreground">{activeBucketName}</strong> with
                    positive POS required to achieve their Main or Rollback targets.
                  </div>
                  {(mainShareRows.length > 0 || rollbackShareRows.length > 0) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="min-h-10 shrink-0 whitespace-nowrap sm:min-h-8"
                      onClick={() => {
                        const lines: string[] = [];
                        if (mainShareRows.length > 0) {
                          lines.push("Main Needed POS:");
                          mainShareRows.forEach((r) =>
                            lines.push(
                              `• ${r.city}: Need ${money(r.neededPos)} (Paid ${money(r.mainPaidPos)} / Target ${money(r.targetPos)})`,
                            ),
                          );
                        }
                        if (rollbackShareRows.length > 0) {
                          if (lines.length) lines.push("");
                          lines.push("Rollback Needed POS:");
                          rollbackShareRows.forEach((r) =>
                            lines.push(
                              `• ${r.city}: Need ${money(r.neededRollbackPos)} (RB ${money(r.rollbackPos)} / Target ${money(r.targetRollbackPos)})`,
                            ),
                          );
                        }
                        void shareText(`Needed POS Summary — ${activeBucketName}`, lines);
                      }}
                    >
                      <Share2 className="mr-1.5 size-3.5" />
                      Share All ({activeBucketName})
                    </Button>
                  )}
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <ShareTable
                    title="City-wise Needed Main POS"
                    bucketName={activeBucketName}
                    csvFilename={`needed-main-pos-${activeBucketName.toLowerCase().replace(/\s+/g, "-")}.csv`}
                    rows={mainShareRows.filter((r) => r.neededPos > 0).map((r) => ({
                      city: r.city,
                      cases: r.totalCount,
                      need: r.neededPos,
                      paid: r.mainPaidPos,
                      target: r.targetPos,
                    }))}
                    onShare={() =>
                      void shareText(
                        "City-wise Needed POS — " + activeBucketName,
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
                    bucketName={activeBucketName}
                    csvFilename={`needed-rollback-pos-${activeBucketName.toLowerCase().replace(/\s+/g, "-")}.csv`}
                    rows={rollbackShareRows.filter((r) => r.neededRollbackPos > 0).map((r) => ({
                      city: r.city,
                      cases: r.totalCount,
                      need: r.neededRollbackPos,
                      paid: r.rollbackPos,
                      target: r.targetRollbackPos,
                    }))}
                    onShare={() =>
                      void shareText(
                        "City-wise Needed Rollback POS — " + activeBucketName,
                        rollbackShareRows.map((r) =>
                          [
                            r.city,
                            "Cases " + r.totalCount,
                            "Needed Rollback POS " + money(r.neededRollbackPos),
                            "Rollback POS " + money(r.rollbackPos),
                            "Target Rollback POS " + money(r.targetRollbackPos),
                          ].join(" | "),
                        ),
                      )
                    }
                  />
                </div>
              </div>
            )}

            {/* TAB 3: TARGET MANAGER */}
            {activeTab === "targets" && (
              <section className="space-y-4 pt-1">
                <div className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-foreground">Performance Target Rules</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Defaults: Main{" "}
                      <strong className="font-mono text-foreground">
                        {pct(data.defaults.mainTarget)}
                      </strong>{" "}
                      · Rollback{" "}
                      <strong className="font-mono text-foreground">
                        {pct(data.defaults.rollbackTarget)}
                      </strong>
                      . Blank dimensions match &ldquo;All&rdquo;; more specific rules override
                      broader rules.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {rulesDirty && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="min-h-10 whitespace-nowrap sm:min-h-9"
                        disabled={saving}
                        onClick={() => setRules(null)}
                      >
                        Discard Edits
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="min-h-10 whitespace-nowrap sm:min-h-9"
                      onClick={() => setRules([...activeRules, emptyRule()])}
                    >
                      <Plus className="mr-1.5 size-4" />
                      Add Rule
                    </Button>
                  </div>
                </div>

                {activeRules.length === 0 ? (
                  <div className="rounded-xl border border-dashed bg-muted/10 px-4 py-8 text-center">
                    <p className="text-sm font-medium text-foreground">
                      No custom target rules configured
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      All buckets and cities currently use defaults (Main{" "}
                      {pct(data.defaults.mainTarget)} · Rollback {pct(data.defaults.rollbackTarget)}
                      ).
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activeRules.map((rule, i) => (
                      <div
                        key={rule.id}
                        className="grid grid-cols-1 gap-2.5 rounded-xl border bg-background p-3.5 sm:grid-cols-2 lg:grid-cols-7"
                      >
                        <Field label="Allocation Type">
                          <select
                            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm md:h-10"
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
                            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm md:h-10"
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
                            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm md:h-10"
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
                            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm md:h-10"
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
                            inputMode="decimal"
                            min="0"
                            max="100"
                            step="0.5"
                            className="h-11 font-mono tabular-nums md:h-10"
                            value={rule.mainTarget}
                            onChange={(e) => updateRule(i, { mainTarget: Number(e.target.value) })}
                          />
                        </Field>
                        <Field label="Rollback Target %">
                          <Input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max="100"
                            step="0.5"
                            className="h-11 font-mono tabular-nums md:h-10"
                            value={rule.rollbackTarget}
                            onChange={(e) =>
                              updateRule(i, { rollbackTarget: Number(e.target.value) })
                            }
                          />
                        </Field>
                        <div className="flex items-end justify-end lg:justify-start">
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            aria-label="Delete target rule"
                            className="h-11 w-full text-red-600 hover:bg-red-50 hover:text-red-700 lg:h-10 lg:w-10"
                            onClick={() => setRules(activeRules.filter((_, n) => n !== i))}
                          >
                            <Trash2 className="size-4" />
                            <span className="ml-1.5 text-xs font-semibold lg:hidden">
                              Remove Rule
                            </span>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-col gap-2 border-t pt-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground">
                    {rulesDirty
                      ? "You have unsaved target rule edits — save to recalculate Needed POS."
                      : "Target rules are stored in the “Performance Targets” tab of Master Allocation."}
                  </p>
                  <Button
                    type="button"
                    className="min-h-11 w-full whitespace-nowrap sm:min-h-10 sm:w-auto sm:px-6"
                    onClick={() => void persistRules()}
                    disabled={saving}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="mr-1.5 size-4 animate-spin" />
                        Saving Rules…
                      </>
                    ) : (
                      "Save Target Rules"
                    )}
                  </Button>
                </div>
              </section>
            )}
          </section>

          <p className="text-xs text-muted-foreground">
            Source: {data.master.name} · {data.rowCount.toLocaleString("en-IN")} allocated loan rows
          </p>
        </>
      )}
    </main>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
  highlightDot,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
  highlightDot?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors whitespace-nowrap md:min-h-9 ${
        active
          ? "bg-primary text-primary-foreground shadow-xs"
          : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
      }`}
    >
      {icon}
      <span>{label}</span>
      {count !== undefined && (
        <span
          className={`font-mono text-[11px] tabular-nums ${
            active ? "text-primary-foreground/90" : "text-muted-foreground"
          }`}
        >
          ({count})
        </span>
      )}
      {highlightDot && (
        <span
          aria-label="Unsaved edits"
          className={`size-1.5 rounded-full ${active ? "bg-amber-300" : "bg-amber-500"}`}
        />
      )}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border bg-card p-3.5 shadow-2xs sm:p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 font-mono text-xl font-bold tabular-nums text-foreground sm:text-2xl">
        {value}
      </p>
      <p className="mt-1 truncate font-mono text-[11px] tabular-nums text-muted-foreground">
        {sub}
      </p>
    </div>
  );
}

function KpiProgressCard({
  label,
  percent,
  target,
  achievedPos,
  neededPos,
}: {
  label: string;
  percent: number;
  target: number;
  achievedPos: number;
  neededPos: number;
}) {
  const tone = achievementTone(percent, target);
  const fillWidth = Math.min(100, Math.max(0, target > 0 ? (percent / target) * 100 : percent));

  return (
    <div className="rounded-xl border bg-card p-3.5 shadow-2xs sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <span className="font-mono text-[11px] font-medium tabular-nums text-muted-foreground">
          Goal {pct(target)}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <p className={`font-mono text-xl font-bold tabular-nums sm:text-2xl ${tone.text}`}>
          {pct(percent)}
        </p>
        <span className="truncate font-mono text-[11px] tabular-nums text-muted-foreground">
          {money(achievedPos)}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${tone.bar}`}
          style={{ width: `${fillWidth}%` }}
        />
      </div>
      <p className="mt-1.5 truncate font-mono text-[11px] tabular-nums text-muted-foreground">
        {neededPos > 0 ? (
          <>
            Need <strong className="text-foreground">{money(neededPos)}</strong>
          </>
        ) : (
          <strong className="text-emerald-700 dark:text-emerald-400">
            Target Achieved (+{money(Math.abs(neededPos))})
          </strong>
        )}
      </p>
    </div>
  );
}

function ShareTable({ title, bucketName, csvFilename, rows }: {
  title: string; bucketName: string; csvFilename: string;
  rows: { city: string; cases: number; need: number; paid: number; target: number }[];
}) {
  const [visible, setVisible] = useState(["cases", "target", "paid", "need"]);
  const positive = rows.filter((r) => Number.isFinite(r.need) && r.need > 0);
  const options = [{key:"cases",label:"Cases"},{key:"target",label:"Target POS"},{key:"paid",label:"Achieved POS"},{key:"need",label:"Needed POS"}];
  const columns = options.filter(col => visible.includes(col.key));
  const totalNeed = positive.reduce((s,r)=>s+r.need,0), totalCases = positive.reduce((s,r)=>s+r.cases,0);
  const value = (r: typeof rows[number], key: string) => key==="cases" ? r.cases.toLocaleString("en-IN") : money(key==="target"?r.target:key==="paid"?r.paid:r.need);
  async function shareJpg() {
    if (!columns.length) { toast.error("Select at least one column."); return; }
    try {
      const canvas=document.createElement("canvas"), scale=2, width=1100, rh=64, top=170, height=top+(positive.length+1)*rh+35;
      canvas.width=width*scale; canvas.height=height*scale;
      const ctx=canvas.getContext("2d"); if(!ctx) throw new Error("JPG generation failed.");
      ctx.scale(scale,scale); ctx.fillStyle="#fff"; ctx.fillRect(0,0,width,height); ctx.fillStyle="#292820"; ctx.fillRect(0,0,width,10);
      ctx.font="bold 32px Arial"; ctx.fillText(title,42,58); ctx.font="20px Arial"; ctx.fillStyle="#6b6250";
      ctx.fillText(bucketName+" · "+positive.length+" cities · Needed POS "+money(totalNeed),42,100);
      const cityW=330,colW=(width-84-cityW)/columns.length;
      ctx.fillStyle="#fff1c5"; ctx.fillRect(35,top,width-70,rh); ctx.fillStyle="#292820"; ctx.font="bold 18px Arial"; ctx.textBaseline="middle"; ctx.textAlign="left"; ctx.fillText("City",50,top+rh/2);
      columns.forEach((col,i)=>{ctx.textAlign="right";ctx.fillText(col.label,width-50-i*colW,top+rh/2);});
      positive.forEach((r,i)=>{const y=top+(i+1)*rh;ctx.fillStyle=i%2?"#faf8f1":"#fff";ctx.fillRect(35,y,width-70,rh);ctx.fillStyle="#292820";ctx.font="18px Arial";ctx.textAlign="left";ctx.fillText(r.city,50,y+rh/2,cityW-20);columns.forEach((col,j)=>{ctx.textAlign="right";ctx.fillStyle=col.key==="need"?"#9a5b00":"#292820";ctx.fillText(value(r,col.key),width-50-j*colW,y+rh/2);});});
      const y=top+(positive.length+1)*rh;ctx.fillStyle="#f4eddb";ctx.fillRect(35,y,width-70,35);ctx.font="bold 17px Arial";ctx.textAlign="left";ctx.fillStyle="#292820";ctx.fillText("TOTAL · "+positive.length+" cities · "+totalCases.toLocaleString("en-IN")+" cases",50,y+18);
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Could not export JPG.")),"image/jpeg",.94));
      const filename=csvFilename.replace(/\.csv$/i,".jpg"),file=new File([blob],filename,{type:"image/jpeg"});
      if(navigator.share&&navigator.canShare?.({files:[file]})) await navigator.share({files:[file],title});
      else {const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);toast.success("JPG downloaded; share it on WhatsApp.");}
    } catch(err) {if(err instanceof Error&&err.name!=="AbortError")toast.error(err.message);}
  }
  return <section className="min-w-0 overflow-hidden rounded-xl border bg-background">
    <div className="flex flex-col gap-2.5 border-b bg-muted/20 p-3.5 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-bold">{title}</h3><p className="mt-0.5 text-[11px] text-muted-foreground">{bucketName} · {positive.length} cities · Total Needed {money(totalNeed)}</p></div>
      <div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={!positive.length} onClick={()=>downloadCsv(csvFilename,toCsv(["Bucket","City","Cases","Target POS","Achieved POS","Needed POS"],positive.map(r=>[bucketName,r.city,r.cases,r.target,r.paid,r.need])))}><Download className="mr-1.5 size-3.5"/>CSV</Button><Button type="button" size="sm" variant="outline" disabled={!positive.length} onClick={()=>void shareJpg()}><Share2 className="mr-1.5 size-3.5"/>Share JPG</Button></div>
    </div>
    <div className="border-b px-3.5 py-3"><div className="mb-2 flex items-center gap-1.5 text-xs font-semibold"><Columns3 className="size-3.5"/>Columns to show / share</div><div className="flex flex-wrap gap-4">{options.map(col=><label key={col.key} className="inline-flex min-h-8 items-center gap-2 text-xs"><input type="checkbox" className="size-4 accent-[#d4a928]" checked={visible.includes(col.key)} onChange={ev=>setVisible(old=>ev.target.checked?[...old,col.key]:old.filter(k=>k!==col.key))}/>{col.label}</label>)}</div></div>
    {!positive.length?<div className="p-6 text-center text-xs text-muted-foreground">No positive POS shortfall for {bucketName}.</div>:<div className="overflow-x-auto"><table className="w-full text-xs"><thead className="border-b bg-muted/40"><tr><th className="px-3 py-2 text-left">City</th>{columns.map(col=><th key={col.key} className="px-3 py-2 text-right">{col.label}</th>)}</tr></thead><tbody className="divide-y">{positive.map(r=><tr key={r.city}><td className="px-3 py-2 font-semibold">{r.city}</td>{columns.map(col=><td key={col.key} className="px-3 py-2 text-right font-mono">{value(r,col.key)}</td>)}</tr>)}</tbody><tfoot className="border-t-2 font-bold"><tr><td className="px-3 py-2">Total ({positive.length} cities)</td>{columns.map(col=><td key={col.key} className="px-3 py-2 text-right font-mono">{col.key==="cases"?totalCases.toLocaleString("en-IN"):money(col.key==="need"?totalNeed:positive.reduce((sum,r)=>sum+(col.key==="target"?r.target:r.paid),0))}</td>)}</tr></tfoot></table></div>}
  </section>;
}
function PerformanceTabPanel({
  bucketName,
  cities,
  total,
  searchQuery,
  onSearchChange,
  sortKey,
  onSortChange,
  onShare,
  onExportCsv,
}: {
  bucketName: string;
  cities: City[];
  total: Metric;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  sortKey: SortKey;
  onSortChange: (k: SortKey) => void;
  onShare: () => void;
  onExportCsv: () => void;
}) {
  const [expandedCities, setExpandedCities] = useState<Set<string>>(() => new Set());

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const visibleCities = useMemo(() => {
    const filtered = cities
      .map((city) => {
        if (!normalizedQuery) return city;
        const cityMatch = city.city.toLowerCase().includes(normalizedQuery);
        const matchingExecs = city.executives.filter((ex) =>
          ex.executive.toLowerCase().includes(normalizedQuery),
        );
        if (cityMatch) return city;
        if (matchingExecs.length > 0) return { ...city, executives: matchingExecs };
        return null;
      })
      .filter((c): c is City => c !== null);

    return filtered.sort((a, b) => {
      switch (sortKey) {
        case "neededPos":
          return b.neededPos - a.neededPos || b.totalCount - a.totalCount;
        case "mainPercentAsc":
          return a.mainPercent - b.mainPercent || b.totalPos - a.totalPos;
        case "totalCount":
          return b.totalCount - a.totalCount || a.city.localeCompare(b.city);
        case "name":
          return a.city.localeCompare(b.city);
      }
    });
  }, [cities, normalizedQuery, sortKey]);

  const toggleCity = (cityName: string) =>
    setExpandedCities((current) => {
      const next = new Set(current);
      if (next.has(cityName)) next.delete(cityName);
      else next.add(cityName);
      return next;
    });

  const isCityExpanded = (cityName: string) => {
    if (normalizedQuery) {
      const city = visibleCities.find((c) => c.city === cityName);
      if (city && !city.city.toLowerCase().includes(normalizedQuery)) return true;
    }
    return expandedCities.has(cityName);
  };

  const headers = [
    "City / Executive",
    "Collection",
    "Main %",
    "RB %",
    "Total",
    "Paid",
    "Unpaid",
    "Total POS",
    "Paid POS",
    "Main Goal",
    "Target POS",
    "Needed POS",
    "RB Goal",
    "Target RB",
    "Needed RB",
  ];

  const metricCells = (m: Metric) => [
    money(m.collection),
    pct(m.mainPercent),
    pct(m.rollbackPercent),
    m.totalCount.toLocaleString("en-IN"),
    m.paidCount.toLocaleString("en-IN"),
    m.unpaidCount.toLocaleString("en-IN"),
    money(m.totalPos),
    money(m.mainPaidPos),
    pct(m.mainTarget),
    money(m.targetPos),
    money(m.neededPos),
    pct(m.rollbackTarget),
    money(m.targetRollbackPos),
    money(m.neededRollbackPos),
  ];

  return (
    <div className="space-y-3.5 pt-1">
      {/* Search, Sort & Export Utility Strip */}
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:flex-1">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search City or Executive…"
              className="h-11 pl-9 pr-9 text-sm md:h-9 md:text-xs"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => onSearchChange("")}
                className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <select
            aria-label="Sort cities"
            value={sortKey}
            onChange={(e) => onSortChange(e.target.value as SortKey)}
            className="h-11 rounded-lg border border-input bg-background px-3 text-xs font-medium md:h-9"
          >
            <option value="neededPos">Sort: Needed POS (High → Low)</option>
            <option value="mainPercentAsc">Sort: Main % (Low → High)</option>
            <option value="totalCount">Sort: Cases (High → Low)</option>
            <option value="name">Sort: City (A → Z)</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-10 flex-1 whitespace-nowrap sm:min-h-9 sm:flex-initial"
            onClick={() => setExpandedCities(new Set(visibleCities.map((c) => c.city)))}
          >
            Expand All
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-10 flex-1 whitespace-nowrap sm:min-h-9 sm:flex-initial"
            onClick={() => setExpandedCities(new Set())}
          >
            Collapse All
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-10 flex-1 whitespace-nowrap sm:min-h-9 sm:flex-initial"
            onClick={onShare}
          >
            <Share2 className="mr-1.5 size-3.5" />
            Share
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-10 flex-1 whitespace-nowrap sm:min-h-9 sm:flex-initial"
            onClick={onExportCsv}
          >
            <Download className="mr-1.5 size-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {visibleCities.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/10 px-4 py-10 text-center text-xs text-muted-foreground">
          {cities.length === 0
            ? `No allocated accounts found in ${bucketName}.`
            : `No cities or executives match "${searchQuery}".`}
        </div>
      ) : (
        <>
          {/* ANDROID / MOBILE CARDS (Zero horizontal scroll) */}
          <div className="space-y-3 md:hidden">
            {/* Bucket Total Highlight Card */}
            <div className="rounded-xl border border-[#e5b83b]/70 bg-[#fff9e8] p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-extrabold uppercase tracking-wide text-[#292820]">
                  {bucketName} Total
                </span>
                <span className="font-mono text-xs font-semibold tabular-nums text-[#535b64]">
                  {total.paidCount}/{total.totalCount} paid
                </span>
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
                <div>
                  <div className="font-sans text-[10px] text-[#737b84]">Total POS</div>
                  <div className="font-bold text-[#252525]">{money(total.totalPos)}</div>
                </div>
                <div>
                  <div className="font-sans text-[10px] text-[#737b84]">Main %</div>
                  <div className="font-bold text-[#252525]">{pct(total.mainPercent)}</div>
                </div>
                <div className="text-right">
                  <div className="font-sans text-[10px] text-[#737b84]">Needed POS</div>
                  <div className="font-extrabold text-[#252525]">
                    {money(Math.max(0, total.neededPos))}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#e5b83b]/40 pt-2 font-mono text-[11px] tabular-nums text-[#535b64]">
                <span>Collection: {money(total.collection)}</span>
                <span>
                  RB: {pct(total.rollbackPercent)} · Need{" "}
                  {money(Math.max(0, total.neededRollbackPos))}
                </span>
              </div>
            </div>

            {visibleCities.map((city) => {
              const expanded = isCityExpanded(city.city);
              const tone = achievementTone(city.mainPercent, city.mainTarget);
              return (
                <article
                  key={city.city}
                  className="overflow-hidden rounded-xl border bg-background shadow-2xs"
                >
                  <div className="space-y-3 p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-bold text-foreground">{city.city}</h3>
                        <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                          {city.paidCount}/{city.totalCount} paid · {city.unpaidCount} unpaid ·{" "}
                          {city.executives.length} execs
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums ${tone.badge}`}
                      >
                        {pct(city.mainPercent)} / {pct(city.mainTarget)}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/35 p-2.5 font-mono text-xs tabular-nums">
                      <div>
                        <div className="font-sans text-[10px] text-muted-foreground">Total POS</div>
                        <div className="font-semibold text-foreground">{money(city.totalPos)}</div>
                      </div>
                      <div>
                        <div className="font-sans text-[10px] text-muted-foreground">Main Paid</div>
                        <div className="font-semibold text-foreground">
                          {money(city.mainPaidPos)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-sans text-[10px] text-muted-foreground">
                          Needed POS
                        </div>
                        <div
                          className={`font-bold ${
                            city.neededPos > 0
                              ? "text-amber-700 dark:text-amber-400"
                              : "text-emerald-700 dark:text-emerald-400"
                          }`}
                        >
                          {city.neededPos > 0 ? money(city.neededPos) : "Met"}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                      <span>Collection: {money(city.collection)}</span>
                      <span>
                        RB: {pct(city.rollbackPercent)} (Goal {pct(city.rollbackTarget)}) · Need{" "}
                        {city.neededRollbackPos > 0 ? money(city.neededRollbackPos) : "Met"}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => toggleCity(city.city)}
                    className="flex min-h-11 w-full items-center justify-between border-t bg-muted/20 px-3.5 text-xs font-semibold text-foreground hover:bg-muted/40"
                  >
                    <span>
                      {expanded ? "Hide" : "View"} Executives ({city.executives.length})
                    </span>
                    {expanded ? (
                      <ChevronDown className="size-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 text-muted-foreground" />
                    )}
                  </button>

                  {expanded && (
                    <div className="divide-y border-t bg-muted/10">
                      {city.executives.map((ex) => {
                        const exTone = achievementTone(ex.mainPercent, ex.mainTarget);
                        return (
                          <div key={ex.executive} className="space-y-1.5 px-3.5 py-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs font-bold text-foreground">
                                {ex.executive}
                              </span>
                              <span
                                className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums ${exTone.badge}`}
                              >
                                {pct(ex.mainPercent)}
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 font-mono text-[11px] tabular-nums">
                              <div>
                                <span className="text-muted-foreground">Cases: </span>
                                <strong className="text-foreground">
                                  {ex.paidCount}/{ex.totalCount}
                                </strong>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Col: </span>
                                <strong className="text-foreground">{money(ex.collection)}</strong>
                              </div>
                              <div className="text-right">
                                <span className="text-muted-foreground">Need: </span>
                                <strong
                                  className={
                                    ex.neededPos > 0
                                      ? "text-amber-700 dark:text-amber-400"
                                      : "text-emerald-700 dark:text-emerald-400"
                                  }
                                >
                                  {ex.neededPos > 0 ? money(ex.neededPos) : "Met"}
                                </strong>
                              </div>
                            </div>
                            <div className="flex items-center justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
                              <span>
                                Paid POS {money(ex.mainPaidPos)} / {money(ex.totalPos)}
                              </span>
                              <span>
                                RB {pct(ex.rollbackPercent)} · Need{" "}
                                {ex.neededRollbackPos > 0 ? money(ex.neededRollbackPos) : "Met"}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {/* DESKTOP LEDGER TABLE */}
          <div className="hidden overflow-x-auto rounded-xl border bg-background md:block">
            <table className="w-full min-w-[1440px] text-xs">
              <thead className="border-b bg-muted/60 text-[11px] uppercase text-muted-foreground">
                <tr>
                  {headers.map((h, i) => (
                    <th
                      key={h}
                      className={
                        "px-2.5 py-3 text-right font-semibold whitespace-nowrap " +
                        (i === 0 ? "sticky left-0 z-10 bg-muted text-left" : "")
                      }
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleCities.map((city) => {
                  const expanded = isCityExpanded(city.city);
                  const cityTone = achievementTone(city.mainPercent, city.mainTarget);
                  return (
                    <Fragment key={city.city}>
                      <tr className="bg-amber-50/70 font-bold hover:bg-amber-50">
                        <td className="sticky left-0 z-10 bg-[#fef8e2] px-2.5 py-2">
                          <button
                            type="button"
                            className="flex min-h-8 w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-expanded={expanded}
                            aria-label={
                              (expanded ? "Collapse " : "Expand ") + city.city + " executives"
                            }
                            onClick={() => toggleCity(city.city)}
                          >
                            {expanded ? (
                              <ChevronDown className="size-4 shrink-0" />
                            ) : (
                              <ChevronRight className="size-4 shrink-0" />
                            )}
                            <span>{city.city}</span>
                            <span className="font-mono text-[10px] font-normal text-muted-foreground">
                              ({city.executives.length})
                            </span>
                          </button>
                        </td>
                        {metricCells(city).map((v, i) => (
                          <td
                            key={i}
                            className={`px-2.5 py-2 text-right font-mono tabular-nums ${
                              i === 1
                                ? cityTone.text
                                : i === 10 && city.neededPos > 0
                                  ? "text-amber-700"
                                  : ""
                            }`}
                          >
                            {v}
                          </td>
                        ))}
                      </tr>
                      {expanded &&
                        city.executives.map((ex) => {
                          const exTone = achievementTone(ex.mainPercent, ex.mainTarget);
                          return (
                            <tr key={city.city + "-" + ex.executive} className="hover:bg-muted/20">
                              <td className="sticky left-0 z-10 bg-background px-2.5 py-2 pl-8 text-left font-medium">
                                {ex.executive}
                              </td>
                              {metricCells(ex).map((v, i) => (
                                <td
                                  key={i}
                                  className={`px-2.5 py-2 text-right font-mono tabular-nums ${
                                    i === 1
                                      ? `font-semibold ${exTone.text}`
                                      : i === 10 && ex.neededPos > 0
                                        ? "font-semibold text-amber-700"
                                        : ""
                                  }`}
                                >
                                  {v}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 bg-muted/70 font-extrabold">
                <tr>
                  <td className="sticky left-0 z-10 bg-muted px-2.5 py-3">
                    GRAND TOTAL ({bucketName})
                  </td>
                  {metricCells(total).map((v, i) => (
                    <td key={i} className="px-2.5 py-3 text-right font-mono tabular-nums">
                      {v}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
