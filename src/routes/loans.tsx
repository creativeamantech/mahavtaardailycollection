import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getCollections } from "@/lib/mahavtaar.functions";
import { formatAmount, todayISO } from "@/lib/executives";
import { summariseLoans, toCsv, type LoanSummary } from "@/lib/loans";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/loans")({
  head: () => ({
    meta: [
      { title: "Loan Details & EMI Status — Mahavtaar Daily Collection" },
      {
        name: "description",
        content:
          "Bucket-wise EMI requirement, total paid per loan, short amount and payment status with executive, bucket and city filters.",
      },
      { property: "og:title", content: "Loan Details & EMI Status" },
      {
        property: "og:description",
        content: "Bucket-wise EMI calculation, payment status and CSV export per loan.",
      },
    ],
  }),
  component: LoansPage,
});

const ALL = "__all__";

function statusClass(status: string) {
  if (status === "Settlement Paid") return "bg-violet-100 text-violet-800";
  if (status === "EMI Paid") return "bg-emerald-100 text-emerald-800";
  if (status === "POS Paid" || status === "Foreclosure Paid") return "bg-sky-100 text-sky-800";
  if (status === "EMI Short Amount") return "bg-amber-100 text-amber-900";
  return "bg-muted text-muted-foreground";
}

function LoansPage() {
  const fetchCollections = useServerFn(getCollections);
  // One batch read of the whole dataset — all filtering, grouping and CSV work
  // happens on that single result, never per loan / row / filter.
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["collections"],
    queryFn: () => fetchCollections(),
  });

  const [executive, setExecutive] = useState(ALL);
  const [bucket, setBucket] = useState(ALL);
  const [city, setCity] = useState(ALL);

  const loans = useMemo(() => summariseLoans(data ?? []), [data]);

  const executives = useMemo(
    () => [...new Set(loans.flatMap((l) => l.executives))].filter(Boolean).sort(),
    [loans],
  );
  const buckets = useMemo(
    () => [...new Set(loans.map((l) => l.bucket))].filter(Boolean).sort(),
    [loans],
  );
  const cities = useMemo(
    () => [...new Set(loans.map((l) => l.city))].filter(Boolean).sort(),
    [loans],
  );

  const filtered = useMemo(
    () =>
      loans.filter(
        (l) =>
          (executive === ALL || l.executives.includes(executive)) &&
          (bucket === ALL || l.bucket === bucket) &&
          (city === ALL || l.city === city),
      ),
    [loans, executive, bucket, city],
  );

  const totals = useMemo(
    () => ({
      loans: filtered.length,
      paid: filtered.reduce((s, l) => s + l.totalPaid, 0),
      short: filtered.reduce((s, l) => s + (l.shortAmount ?? 0), 0),
    }),
    [filtered],
  );

  function downloadCsv() {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `loan-details-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Loan Details</h1>
          <p className="mt-1 text-base text-muted-foreground">
            Bucket-wise EMI requirement and payment status per Loan ID.
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

      {isLoading && <p className="mt-6 text-base">Loading loan details...</p>}
      {error && (
        <p className="mt-6 text-base text-destructive">
          Could not load loan details. Tap Refresh to try again.
        </p>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <FilterSelect label="Executive" allLabel="All Executives" value={executive} onChange={setExecutive} options={executives} />
        <FilterSelect label="Bucket" allLabel="All Buckets" value={bucket} onChange={setBucket} options={buckets} />
        <FilterSelect label="City" allLabel="All Cities" value={city} onChange={setCity} options={cities} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Loans" value={String(totals.loans)} />
        <Stat label="Total Paid" value={formatAmount(totals.paid)} />
        <Stat label="Total Short" value={formatAmount(totals.short)} />
      </div>

      <div className="mt-4 flex justify-end">
        <Button className="h-12 text-base" onClick={downloadCsv} disabled={filtered.length === 0}>
          Download CSV
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        {filtered.length === 0 && !isLoading ? (
          <p className="rounded-xl border p-6 text-center text-base">No loans found.</p>
        ) : (
          filtered.map((l) => <LoanCard key={l.loanId} loan={l} />)
        )}
      </div>
    </main>
  );
}

function FilterSelect({
  label,
  allLabel,
  value,
  onChange,
  options,
}: {
  label: string;
  allLabel: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="space-y-2">
      <Label className="text-base">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-12 text-base">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL} className="text-base">
            {allLabel}
          </SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o} className="text-base">
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

function money(v: number | null) {
  return v === null ? "" : formatAmount(v);
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
        <Field k="Applicable EMI Count" v={loan.applicableEmiCount === null ? "" : `${loan.applicableEmiCount} EMI`} />
        <Field k="EMI Amount" v={money(loan.emiAmount)} />
        <Field k="Total EMI Required" v={money(loan.totalEmiRequired)} />
        <Field k="Total Amount Paid" v={`${formatAmount(loan.totalPaid)} (${loan.payments})`} />
        <Field k="Short Amount" v={money(loan.shortAmount)} />
        <Field k="Principal Outstanding" v={money(loan.pos)} />
        <Field k="Approx. Foreclosure" v={money(loan.foreclosure)} />
        <Field k="Last Payment" v={loan.lastDate} />
      </dl>

      <div className="mt-3 flex flex-wrap gap-1">
        {loan.settlement && <Tag className="bg-violet-100 text-violet-800">Settlement Paid</Tag>}
        {loan.emiPaid && <Tag className="bg-emerald-100 text-emerald-800">EMI Paid</Tag>}
        {loan.posPaid && <Tag className="bg-sky-100 text-sky-800">POS Paid</Tag>}
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
