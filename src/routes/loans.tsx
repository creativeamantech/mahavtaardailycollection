import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getCollections } from "@/lib/mahavtaar.functions";
import { EXECUTIVES, formatAmount, todayISO } from "@/lib/executives";
import {
  summariseLoans,
  shortEmiRows,
  cityExecutiveMatrix,
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
import { MonthSelect } from "@/components/MonthSelect";
import { currentMonthKey, monthKey, monthOptions } from "@/lib/months";

export const Route = createFileRoute("/loans")({
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
  if (status.startsWith("POS Paid") || status === "Foreclosure Paid") return "bg-sky-100 text-sky-800";
  if (status === "EMI Short Amount") return "bg-amber-100 text-amber-900";
  return "bg-muted text-muted-foreground";
}

function money(v: number | null) {
  return v === null ? "" : formatAmount(v);
}

function LoansPage() {
  const fetchCollections = useServerFn(getCollections);
  // One batch read of the whole dataset — search, EMI maths and every report
  // below reuse this single result. No per-loan or per-filter API calls.
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["collections"],
    queryFn: () => fetchCollections(),
  });

  const allRows = useMemo(() => data ?? [], [data]);
  const [month, setMonth] = useState(currentMonthKey());
  const months = useMemo(() => monthOptions(allRows.map((r) => r.date)), [allRows]);
  // Month-scoped dataset — searches and every report below reuse it.
  const rows = useMemo(
    () => allRows.filter((r) => monthKey(r.date) === month),
    [allRows, month],
  );
  const loans = useMemo(() => summariseLoans(rows), [rows]);

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return loans.filter((l) => l.loanId.toLowerCase().includes(q));
  }, [loans, query]);

  const [showShort, setShowShort] = useState(false);
  const shorts = useMemo(() => shortEmiRows(loans), [loans]);

  // Date-wise city report
  const [date, setDate] = useState(todayISO());
  const [dateBucket, setDateBucket] = useState(ALL);
  const buckets = useMemo(
    () => [...new Set(loans.map((l) => l.bucket))].filter(Boolean).sort(),
    [loans],
  );
  const dateMatrix = useMemo(() => {
    const scoped = rows.filter(
      (r) => r.date === date && (dateBucket === ALL || (r.bucket ?? "") === dateBucket),
    );
    return cityExecutiveMatrix(summariseLoans(scoped), EXECUTIVES);
  }, [rows, date, dateBucket]);

  // Overall bucket -> city report (all dates)
  const overall = useMemo(
    () =>
      buckets.map((b) => ({
        bucket: b,
        cities: cityExecutiveMatrix(
          loans.filter((l) => l.bucket === b),
          EXECUTIVES,
        ),
      })),
    [loans, buckets],
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Loan Details</h1>
          <p className="mt-1 text-base text-muted-foreground">
            Search a Loan ID to verify its payment and EMI status.
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
        <div className="min-w-[200px] flex-1 space-y-2">
          <Label className="text-base" htmlFor="loan-search">
            Loan ID / Loan Number
          </Label>
          <Input
            id="loan-search"
            className="h-12 text-base"
            placeholder="Enter Loan ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button type="submit" className="h-12 text-base">
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
            results.map((l) => <LoanCard key={l.loanId} loan={l} />)
          )}
        </div>
      )}

      <section className="mt-10">
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button
            variant="outline"
            className="h-12 text-base"
            onClick={() => setShowShort((s) => !s)}
          >
            {showShort ? "Hide Short EMIs" : "View Short EMIs"}
          </Button>
        </div>

        {showShort && (
          <div className="mt-3 overflow-x-auto rounded-xl border">
            <table className="w-full text-base">
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
                  shorts.map((s) => (
                    <tr key={s.loanId} className="border-t">
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
        <h2 className="text-2xl font-bold tracking-tight">Date-wise City & Bucket Report</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-base" htmlFor="report-date">
              Date
            </Label>
            <Input
              id="report-date"
              type="date"
              className="h-12 text-base"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-base">Bucket</Label>
            <Select value={dateBucket} onValueChange={setDateBucket}>
              <SelectTrigger className="h-12 text-base">
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

        {dateMatrix.length === 0 ? (
          <p className="mt-3 rounded-xl border p-6 text-center text-base">
            No paid cases for this date.
          </p>
        ) : (
          dateMatrix.map((c) => <CityTable key={c.city} title={c.city} matrix={c} />)
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-2xl font-bold tracking-tight">Overall Bucket &amp; City Report</h2>
        <p className="mt-1 text-base text-muted-foreground">All available dates.</p>
        {overall.length === 0 ? (
          <p className="mt-3 rounded-xl border p-6 text-center text-base">No data yet.</p>
        ) : (
          overall.map((b) =>
            b.cities.map((c) => (
              <CityTable key={`${b.bucket}-${c.city}`} title={`${b.bucket} — ${c.city}`} matrix={c} />
            )),
          )
        )}
      </section>
    </main>
  );
}

function CityTable({
  title,
  matrix,
}: {
  title: string;
  matrix: { cases: Record<string, number>; pos: Record<string, number> };
}) {
  return (
    <div className="mt-4">
      <p className="text-lg font-bold">{title}</p>
      <div className="mt-2 overflow-x-auto rounded-xl border">
        <table className="w-full text-base">
          <thead className="bg-muted/50">
            <tr>
              <Th>Metric</Th>
              {EXECUTIVES.map((e) => (
                <Th key={e} right>
                  {e}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <Td>Paid Cases</Td>
              {EXECUTIVES.map((e) => (
                <Td key={e} right>
                  {matrix.cases[e] ?? 0}
                </Td>
              ))}
            </tr>
            <tr className="border-t">
              <Td>Paid POS</Td>
              {EXECUTIVES.map((e) => (
                <Td key={e} right>
                  {formatAmount(matrix.pos[e] ?? 0)}
                </Td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`whitespace-nowrap p-3 text-sm font-semibold ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <td className={`whitespace-nowrap p-3 ${right ? "text-right" : "text-left"}`}>{children}</td>
  );
}

function LoanCard({ loan }: { loan: LoanSummary }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-lg font-bold">{loan.loanId}</p>
          <p className="text-sm text-muted-foreground">{loan.executive}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${statusClass(loan.status)}`}>
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
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>{children}</span>;
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{k}</dt>
      <dd className="font-semibold">{v || "—"}</dd>
    </div>
  );
}
