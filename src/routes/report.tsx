import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getCollections } from "@/lib/mahavtaar.functions";
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

const ALL_BUCKETS = "__all__";

export const Route = createFileRoute("/report")({
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
  entryType?: string;
  createdAt?: string;
  settlement?: boolean;
  bucket?: string;
  city?: string;
  emiAmount?: number | null;
  pos?: number | null;
  foreclosure?: number | null;
  receiptLinks?: string[];
  remark?: string;
};

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

function TopPerformers({ rows }: { rows: Collection[] }) {
  const best = useMemo(() => topOverall(rows), [rows]);
  const daily = useMemo(() => dailyTop(rows), [rows]);
  const latest = useMemo(() => lastFive(rows), [rows]);

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
                  <p className="text-base font-semibold">{r.loanId || "—"}</p>
                  <p className="text-sm text-muted-foreground">
                    {r.executive} · {r.date}
                  </p>
                  {r.receiptLinks && r.receiptLinks.length > 0 ? (
                    <p className="mt-1 flex flex-wrap gap-x-2 text-sm">
                      {r.receiptLinks.map((l, n) => (
                        <a
                          key={l}
                          href={l}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline"
                        >
                          {r.receiptLinks!.length === 1 ? "View Receipt" : `Receipt ${n + 1}`}
                        </a>
                      ))}
                    </p>
                  ) : r.remark ? (
                    <p className="mt-1 text-sm text-muted-foreground">Remark: {r.remark}</p>
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
    const cur =
      map.get(r.executive) ??
      { executive: r.executive, total: 0, count: 0, normalCount: 0, previousCount: 0 };
    cur.total += r.amount;
    cur.count += 1;
    if (r.entryType === "Previous Paid File") cur.previousCount += 1;
    else cur.normalCount += 1;
    map.set(r.executive, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function previousStats(rows: Collection[], from?: string, to?: string) {
  const items = rows.filter(
    (r) => r.entryType === "Previous Paid File" && inRange(r, from, to),
  );
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

function ReportPage() {
  const fetchCollections = useServerFn(getCollections);
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["collections"],
    queryFn: () => fetchCollections(),
    refetchOnWindowFocus: true,
  });

  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());

  const [dateBucket, setDateBucket] = useState(ALL_BUCKETS);
  const [overallBucket, setOverallBucket] = useState(ALL_BUCKETS);

  const allRows = data ?? [];
  const [month, setMonth] = useState(currentMonthKey());
  const months = useMemo(() => monthOptions(allRows.map((r) => r.date)), [allRows]);
  // Every report below works off this month-scoped dataset only.
  const rows = useMemo(
    () => allRows.filter((r) => monthKey(r.date) === month),
    [allRows, month],
  );
  const dateRows = useMemo(
    () => rows.filter((r) => bucketMatches(r.bucket, dateBucket)),
    [rows, dateBucket],
  );
  const overallRows = useMemo(
    () => rows.filter((r) => bucketMatches(r.bucket, overallBucket)),
    [rows, overallBucket],
  );
  const dateScoped = useMemo(
    () => dateRows.filter((r) => inRange(r, from, to)),
    [dateRows, from, to],
  );
  const dateWise = useMemo(() => summarise(dateRows, from, to), [dateRows, from, to]);
  const overall = useMemo(() => summarise(overallRows), [overallRows]);
  const prevDateWise = useMemo(() => previousStats(dateRows, from, to), [dateRows, from, to]);
  const prevOverall = useMemo(() => previousStats(overallRows), [overallRows]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6">
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


      {isLoading && <p className="mt-6 text-base">Loading report...</p>}
      {error && (
        <p className="mt-6 text-base text-destructive">
          Could not load report. Please refresh and try again.
        </p>
      )}

      <Tabs defaultValue="datewise" className="mt-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="datewise" className="text-base">
            Date-wise
          </TabsTrigger>
          <TabsTrigger value="overall" className="text-base">
            Overall
          </TabsTrigger>
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
        </TabsContent>

        <TabsContent value="overall" className="mt-4 space-y-4">
          <BucketFilter value={overallBucket} onChange={setOverallBucket} />
          <LoanStatsCards rows={overallRows} />
          <PreviousCard count={prevOverall.count} total={prevOverall.total} />
          <ReportBlock rows={overall} />
        </TabsContent>
      </Tabs>

      <TopPerformers rows={rows} />

    </main>
  );
}

function ReportBlock({ rows }: { rows: Row[] }) {
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
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="executive" tick={{ fontSize: 12 }} interval={0} angle={-25} dy={10} height={50} />
            <YAxis tick={{ fontSize: 12 }} width={60} />
            <Tooltip formatter={(v: number) => formatAmount(Number(v))} />
            <Bar dataKey="total" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
