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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  amount: number;
  date: string;
  entryType?: string;
};

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
  const { data, isLoading, error } = useQuery({
    queryKey: ["collections"],
    queryFn: () => fetchCollections(),
    refetchOnWindowFocus: true,
  });

  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());

  const rows = data ?? [];
  const dateWise = useMemo(() => summarise(rows, from, to), [rows, from, to]);
  const overall = useMemo(() => summarise(rows), [rows]);
  const prevDateWise = useMemo(() => previousStats(rows, from, to), [rows, from, to]);
  const prevOverall = useMemo(() => previousStats(rows), [rows]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6">
      <h1 className="text-3xl font-bold tracking-tight">Collection Report</h1>
      <p className="mt-1 text-base text-muted-foreground">Executive-wise totals and case counts.</p>

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
          <PreviousCard count={prevDateWise.count} total={prevDateWise.total} />
          <ReportBlock rows={dateWise} />
        </TabsContent>

        <TabsContent value="overall" className="mt-4 space-y-4">
          <PreviousCard count={prevOverall.count} total={prevOverall.total} />
          <ReportBlock rows={overall} />
        </TabsContent>
      </Tabs>
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
        <table className="w-full text-base">
          <thead className="bg-muted">
            <tr>
              <th className="p-3 text-left font-semibold">Executive Name</th>
              <th className="p-3 text-right font-semibold">Total Collection</th>
              <th className="p-3 text-right font-semibold">Cases</th>
              <th className="p-3 text-left font-semibold">Entry Type</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.executive} className="border-t">
                <td className="p-3">{r.executive}</td>
                <td className="p-3 text-right font-semibold">{formatAmount(r.total)}</td>
                <td className="p-3 text-right">{r.count}</td>
                <td className="p-3">
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
            <tr className="border-t bg-muted/50 font-semibold">
              <td className="p-3">Total</td>
              <td className="p-3 text-right">{formatAmount(total)}</td>
              <td className="p-3 text-right">{cases}</td>
              <td className="p-3" />
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
