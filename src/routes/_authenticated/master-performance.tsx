import { Fragment, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
} from "lucide-react";
import {
  getMasterPerformanceReport,
  saveMasterPerformanceTargets,
} from "@/lib/master-performance.functions";
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
  master: { name: string; url: string; modifiedTime: string | null };
  rowCount: number;
  buckets: { bucket: string; cities: City[]; total: Metric }[];
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

const money = (n: number) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const pct = (n: number) => Number(n || 0).toFixed(2) + "%";
const emptyRule = (): Rule => ({
  id: globalThis.crypto?.randomUUID?.() ?? "rule-" + Date.now(),
  allocationType: "",
  bucket: "",
  state: "",
  city: "",
  mainTarget: 60,
  rollbackTarget: 18,
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
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [saving, setSaving] = useState(false);
  const activeRules = rules ?? data?.rules ?? [];
  const selected = data?.buckets.find((b) => b.bucket === bucket) ?? data?.buckets[0];
  const mainShareRows = useMemo(
    () => (data?.positiveNeededPos ?? []).filter((r) => r.bucket === bucket),
    [data, bucket],
  );
  const rollbackShareRows = useMemo(
    () => (data?.positiveNeededRollback ?? []).filter((r) => r.bucket === bucket),
    [data, bucket],
  );

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
          <p className="text-xs font-bold uppercase tracking-wider text-amber-700">
            Admin · Master Allocation
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">
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
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Summary label="Allocated cases" value={data.rowCount.toLocaleString("en-IN")} />
            <Summary label="Buckets" value="5" />
            <Summary label="Default Main Target" value={pct(data.defaults.mainTarget)} />
            <Summary label="Default Rollback Target" value={pct(data.defaults.rollbackTarget)} />
          </div>
          <div className="rounded-xl border bg-white p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-bold">Bucket performance</h2>
                <p className="text-xs text-muted-foreground">
                  City totals expand into executive-level rows.
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {data.buckets.map((b) => (
                  <Button
                    key={b.bucket}
                    size="sm"
                    variant={bucket === b.bucket ? "default" : "outline"}
                    onClick={() => setBucket(b.bucket)}
                  >
                    {b.bucket}
                  </Button>
                ))}
              </div>
            </div>
            {selected && <PerformanceTable cities={selected.cities} total={selected.total} />}
          </div>

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
                  "City-wise Needed POS — " + bucket,
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
              onShare={() =>
                void share(
                  "City-wise Needed Rollback POS — " + bucket,
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
            {activeRules.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No custom rules. Defaults are Main 60% and Rollback 18%.
              </p>
            )}
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
            Source: {data.master.name} · {data.rowCount.toLocaleString("en-IN")} allocated loan rows
            · Target settings stored in the “Performance Targets” tab.
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
function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-white p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-extrabold tabular-nums">{value}</p>
    </div>
  );
}
function ShareTable({
  title,
  rows,
  onShare,
}: {
  title: string;
  rows: { city: string; cases: number; need: number; paid: number; target: number }[];
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
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-muted/60">
            <tr>
              {["City", "Cases", "Target POS", "Achieved POS", "Needed POS"].map((v) => (
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
                <td className="px-3 py-2 text-right">{r.cases}</td>
                <td className="px-3 py-2 text-right">{money(r.target)}</td>
                <td className="px-3 py-2 text-right">{money(r.paid)}</td>
                <td className="px-3 py-2 text-right font-bold">{money(r.need)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="p-5 text-center text-muted-foreground">
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
function PerformanceTable({ cities, total }: { cities: City[]; total: Metric }) {
  const [expandedCities, setExpandedCities] = useState<Set<string>>(() => new Set());
  const allExpanded = cities.length > 0 && cities.every((city) => expandedCities.has(city.city));
  const toggleCity = (cityName: string) =>
    setExpandedCities((current) => {
      const next = new Set(current);
      if (next.has(cityName)) next.delete(cityName);
      else next.add(cityName);
      return next;
    });
  const headers = [
    "City / Executive",
    "Collection",
    "Total %",
    "Sum of RB %",
    "Total Count",
    "Paid Count",
    "Unpaid Count",
    "Total POS",
    "Total Paid POS",
    "Main Target %",
    "Target POS",
    "Needed POS",
    "Rollback Target %",
    "Target Rollback POS",
    "Needed Rollback POS",
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
    <div className="overflow-x-auto">
      <div className="mb-2 flex justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setExpandedCities(new Set(cities.map((city) => city.city)))}
        >
          Expand all
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setExpandedCities(new Set())}>
          Collapse all
        </Button>
      </div>
      <table className="w-full min-w-[1500px] text-xs">
        <thead className="bg-muted/70">
          <tr>
            {headers.map((h, i) => (
              <th
                key={h}
                className={
                  "px-2 py-3 text-right font-semibold " +
                  (i === 0 ? "sticky left-0 z-10 bg-muted/70 text-left" : "")
                }
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cities.map((city) => (
            <Fragment key={city.city}>
              <tr className="border-t bg-amber-50/70 font-bold">
                <td className="sticky left-0 bg-amber-50 px-2 py-2">
                  <button
                    type="button"
                    className="flex min-h-8 w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-expanded={expandedCities.has(city.city)}
                    aria-label={
                      (expandedCities.has(city.city) ? "Collapse " : "Expand ") +
                      city.city +
                      " executives"
                    }
                    onClick={() => toggleCity(city.city)}
                  >
                    {expandedCities.has(city.city) ? (
                      <ChevronDown className="size-4 shrink-0" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0" />
                    )}
                    <span>{city.city}</span>
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      ({city.executives.length})
                    </span>
                  </button>
                </td>
                {metricCells(city).map((v, i) => (
                  <td key={i} className="px-2 py-2 text-right tabular-nums">
                    {v}
                  </td>
                ))}
              </tr>
              {expandedCities.has(city.city) &&
                city.executives.map((ex) => (
                  <tr key={city.city + "-" + ex.executive} className="border-t">
                    <td className="sticky left-0 bg-white px-2 py-2 pl-8 text-left">
                      {ex.executive}
                    </td>
                    {metricCells(ex).map((v, i) => (
                      <td key={i} className="px-2 py-2 text-right tabular-nums">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
            </Fragment>
          ))}
          <tr className="border-t-2 bg-muted/70 font-extrabold">
            <td className="sticky left-0 bg-muted px-2 py-3">GRAND TOTAL</td>
            {metricCells(total).map((v, i) => (
              <td key={i} className="px-2 py-3 text-right tabular-nums">
                {v}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
