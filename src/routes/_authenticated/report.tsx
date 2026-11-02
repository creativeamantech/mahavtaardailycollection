import { NotificationPanel } from "@/components/NotificationPanel";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, PieChart, Pie, Cell, Legend } from "recharts";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { getCollections, highlightAlreadyPaidInSheet } from "@/lib/mahavtaar.functions";
import { formatAmount, todayISO } from "@/lib/executives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BUCKETS, bucketMatches, loanStats, summariseLoans } from "@/lib/loans";
import { MonthSelect } from "@/components/MonthSelect";
import { currentMonthKey, monthKey, monthOptions } from "@/lib/months";
import { downloadCollectionExport, downloadFullCollectionCsv } from "@/lib/export";
import { ALL_CATEGORIES, CategoryFilter, useCategoryFilter } from "@/components/AllocationFilters";
import { getExcludedLoanNumbers } from "@/lib/excluded-loans.functions";
import { listActiveHoldCasesForReport } from "@/lib/hold-cases.functions";


// Export button — includes regular + Already Paid cases with "Already Paid" column at the end.
function ExportButton({
  rows,
  fullRows,
  label,
  onExportSync,
}: {
  rows: Collection[];
  fullRows?: Collection[];
  label: string;
  onExportSync?: () => Promise<void> | void;
}) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async (type: "filtered" | "all") => {
    try {
      setExporting(true);
      if (onExportSync) {
        await onExportSync();
      }
      if (type === "filtered") {
        downloadCollectionExport(rows, label);
        toast.success(`Exported ${rows.length} collection cases (including Already Paid) to CSV.`);
      } else if (fullRows && fullRows.length > 0) {
        downloadFullCollectionCsv(fullRows, label);
        toast.success(`Exported all ${fullRows.length} collection sheet cases to CSV.`);
      }
    } catch {
      if (type === "filtered") {
        downloadCollectionExport(rows, label);
      } else if (fullRows) {
        downloadFullCollectionCsv(fullRows, label);
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        className="h-12 w-full text-base font-medium"
        disabled={rows.length === 0 || exporting}
        onClick={() => handleExport("filtered")}
      >
        <Download className="mr-2 h-4 w-4" />
        {exporting ? "Preparing CSV..." : `Download Collection CSV (${rows.length} cases)`}
      </Button>
      {fullRows && fullRows.length > rows.length && (
        <Button
          type="button"
          variant="ghost"
          className="h-10 w-full text-sm text-muted-foreground hover:text-foreground"
          disabled={exporting}
          onClick={() => handleExport("all")}
        >
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Download Complete Collection Sheet CSV ({fullRows.length} total cases)
        </Button>
      )}
    </div>
  );
}

const ALL_BUCKETS = "__all__";

export const Route = createFileRoute("/_authenticated/report")({
  head: () => ({
    meta: [
      { title: "Collection Report — Mahavtaar Daily Collection" },
      {
        name: "description",
        content:
          "Date-wise and all-time collection totals per executive with case counts and a comparison chart.",
      },
      { property: "og:title", content: "Collection Report — Mahavtaar Daily Collection" },
      {
        property: "og:description",
        content: "Executive-wise collection totals and case counts, date-wise or all time.",
      },
    ],
  }),
  component: ReportPage,
});

type Row = {
  executive: string;
  total: number;
  count: number;
  normalCount: number;
  previousCount: number;
};

type Collection = {
  executive: string;
  loanId?: string;
  amount: number;
  date: string;
  time?: string;
  entryDate?: string;
  entryType?: string;
  createdAt?: string;
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
  amansRemarks?: string;
  allocationCategory?: string;
  allocationDate?: string;
  alreadyPaid?: boolean;
  row?: number;
};

function toDriveUrl(url: string): string {
  if (!url) return "#";
  const match = url.match(/(?:id=|\/d\/)([a-zA-Z0-9_-]+)/);
  if (match) return `https://drive.google.com/file/d/${match[1]}/view`;
  return url;
}

function BucketFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <Label className="text-base">Bucket</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-12 text-base">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_BUCKETS} className="text-base">
            All Buckets
          </SelectItem>
          {BUCKETS.map((b) => (
            <SelectItem key={b} value={b} className="text-base">
              {b}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Loan-level figures, computed from the same already-fetched dataset.
function LoanStatsCards({ rows }: { rows: Collection[] }) {
  const stats = useMemo(
    () =>
      loanStats(
        summariseLoans(
          rows.map((r) => ({
            executive: r.executive,
            loanId: r.loanId ?? "",
            amount: r.amount,
            date: r.date,
            settlement: r.settlement ?? false,
            settlementType: r.settlementType,
            foreclosureEntry: r.foreclosureEntry,
            bucket: r.bucket ?? "",
            city: r.city ?? "",
            emiAmount: r.emiAmount ?? null,
            pos: r.pos ?? null,
            foreclosure: r.foreclosure ?? null,
          })),
        ),
      ),
    [rows],
  );
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatCard label="Main Paid Cases" value={String(stats.mainPaidCases)} />
      <StatCard label="Main Paid EMI Count" value={String(stats.mainPaidEmiCount)} />
      <StatCard label="POS Paid — Not Main Paid" value={String(stats.posPaidNotMainPaid)} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

function topOverall(rows: Collection[]) {
  const all = summarise(rows);
  return all[0] ?? null;
}

function dailyTop(rows: Collection[]) {
  const byDate = new Map<string, Map<string, { total: number; count: number }>>();
  for (const r of rows) {
    if (!r.date) continue;
    const day = byDate.get(r.date) ?? new Map();
    const cur = day.get(r.executive) ?? { total: 0, count: 0 };
    cur.total += r.amount;
    cur.count += 1;
    day.set(r.executive, cur);
    byDate.set(r.date, day);
  }
  return [...byDate.entries()]
    .map(([date, day]) => {
      const [executive, stat] = [...day.entries()].sort((a, b) => b[1].total - a[1].total)[0]!;
      return { date, executive, total: stat.total, count: stat.count };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

function lastFive(rows: Collection[]) {
  return [...rows]
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
    .slice(-5)
    .reverse();
}

function TopPerformers({
  rows,
  latestRows,
  excludedLoanIds,
}: {
  rows: Collection[];
  latestRows: Collection[];
  excludedLoanIds: Set<string>;
}) {
  const best = useMemo(() => topOverall(rows), [rows]);
  const daily = useMemo(() => dailyTop(rows), [rows]);
  const latest = useMemo(() => lastFive(latestRows), [latestRows]);

  return (
    <section className="mt-10 space-y-5">
      <h2 className="text-2xl font-bold">Top Performers</h2>

      {best ? (
        <div className="rounded-xl border bg-muted/40 p-5">
          <div className="flex items-start gap-3">
            <span className="text-3xl" aria-hidden>
              🏆
            </span>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Overall Top Performer</p>
              <p className="text-2xl font-bold">{best.executive}</p>
              <p className="mt-1 text-lg font-semibold">{formatAmount(best.total)}</p>
              <p className="text-base text-muted-foreground">{best.count} cases</p>
            </div>
          </div>
        </div>
      ) : (
        <p className="rounded-xl border p-6 text-center text-base">No collections yet.</p>
      )}

      <div>
        <h3 className="mb-2 text-xl font-semibold">Daily Top Performers</h3>
        {daily.length === 0 ? (
          <p className="rounded-xl border p-6 text-center text-base">No data yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-base">
              <thead className="bg-muted">
                <tr>
                  <th className="p-3 text-left font-semibold">Date</th>
                  <th className="p-3 text-left font-semibold">Top Performer</th>
                  <th className="p-3 text-right font-semibold">Amount</th>
                  <th className="p-3 text-right font-semibold">Cases</th>
                </tr>
              </thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={d.date} className="border-t">
                    <td className="p-3">{d.date}</td>
                    <td className="p-3">{d.executive}</td>
                    <td className="p-3 text-right font-semibold">{formatAmount(d.total)}</td>
                    <td className="p-3 text-right">{d.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-xl font-semibold">Last 5 Collection Entries</h3>
        {latest.length === 0 ? (
          <p className="rounded-xl border p-6 text-center text-base">No entries yet.</p>
        ) : (
          <div className="space-y-2">
            {latest.map((r, i) => (
              <div
                key={`${r.loanId ?? ""}-${r.createdAt ?? ""}-${i}`}
                className="flex items-center justify-between gap-3 rounded-xl border p-3"
              >
                <div>
                  <p className={`text-base font-semibold ${excludedLoanIds.has(String(r.loanId ?? "").trim().toUpperCase()) ? "text-orange-600" : ""}`}>{r.loanId || "—"}</p>
                  <p className="text-sm text-muted-foreground">
                    {r.executive} · {r.date}
                  </p>
                  {r.receiptLinks && r.receiptLinks.length > 0 ? (
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      {r.receiptLinks.map((l, n) => (
                        <a
                          key={l}
                          href={toDriveUrl(l)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-primary underline hover:text-primary/80"
                        >
                          {r.receiptLinks!.length === 1
                            ? "Google Drive Receipt ↗"
                            : `Google Drive Receipt #${n + 1} ↗`}
                        </a>
                      ))}
                                          </div>
                  ) : null}
                  {r.remark ? (
                    <p className="mt-1 text-sm text-muted-foreground">Remark: {r.remark}</p>
                  ) : null}
                  {r.amansRemarks ? (
                    <p className="mt-1 text-xs font-semibold text-amber-800 dark:text-amber-300">
                      Aman's Remarks: {r.amansRemarks}
                    </p>
                  ) : null}
                </div>
                <p className="text-base font-bold">{formatAmount(r.amount)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// Reports always filter on Payment Date (r.date), never the Entry Date.
function inRange(r: Collection, from?: string, to?: string) {
  if (from && r.date < from) return false;
  if (to && r.date > to) return false;
  return true;
}

function summarise(rows: Collection[], from?: string, to?: string): Row[] {
  const map = new Map<string, Row>();
  for (const r of rows) {
    if (!inRange(r, from, to)) continue;
    const cur = map.get(r.executive) ?? {
      executive: r.executive,
      total: 0,
      count: 0,
      normalCount: 0,
      previousCount: 0,
    };
    cur.total += r.amount;
    cur.count += 1;
    if (r.entryType === "Previous Paid File") cur.previousCount += 1;
    else cur.normalCount += 1;
    map.set(r.executive, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function previousStats(rows: Collection[], from?: string, to?: string) {
  const items = rows.filter((r) => r.entryType === "Previous Paid File" && inRange(r, from, to));
  return { count: items.length, total: items.reduce((s, r) => s + r.amount, 0) };
}

function PreviousCard({ count, total }: { count: number; total: number }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <p className="text-base font-semibold text-amber-900">Previous Paid File Entries</p>
      <div className="mt-2 flex gap-8">
        <div>
          <p className="text-sm text-amber-800">Count</p>
          <p className="text-2xl font-bold text-amber-900">{count}</p>
        </div>
        <div>
          <p className="text-sm text-amber-800">Total Amount</p>
          <p className="text-2xl font-bold text-amber-900">{formatAmount(total)}</p>
        </div>
      </div>
    </div>
  );
}

type HoldReportRow = {
  row: number; executive: string; loanId: string; status: string; city: string; principalOutstanding: number;
};

function HoldCasesReport({ rows, isLoading, error }: { rows: HoldReportRow[]; isLoading: boolean; error: boolean }) {
  const activeRows = rows.filter((r) => r.status.toLowerCase() === "active" && r.loanId);
  const totalPrincipal = activeRows.reduce((sum, r) => sum + r.principalOutstanding, 0);
  const cityGroups = useMemo(() => {
    const map = new Map<string, { count: number; principal: number }>();
    activeRows.forEach((r) => { const v = map.get(r.city) ?? { count: 0, principal: 0 }; v.count++; v.principal += r.principalOutstanding; map.set(r.city, v); });
    return [...map.entries()].map(([city, v]) => ({ city, ...v })).sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
  }, [activeRows]);
  const executiveGroups = useMemo(() => {
    const map = new Map<string, Map<string, { count: number; principal: number }>>();
    activeRows.forEach((r) => { const cities = map.get(r.executive) ?? new Map<string, { count: number; principal: number }>(); const v = cities.get(r.city) ?? { count: 0, principal: 0 }; v.count++; v.principal += r.principalOutstanding; cities.set(r.city, v); map.set(r.executive, cities); });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [activeRows]);
  if (isLoading) return <p className="rounded-xl border p-6 text-center">Loading Hold Cases report…</p>;
  if (error) return <p className="rounded-xl border p-6 text-center text-destructive">Could not load Hold Cases report. Please refresh and try again.</p>;
  return <section className="space-y-4">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard label="Active Hold Cases" value={String(activeRows.length)} />
      <StatCard label="Total Cities" value={String(cityGroups.length)} />
      <StatCard label="Total Executives" value={String(executiveGroups.length)} />
      <StatCard label="Principal Outstanding" value={formatAmount(totalPrincipal)} />
    </div>
    <Tabs defaultValue="executive" className="w-full">
      <TabsList className="grid h-auto w-full grid-cols-3">
        <TabsTrigger value="executive" className="whitespace-normal text-xs sm:text-sm">Executive-wise</TabsTrigger>
        <TabsTrigger value="city" className="whitespace-normal text-xs sm:text-sm">City-wise</TabsTrigger>
        <TabsTrigger value="overall" className="whitespace-normal text-xs sm:text-sm">Overall</TabsTrigger>
      </TabsList>
      <TabsContent value="executive" className="mt-4 space-y-3">
        {executiveGroups.length === 0 ? <p className="rounded-xl border p-6 text-center">No active Hold Cases found.</p> : executiveGroups.map(([executive, cities]) => {
          const items = [...cities.entries()].sort((a, b) => a[0].localeCompare(b[0]));
          const count = items.reduce((sum, [, v]) => sum + v.count, 0);
          const principal = items.reduce((sum, [, v]) => sum + v.principal, 0);
          return <div key={executive} className="overflow-hidden rounded-xl border">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/50 p-3"><h3 className="font-semibold">{executive}</h3><span className="text-sm text-muted-foreground">{count} cases · {formatAmount(principal)}</span></div>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-t text-muted-foreground"><th className="p-3 text-left">City</th><th className="p-3 text-right">Cases</th><th className="p-3 text-right">Principal Outstanding</th></tr></thead>
              <tbody>{items.map(([city, v]) => <tr key={city} className="border-t"><td className="p-3">{city}</td><td className="p-3 text-right tabular-nums">{v.count}</td><td className="p-3 text-right font-medium tabular-nums">{formatAmount(v.principal)}</td></tr>)}
              <tr className="border-t bg-muted/40 font-semibold"><td className="p-3">Executive Total</td><td className="p-3 text-right">{count}</td><td className="p-3 text-right">{formatAmount(principal)}</td></tr></tbody>
            </table></div>
          </div>;
        })}
      </TabsContent>
      <TabsContent value="city" className="mt-4"><div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm">
        <thead className="bg-muted"><tr><th className="p-3 text-left">City</th><th className="p-3 text-right">Cases</th><th className="p-3 text-right">Principal Outstanding</th></tr></thead>
        <tbody>{cityGroups.map((r) => <tr key={r.city} className="border-t"><td className="p-3">{r.city}</td><td className="p-3 text-right tabular-nums">{r.count}</td><td className="p-3 text-right font-medium tabular-nums">{formatAmount(r.principal)}</td></tr>)}
          {cityGroups.length === 0 && <tr><td colSpan={3} className="p-6 text-center">No active Hold Cases found.</td></tr>}
          <tr className="border-t-2 bg-muted/50 font-bold"><td className="p-3">TOTAL</td><td className="p-3 text-right">{activeRows.length}</td><td className="p-3 text-right">{formatAmount(totalPrincipal)}</td></tr></tbody>
      </table></div></TabsContent>
      <TabsContent value="overall" className="mt-4"><div className="overflow-hidden rounded-xl border"><table className="w-full text-sm"><tbody>
        <tr className="border-b"><td className="p-3">Active Hold Cases</td><td className="p-3 text-right font-semibold">{activeRows.length}</td></tr>
        <tr className="border-b"><td className="p-3">Total Cities</td><td className="p-3 text-right font-semibold">{cityGroups.length}</td></tr>
        <tr className="border-b"><td className="p-3">Total Executives</td><td className="p-3 text-right font-semibold">{executiveGroups.length}</td></tr>
        <tr className="bg-muted/50"><td className="p-3 font-bold">Total Principal Outstanding</td><td className="p-3 text-right text-base font-bold">{formatAmount(totalPrincipal)}</td></tr>
      </tbody></table></div></TabsContent>
    </Tabs>
    <p className="text-xs text-muted-foreground">Only Active Hold Cases are included. Removed and Collected cases are excluded. Figures refresh from the Hold_Cases Google Sheet.</p>
  </section>;
}


function PaidHoldAnalysis({ paidRows, holdRows, isLoading, error }: {
  paidRows: Collection[]; holdRows: HoldReportRow[]; isLoading: boolean; error: boolean;
}) {
  const cityStats = useMemo(() => {
    const map = new Map<string, { city: string; paidCount: number; paidPos: number; holdCount: number; holdPos: number }>();
    const get = (city: string) => {
      const name = city.trim() || "Unmapped";
      if (!map.has(name)) map.set(name, { city: name, paidCount: 0, paidPos: 0, holdCount: 0, holdPos: 0 });
      return map.get(name)!;
    };
    const paidSeen = new Set<string>();
    paidRows.forEach((r) => {
      const id = String(r.loanId || "").trim().toUpperCase() || "ROW-" + String(r.row ?? paidSeen.size);
      if (paidSeen.has(id)) return;
      paidSeen.add(id);
      const v = get(r.city || ""); v.paidCount++; v.paidPos += Number(r.pos) || 0;
    });
    const holdSeen = new Set<string>();
    holdRows.filter((r) => r.status.toLowerCase() === "active" && r.loanId).forEach((r) => {
      const id = r.loanId.trim().toUpperCase();
      if (holdSeen.has(id)) return;
      holdSeen.add(id);
      const v = get(r.city); v.holdCount++; v.holdPos += Number(r.principalOutstanding) || 0;
    });
    return [...map.values()].sort((a, b) => (b.paidCount + b.holdCount) - (a.paidCount + a.holdCount) || a.city.localeCompare(b.city));
  }, [paidRows, holdRows]);

  const executiveStats = useMemo(() => {
    const map = new Map<string, Map<string, { city: string; paidCount: number; paidPos: number; holdCount: number; holdPos: number }>>();
    const get = (executive: string, city: string) => {
      const name = executive.trim() || "Unassigned"; const cityName = city.trim() || "Unmapped";
      if (!map.has(name)) map.set(name, new Map());
      const cities = map.get(name)!;
      if (!cities.has(cityName)) cities.set(cityName, { city: cityName, paidCount: 0, paidPos: 0, holdCount: 0, holdPos: 0 });
      return cities.get(cityName)!;
    };
    const paidSeen = new Set<string>();
    paidRows.forEach((r) => {
      const id = String(r.loanId || "").trim().toUpperCase() || "ROW-" + String(r.row ?? paidSeen.size);
      const key = r.executive + "|" + id; if (paidSeen.has(key)) return; paidSeen.add(key);
      const v = get(r.executive, r.city || ""); v.paidCount++; v.paidPos += Number(r.pos) || 0;
    });
    const holdSeen = new Set<string>();
    holdRows.filter((r) => r.status.toLowerCase() === "active" && r.loanId).forEach((r) => {
      const key = r.executive + "|" + r.loanId.trim().toUpperCase(); if (holdSeen.has(key)) return; holdSeen.add(key);
      const v = get(r.executive, r.city); v.holdCount++; v.holdPos += Number(r.principalOutstanding) || 0;
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([executive, cities]) => ({ executive, cities: [...cities.values()].sort((a, b) => a.city.localeCompare(b.city)) }));
  }, [paidRows, holdRows]);

  const paidCount = cityStats.reduce((n, r) => n + r.paidCount, 0);
  const holdCount = cityStats.reduce((n, r) => n + r.holdCount, 0);
  const paidPos = cityStats.reduce((n, r) => n + r.paidPos, 0);
  const holdPos = cityStats.reduce((n, r) => n + r.holdPos, 0);
  const pieData = [{ name: "Paid", value: paidCount }, { name: "Hold", value: holdCount }].filter((r) => r.value > 0);
  if (isLoading) return <p className="rounded-xl border p-6 text-center">Loading Paid &amp; Hold analysis…</p>;
  if (error) return <p className="rounded-xl border p-6 text-center text-destructive">Could not load the combined report. Please refresh.</p>;
  return <section className="space-y-5">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard label="Paid Cases" value={String(paidCount)} /><StatCard label="Hold Cases" value={String(holdCount)} />
      <StatCard label="Combined Cases" value={String(paidCount + holdCount)} /><StatCard label="Combined POS" value={formatAmount(paidPos + holdPos)} />
    </div>
    <div className="grid grid-cols-2 gap-3"><StatCard label="Paid POS" value={formatAmount(paidPos)} /><StatCard label="Hold POS" value={formatAmount(holdPos)} /></div>
    <div className="rounded-xl border p-4"><h3 className="font-semibold">Paid vs Hold — Case Count Distribution</h3>
      {pieData.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No Paid or Hold cases found.</p> : <div className="h-72"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="48%" outerRadius={92} label={({ name, value }) => String(name) + ": " + String(value)}>{pieData.map((entry) => <Cell key={entry.name} fill={entry.name === "Paid" ? "#16a34a" : "#d97706"} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div>}
    </div>
    <Tabs defaultValue="city" className="w-full"><TabsList className="grid h-auto w-full grid-cols-2"><TabsTrigger value="city">City-wise</TabsTrigger><TabsTrigger value="executive">Executive-wise</TabsTrigger></TabsList>
      <TabsContent value="city" className="mt-3"><div className="overflow-x-auto rounded-xl border"><table className="w-full text-xs sm:text-sm"><thead className="bg-muted"><tr><th className="p-2 text-left">City</th><th className="p-2 text-right">Paid</th><th className="p-2 text-right">Paid POS</th><th className="p-2 text-right">Hold</th><th className="p-2 text-right">Hold POS</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Total POS</th></tr></thead><tbody>
        {cityStats.map((r) => <tr key={r.city} className="border-t"><td className="p-2 font-medium">{r.city}</td><td className="p-2 text-right">{r.paidCount}</td><td className="p-2 text-right">{formatAmount(r.paidPos)}</td><td className="p-2 text-right">{r.holdCount}</td><td className="p-2 text-right">{formatAmount(r.holdPos)}</td><td className="p-2 text-right font-semibold">{r.paidCount + r.holdCount}</td><td className="p-2 text-right font-semibold">{formatAmount(r.paidPos + r.holdPos)}</td></tr>)}
        {cityStats.length === 0 && <tr><td colSpan={7} className="p-6 text-center">No data found.</td></tr>}
        <tr className="border-t-2 bg-muted/50 font-bold"><td className="p-2">TOTAL</td><td className="p-2 text-right">{paidCount}</td><td className="p-2 text-right">{formatAmount(paidPos)}</td><td className="p-2 text-right">{holdCount}</td><td className="p-2 text-right">{formatAmount(holdPos)}</td><td className="p-2 text-right">{paidCount + holdCount}</td><td className="p-2 text-right">{formatAmount(paidPos + holdPos)}</td></tr>
      </tbody></table></div></TabsContent>
      <TabsContent value="executive" className="mt-3 space-y-3">{executiveStats.map(({ executive, cities }) => {
        const pc = cities.reduce((n, r) => n + r.paidCount, 0); const hc = cities.reduce((n, r) => n + r.holdCount, 0);
        const pp = cities.reduce((n, r) => n + r.paidPos, 0); const hp = cities.reduce((n, r) => n + r.holdPos, 0);
        return <div key={executive} className="overflow-hidden rounded-xl border"><div className="flex flex-wrap items-center justify-between gap-2 bg-muted/50 p-3"><h3 className="font-semibold">{executive}</h3><span className="text-sm font-semibold">Paid {pc} · Hold {hc} · Total {pc + hc}</span></div><div className="overflow-x-auto"><table className="w-full text-xs sm:text-sm"><thead><tr className="border-t text-muted-foreground"><th className="p-2 text-left">City</th><th className="p-2 text-right">Paid</th><th className="p-2 text-right">Paid POS</th><th className="p-2 text-right">Hold</th><th className="p-2 text-right">Hold POS</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Total POS</th></tr></thead><tbody>
          {cities.map((r) => <tr key={r.city} className="border-t"><td className="p-2">{r.city}</td><td className="p-2 text-right">{r.paidCount}</td><td className="p-2 text-right">{formatAmount(r.paidPos)}</td><td className="p-2 text-right">{r.holdCount}</td><td className="p-2 text-right">{formatAmount(r.holdPos)}</td><td className="p-2 text-right font-semibold">{r.paidCount + r.holdCount}</td><td className="p-2 text-right font-semibold">{formatAmount(r.paidPos + r.holdPos)}</td></tr>)}
          <tr className="border-t bg-muted/40 font-bold"><td className="p-2">Executive Total</td><td className="p-2 text-right">{pc}</td><td className="p-2 text-right">{formatAmount(pp)}</td><td className="p-2 text-right">{hc}</td><td className="p-2 text-right">{formatAmount(hp)}</td><td className="p-2 text-right">{pc + hc}</td><td className="p-2 text-right">{formatAmount(pp + hp)}</td></tr>
        </tbody></table></div></div>;
      })}</TabsContent>
    </Tabs>
    <p className="text-xs text-muted-foreground">Paid cases count distinct Loan IDs in the selected month, excluding Already Paid and excluded loans. Hold cases count distinct active Loan IDs. POS is summed once per Loan ID; the pie chart compares Paid and Hold case counts.</p>
  </section>;
}

function ReportPage() {
  const fetchCollections = useServerFn(getCollections);
  const fetchActiveHoldCases = useServerFn(listActiveHoldCasesForReport);
  const fetchExcludedLoans = useServerFn(getExcludedLoanNumbers);
  const { data: excludedLoanRecords = [] } = useQuery({
    queryKey: ["excluded-loan-numbers"],
    queryFn: () => fetchExcludedLoans(),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const excludedLoanIds = useMemo(
    () => new Set(excludedLoanRecords.filter((r) => r.status.toLowerCase() === "active").map((r) => r.loanNumber.trim().toUpperCase())),
    [excludedLoanRecords],
  );
  const highlightAlreadyPaid = useServerFn(highlightAlreadyPaidInSheet);
  const [highlighting, setHighlighting] = useState(false);

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
    refetchOnWindowFocus: true,
  });

  const { data: holdCaseRows = [], isLoading: holdCasesLoading, error: holdCasesError, refetch: refetchHoldCases } = useQuery({
    queryKey: ["active-hold-cases-report"],
    queryFn: async () => {
      const result = await fetchActiveHoldCases();
      if (!Array.isArray(result)) throw new Error("Unable to load Hold Cases");
      return result as HoldReportRow[];
    },
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());

  const [dateBucket, setDateBucket] = useState(ALL_BUCKETS);
  const [overallBucket, setOverallBucket] = useState(ALL_BUCKETS);

  const rawRows = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const [category, setCategory] = useCategoryFilter();
  const dateCategory = category;
  const overallCategory = category;
  const categories = useMemo(
    () =>
      [...new Set(rawRows.map((r) => r.allocationCategory).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [rawRows],
  );

  // Already Paid and explicitly excluded loan numbers are omitted from performance reports.
  const allRows = useMemo(
    () => rawRows.filter((r) => !r.alreadyPaid && !excludedLoanIds.has(String(r.loanId ?? "").trim().toUpperCase())),
    [rawRows, excludedLoanIds],
  );
  const [month, setMonth] = useState(currentMonthKey());
  const months = useMemo(() => monthOptions(rawRows.map((r) => r.date)), [rawRows]);

  // Already Paid row numbers for highlighting in Google Sheet in Red
  const alreadyPaidCount = useMemo(() => rawRows.filter((r) => r.alreadyPaid).length, [rawRows]);
  const alreadyPaidRowNumbers = useMemo(
    () =>
      rawRows
        .filter((r) => r.alreadyPaid)
        .map((r) => r.row)
        .filter(Boolean) as number[],
    [rawRows],
  );

  // Auto-sync red highlight in Google Sheets when already paid rows are detected
  const syncedRef = useRef(false);
  useEffect(() => {
    if (!syncedRef.current && alreadyPaidRowNumbers.length > 0) {
      syncedRef.current = true;
      highlightAlreadyPaid({ data: { rows: alreadyPaidRowNumbers } }).catch(() => {});
    }
  }, [alreadyPaidRowNumbers, highlightAlreadyPaid]);

  const syncHighlight = async () => {
    if (alreadyPaidRowNumbers.length === 0) {
      toast.info("No Already Paid cases found to highlight in Google Sheet.");
      return;
    }
    setHighlighting(true);
    try {
      const res = await highlightAlreadyPaid({ data: { rows: alreadyPaidRowNumbers } });
      toast.success(
        `${(res as { count?: number })?.count ?? alreadyPaidRowNumbers.length} Already Paid cases highlighted in Red in Google Sheet.`,
      );
    } catch {
      toast.error("Could not highlight Already Paid rows in Google Sheet.");
    } finally {
      setHighlighting(false);
    }
  };

  // Every report below works off this month-scoped dataset only.
  const rows = useMemo(() => allRows.filter((r) => monthKey(r.date) === month), [allRows, month]);
  const catOk = (c: string | undefined, f: string) => f === ALL_CATEGORIES || c === f;
  const dateRows = useMemo(
    () =>
      rows.filter(
        (r) => bucketMatches(r.bucket, dateBucket) && catOk(r.allocationCategory, dateCategory),
      ),
    [rows, dateBucket, dateCategory],
  );
  const overallRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          bucketMatches(r.bucket, overallBucket) && catOk(r.allocationCategory, overallCategory),
      ),
    [rows, overallBucket, overallCategory],
  );
  const dateScoped = useMemo(
    () => dateRows.filter((r) => inRange(r, from, to)),
    [dateRows, from, to],
  );
  const dateWise = useMemo(() => summarise(dateRows, from, to), [dateRows, from, to]);
  const overall = useMemo(() => summarise(overallRows), [overallRows]);
  const prevDateWise = useMemo(() => previousStats(dateRows, from, to), [dateRows, from, to]);
  const prevOverall = useMemo(() => previousStats(overallRows), [overallRows]);

  // Export rows INCLUDE both normal and Already Paid cases, with "Already Paid" column at the end.
  const dateScopedExportRows = useMemo(
    () =>
      rawRows.filter(
        (r) =>
          !excludedLoanIds.has(String(r.loanId ?? "").trim().toUpperCase()) &&
          monthKey(r.date) === month &&
          bucketMatches(r.bucket, dateBucket) &&
          catOk(r.allocationCategory, dateCategory) &&
          inRange(r, from, to),
      ),
    [rawRows, excludedLoanIds, month, dateBucket, dateCategory, from, to],
  );

  const overallExportRows = useMemo(
    () =>
      rawRows.filter(
        (r) =>
          !excludedLoanIds.has(String(r.loanId ?? "").trim().toUpperCase()) &&
          monthKey(r.date) === month &&
          bucketMatches(r.bucket, overallBucket) &&
          catOk(r.allocationCategory, overallCategory),
      ),
    [rawRows, excludedLoanIds, month, overallBucket, overallCategory],
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6">
      <NotificationPanel className="mb-4" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Collection Report</h1>
          <p className="mt-1 text-base text-muted-foreground">
            Executive-wise totals and case counts.
          </p>
        </div>
        <Button
          variant="outline"
          className="h-12 text-base"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <div className="mt-4">
        <MonthSelect value={month} onChange={setMonth} options={months} />
      </div>
      <div className="mt-3">
        <CategoryFilter value={category} onChange={setCategory} options={categories} />
      </div>
      {alreadyPaidCount > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50/70 p-3 text-sm text-red-900">
          <div className="flex items-center gap-2">
            <span className="inline-block size-2.5 rounded-full bg-red-600 animate-pulse" />
            <span>
              <strong>{alreadyPaidCount} Already Paid cases</strong> are highlighted in RED in
              Google Sheet & included in CSV export with "Already Paid" column.
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 border-red-300 bg-white text-xs text-red-800 hover:bg-red-50"
            disabled={highlighting}
            onClick={syncHighlight}
          >
            {highlighting ? "Highlighting..." : "Re-sync Red in Google Sheet"}
          </Button>
        </div>
      )}

      {isLoading && <p className="mt-6 text-base">Loading report...</p>}
      {error && (
        <p className="mt-6 text-base text-destructive">
          Could not load report. Please refresh and try again.
        </p>
      )}

      <Tabs defaultValue="datewise" className="mt-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="datewise" className="text-base">
            Date-wise
          </TabsTrigger>
          <TabsTrigger value="overall" className="text-base">
            Overall
          </TabsTrigger>
          <TabsTrigger value="holdcases" className="text-base">Hold Cases</TabsTrigger><TabsTrigger value="paid-hold" className="text-base">Paid &amp; Hold</TabsTrigger>
        </TabsList>

        <TabsContent value="datewise" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-base" htmlFor="from">
                From
              </Label>
              <Input
                id="from"
                type="date"
                className="h-12 text-base"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-base" htmlFor="to">
                To
              </Label>
              <Input
                id="to"
                type="date"
                className="h-12 text-base"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
          <BucketFilter value={dateBucket} onChange={setDateBucket} />
          <LoanStatsCards rows={dateScoped} />
          <PreviousCard count={prevDateWise.count} total={prevDateWise.total} />
          <ReportBlock rows={dateWise} />
          <ExportButton
            rows={dateScopedExportRows}
            fullRows={rawRows}
            label={`${from}_to_${to}`}
            onExportSync={syncHighlight}
          />
        </TabsContent>

        <TabsContent value="overall" className="mt-4 space-y-4">
          <BucketFilter value={overallBucket} onChange={setOverallBucket} />
          <LoanStatsCards rows={overallRows} />
          <PreviousCard count={prevOverall.count} total={prevOverall.total} />
          <ReportBlock rows={overall} />
          <ExportButton
            rows={overallExportRows}
            fullRows={rawRows}
            label={month}
            onExportSync={syncHighlight}
          />
        </TabsContent>
        <TabsContent value="holdcases" className="mt-4 space-y-4">
          <div className="flex justify-end"><Button variant="outline" onClick={() => refetchHoldCases()} disabled={holdCasesLoading}>Refresh Hold Cases</Button></div>
          <HoldCasesReport rows={holdCaseRows} isLoading={holdCasesLoading} error={Boolean(holdCasesError)} />
        </TabsContent>
        <TabsContent value="paid-hold" className="mt-4 space-y-4">
          <div className="flex justify-end"><Button variant="outline" onClick={() => { void refetch(); void refetchHoldCases(); }} disabled={isFetching || holdCasesLoading}>Refresh Paid &amp; Hold</Button></div>
          <PaidHoldAnalysis paidRows={rows} holdRows={holdCaseRows} isLoading={isLoading || holdCasesLoading} error={Boolean(error || holdCasesError)} />
        </TabsContent>
      </Tabs>

      <TopPerformers
        rows={rows.filter((r) => catOk(r.allocationCategory, category))}
        latestRows={rawRows}
        excludedLoanIds={excludedLoanIds}
      />
    </main>
  );
}

function ReportBlock({ rows }: { rows: Row[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const total = rows.reduce((s, r) => s + r.total, 0);
  const cases = rows.reduce((s, r) => s + r.count, 0);

  if (rows.length === 0) {
    return <p className="rounded-xl border p-6 text-center text-base">No collections found.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-xs sm:text-base">
          <thead className="bg-muted">
            <tr>
              <th className="px-2 py-2 text-left font-semibold sm:p-3">Executive</th>
              <th className="px-2 py-2 text-right font-semibold sm:p-3">Collection</th>
              <th className="px-2 py-2 text-right font-semibold sm:p-3">Cases</th>
              <th className="px-2 py-2 text-left font-semibold sm:p-3">Entry Type</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.executive} className="border-t">
                <td className="px-2 py-2 sm:p-3">{r.executive}</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums sm:p-3">
                  {formatAmount(r.total)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums sm:p-3">{r.count}</td>
                <td className="px-2 py-2 sm:p-3">
                  <div className="flex flex-wrap gap-1">
                    {r.normalCount > 0 && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                        Normal {r.normalCount}
                      </span>
                    )}
                    {r.previousCount > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                        Previous Paid File {r.previousCount}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            <tr className="border-t-2 bg-muted/50 font-bold">
              <td className="px-2 py-2 sm:p-3">TOTAL</td>
              <td className="px-2 py-2 text-right tabular-nums sm:p-3">{formatAmount(total)}</td>
              <td className="px-2 py-2 text-right tabular-nums sm:p-3">{cases}</td>
              <td className="px-2 py-2 sm:p-3" />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="h-72 rounded-xl border p-3">
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="executive"
                tick={{ fontSize: 12 }}
                interval={0}
                angle={-25}
                dy={10}
                height={50}
              />
              <YAxis tick={{ fontSize: 12 }} width={60} />
              <Tooltip formatter={(v: number) => formatAmount(Number(v))} />
              <Bar dataKey="total" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading chart...
          </div>
        )}
      </div>
    </div>
  );
}
