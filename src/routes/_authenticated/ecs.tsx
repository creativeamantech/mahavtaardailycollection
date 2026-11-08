import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { EXECUTIVES, formatAmount, nowTime, todayISO } from "@/lib/executives";
import { getEcsEntries, saveEcsEntry, updateEcsEntry } from "@/lib/ecs.functions";
import { getCurrentSession } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/ecs")({
  head: () => ({
    meta: [
      { title: "ECS / Special Entry — Mahavtaar Daily Collection" },
      {
        name: "description",
        content:
          "Record information-only ECS and Special payments with status tracking. Never counted in collection totals.",
      },
      { property: "og:title", content: "ECS / Special Entry — Mahavtaar Daily Collection" },
      {
        property: "og:description",
        content:
          "Information-only ECS and Special payment register with remarks and status updates.",
      },
    ],
  }),
  component: EcsPage,
});

type Slip = {
  executive: string;
  loanId: string;
  amount: number;
  paymentType: "ECS" | "Special";
  paymentDate: string;
  entryDate: string;
  entryTime: string;
  remark: string;
};

const STATUSES = ["Confirmed", "Bounced", "Cleared", "Cancelled"] as const;

function EcsPage() {
  return (
    <main className="mx-auto w-full max-w-[1440px] px-3 pb-12 pt-4 sm:px-5 sm:pt-6 lg:px-8">
      <div className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-8 w-1.5 rounded-full bg-amber-400" />
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                ECS / Special
              </h1>
            </div>
            <p className="mt-2 text-sm text-slate-600 sm:text-base">
              Information register for ECS and Special payments.
            </p>
          </div>
          <div className="flex w-fit items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 sm:text-sm">
            <span className="size-2 rounded-full bg-amber-500" />
            Excluded from collection totals
          </div>
        </div>
        <Tabs defaultValue="entry" className="mt-5">
          <TabsList className="grid h-12 w-full max-w-md grid-cols-2 rounded-xl bg-amber-50 p-1">
            <TabsTrigger
              value="entry"
              className="rounded-lg text-sm font-semibold data-[state=active]:bg-amber-400 data-[state=active]:text-slate-950 data-[state=active]:shadow-sm sm:text-base"
            >
              New Entry
            </TabsTrigger>
            <TabsTrigger
              value="report"
              className="rounded-lg text-sm font-semibold data-[state=active]:bg-amber-400 data-[state=active]:text-slate-950 data-[state=active]:shadow-sm sm:text-base"
            >
              Info Report
            </TabsTrigger>
          </TabsList>
          <TabsContent value="entry" className="mt-4">
            <EcsForm />
          </TabsContent>
          <TabsContent value="report" className="mt-4">
            <EcsReport />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function EcsForm() {
  const today = todayISO();
  const yesterday = todayISO(new Date(Date.now() - 86400000));
  const [executive, setExecutive] = useState("");
  const getSession = useServerFn(getCurrentSession);
  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ["auth-session"],
    queryFn: () => getSession(),
    staleTime: 30_000,
  });
  useEffect(() => {
    if (session?.role === "Executive") setExecutive(session.name);
    else if (session?.role === "Admin") setExecutive("");
  }, [session]);
  const [loanId, setLoanId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentType, setPaymentType] = useState<"ECS" | "Special">("ECS");
  const [isPrevious, setIsPrevious] = useState(false);
  const [prevDate, setPrevDate] = useState("");
  const [remark, setRemark] = useState("");
  const [time, setTime] = useState("");
  useEffect(() => {
    setTime(nowTime());
  }, []);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [slip, setSlip] = useState<Slip | null>(null);

  const save = useServerFn(saveEcsEntry);
  const amountNum = useMemo(() => Number(amount), [amount]);
  const prevDateValid = prevDate !== "" && prevDate < today;
  const paymentDate = isPrevious ? prevDate : today;
  const valid =
    executive !== "" &&
    loanId.trim() !== "" &&
    amountNum > 0 &&
    Number.isFinite(amountNum) &&
    amountNum <= 100_000_000 &&
    !saving &&
    (!isPrevious || prevDateValid);

  function openConfirm() {
    if (!valid) return;
    setTime(nowTime());
    setShowConfirm(true);
  }

  async function doSave() {
    setSaving(true);
    try {
      const entry: Slip = {
        executive,
        loanId: loanId.trim(),
        amount: amountNum,
        paymentType,
        paymentDate,
        entryDate: today,
        entryTime: time,
        remark: remark.trim(),
      };
      await save({ data: entry as never });
      setSlip(entry);
      setShowConfirm(false);
      setExecutive(session?.role === "Executive" ? session.name : "");
      setLoanId("");
      setAmount("");
      setPaymentType("ECS");
      setIsPrevious(false);
      setPrevDate("");
      setRemark("");
      toast.success("ECS / Special entry saved (information only)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save entry");
    } finally {
      setSaving(false);
    }
  }

  async function downloadPdf() {
    if (!slip) return;
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a5" });
    doc.setFontSize(18);
    doc.text("Mahavtaar Daily Collection", 40, 60);
    doc.setFontSize(13);
    doc.text("ECS / Special Information Slip", 40, 84);
    const lines: [string, string][] = [
      ["Executive Name", slip.executive],
      ["Loan ID", slip.loanId],
      ["Amount", `Rs. ${slip.amount.toLocaleString("en-IN")}`],
      ["Payment Type", slip.paymentType],
      ["Payment Date", slip.paymentDate],
      ["Entry Date", slip.entryDate],
      ["Entry Time", slip.entryTime],
      ["Status", "Confirmed"],
      ["Remark", slip.remark || "-"],
    ];
    let y = 120;
    lines.forEach(([k, v]) => {
      doc.setFontSize(11);
      doc.text(k, 40, y);
      doc.setFontSize(13);
      doc.text(String(v), 180, y);
      y += 26;
    });
    doc.setFontSize(10);
    doc.text("Information only - not counted in collection.", 40, y + 8);
    doc.save(`ecs-${slip.loanId}.pdf`);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="rounded-xl border border-amber-200 bg-white p-3 sm:p-5">
        <div className="mb-4 border-b border-amber-100 pb-3">
          <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Create New Entry</h2>
          <p className="mt-1 text-sm text-slate-500">Enter the payment details below.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">Executive Name</Label>
            {session?.role === "Admin" ? (
              <Select value={executive} onValueChange={setExecutive}>
                <SelectTrigger className="h-11 border-slate-300 bg-white text-base">
                  <SelectValue placeholder="Select executive" />
                </SelectTrigger>
                <SelectContent>
                  {EXECUTIVES.map((e) => (
                    <SelectItem key={e} value={e}>{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex h-11 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-base text-slate-700">
                {sessionLoading ? "Loading logged-in executive..." : executive || session?.name || "Executive not available"}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">Payment Type</Label>
            <Select value={paymentType} onValueChange={(v) => setPaymentType(v as "ECS" | "Special")}>
              <SelectTrigger className="h-11 border-slate-300 bg-white text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ECS">ECS</SelectItem>
                <SelectItem value="Special">Special</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700" htmlFor="ecsLoanId">
              Loan ID / Loan Number
            </Label>
            <Input
              id="ecsLoanId"
              className="h-11 border-slate-300 text-base"
              value={loanId}
              maxLength={60}
              onChange={(e) => setLoanId(e.target.value)}
              placeholder="Enter loan number"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700" htmlFor="ecsAmount">Amount (₹)</Label>
            <Input
              id="ecsAmount"
              type="number"
              inputMode="decimal"
              min={1}
              max={100_000_000}
              className="h-11 border-slate-300 text-base"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount"
            />
          </div>
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
          <Checkbox
            checked={isPrevious}
            onCheckedChange={(v) => {
              const on = v === true;
              setIsPrevious(on);
              if (!on) setPrevDate("");
            }}
            className="mt-0.5 size-5"
          />
          <span className="text-sm font-medium leading-snug text-slate-800 sm:text-base">
            This ECS / Special belongs to Previous Paid File
          </span>
        </label>

        {isPrevious && (
          <div className="mt-3 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
            <Label className="text-sm font-semibold text-slate-800" htmlFor="ecsPrevDate">
              Original Payment Date
            </Label>
            <Input
              id="ecsPrevDate"
              type="date"
              max={yesterday}
              className="h-11 border-amber-200 bg-white text-base"
              value={prevDate}
              onChange={(e) => setPrevDate(e.target.value)}
            />
            {prevDate !== "" && !prevDateValid && (
              <p className="text-sm font-medium text-destructive">Select a date earlier than today.</p>
            )}
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">Payment Date</Label>
            <Input className="h-11 border-slate-200 bg-slate-50 text-base" value={paymentDate} readOnly />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">Entry Time</Label>
            <Input className="h-11 border-slate-200 bg-slate-50 text-base" value={time} readOnly />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold text-slate-700" htmlFor="ecsRemark">Remark (optional)</Label>
            <span className="text-xs text-slate-400">{remark.length}/300</span>
          </div>
          <Textarea
            id="ecsRemark"
            className="min-h-20 border-slate-300 text-base"
            maxLength={300}
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="Add a note about this ECS / Special payment"
          />
        </div>

        <Button
          className="mt-4 h-12 w-full bg-amber-400 text-base font-bold text-slate-950 hover:bg-amber-500"
          disabled={!valid}
          onClick={openConfirm}
        >
          Review & Submit
        </Button>
      </section>

      <aside className="space-y-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 font-semibold text-amber-950">
            <span className="flex size-8 items-center justify-center rounded-full bg-amber-200 text-amber-900">i</span>
            Information Only
          </div>
          <p className="mt-2 text-sm leading-relaxed text-amber-950/80">
            ECS / Special entries are maintained separately. They are never added to collection totals, executive performance, reports, or charts.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="font-semibold text-slate-900">Entry Checklist</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li>• Verify the loan number.</li>
            <li>• Select the correct payment type.</li>
            <li>• Use Previous Paid File only for an earlier payment date.</li>
            <li>• Add a remark when useful for follow-up.</li>
          </ul>
        </div>
      </aside>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl">Confirm ECS / Special entry</DialogTitle>
            <DialogDescription>Please check the details before saving.</DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 text-base">
            <Row k="Executive" v={executive} />
            <Row k="Loan ID" v={loanId} />
            <Row k="Amount" v={formatAmount(amountNum || 0)} />
            <Row k="Payment Type" v={paymentType} />
            <Row k="Payment Date" v={paymentDate} />
            <Row k="Entry Date" v={today} />
            <Row k="Entry Time" v={time} />
            <Row k="Status" v="Confirmed" />
            <Row k="Remark" v={remark.trim() || "-"} />
          </dl>
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            This is an information-only entry and will not be counted in collection.
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" className="h-11 text-base" onClick={() => setShowConfirm(false)}>
              Cancel / Edit
            </Button>
            <Button
              className="h-11 bg-amber-400 text-base font-semibold text-slate-950 hover:bg-amber-500"
              onClick={doSave}
              disabled={saving}
            >
              {saving ? "Saving..." : "Confirm & Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {slip && (
        <div className="mt-2 rounded-xl border border-amber-200 bg-white p-4 sm:p-5 lg:col-span-2">
          <div id="receipt-print">
            <h2 className="text-xl font-bold text-slate-900">Mahavtaar Daily Collection</h2>
            <p className="text-sm text-slate-500">ECS / Special Information Slip</p>
            <dl className="mt-4 space-y-2 text-base">
              <Row k="Executive Name" v={slip.executive} />
              <Row k="Loan ID" v={slip.loanId} />
              <Row k="Amount" v={formatAmount(slip.amount)} />
              <Row k="Payment Type" v={slip.paymentType} />
              <Row k="Payment Date" v={slip.paymentDate} />
              <Row k="Entry Date" v={slip.entryDate} />
              <Row k="Entry Time" v={slip.entryTime} />
              <Row k="Status" v="Confirmed" />
              <Row k="Remark" v={slip.remark || "-"} />
            </dl>
            <p className="mt-3 text-sm text-slate-500">Information only — not counted in collection.</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 print:hidden">
            <Button variant="outline" className="h-11" onClick={() => window.print()}>Print</Button>
            <Button className="h-11 bg-amber-400 font-semibold text-slate-950 hover:bg-amber-500" onClick={downloadPdf}>
              Download PDF
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function EcsReport() {
  const today = todayISO();
  const load = useServerFn(getEcsEntries);
  const getSession = useServerFn(getCurrentSession);
  const { data: session } = useQuery({
    queryKey: ["auth-session"],
    queryFn: () => getSession(),
    staleTime: 30_000,
  });
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["ecs-entries"],
    queryFn: async () => {
      const res = await load();
      return Array.isArray(res) ? res : [];
    },
  });

  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [allDates, setAllDates] = useState(false);
  const [exec, setExec] = useState("all");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");

  const [editing, setEditing] = useState<{ id: string; loanId: string } | null>(null);
  const [newStatus, setNewStatus] = useState<string>("Confirmed");
  const [newRemark, setNewRemark] = useState("");
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const update = useServerFn(updateEcsEntry);

  const invalidDateRange = !allDates && Boolean(from && to && from > to);
  const rows = useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    const query = search.trim().toLowerCase();
    return list.filter((r) => {
      if (!allDates) {
        if (from && r.paymentDate < from) return false;
        if (to && r.paymentDate > to) return false;
      }
      if (exec !== "all" && r.executive !== exec) return false;
      if (type !== "all" && r.paymentType !== type) return false;
      if (status !== "all" && r.status !== status) return false;
      if (
        query &&
        ![r.loanId, r.executive, r.paymentType, r.status, r.remark]
          .some((value) => String(value ?? "").toLowerCase().includes(query))
      ) return false;
      return true;
    });
  }, [data, allDates, from, to, exec, type, status, search]);

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const ecsCount = rows.filter((r) => r.paymentType === "ECS").length;
  const specialCount = rows.filter((r) => r.paymentType === "Special").length;
  const canEdit = (entryExecutive: string) =>
    session?.role === "Admin" || (session?.role === "Executive" && session.name === entryExecutive);

  async function doUpdate() {
    if (!editing) return;
    setUpdating(true);
    try {
      await update({
        data: { id: editing.id, status: newStatus, remark: newRemark.trim() } as never,
      });
      toast.success("Entry updated");
      setConfirmUpdate(false);
      setEditing(null);
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update entry");
    } finally {
      setUpdating(false);
    }
  }

  function openEdit(r: (typeof rows)[number]) {
    if (!canEdit(r.executive)) return;
    setEditing({ id: r.id, loanId: r.loanId });
    setNewStatus(r.status || "Confirmed");
    setNewRemark(r.remark ?? "");
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Filtered Entries" value={String(rows.length)} />
        <SummaryCard label="Total Amount" value={formatAmount(total)} />
        <SummaryCard label="ECS Entries" value={String(ecsCount)} />
        <SummaryCard label="Special Entries" value={String(specialCount)} />
      </div>

      <section className="rounded-xl border border-amber-200 bg-white p-3 sm:p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-bold text-slate-900">Report Filters</h2>
            <p className="text-xs text-slate-500">Search and filter the loaded register.</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-full border-amber-300 bg-amber-50 text-slate-800 hover:bg-amber-100 sm:w-auto"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? "Refreshing..." : "Refresh Report"}
          </Button>
        </div>

        <div className="mb-3 space-y-2">
          <Label className="text-sm font-semibold text-slate-700" htmlFor="ecsReportSearch">Search</Label>
          <Input
            id="ecsReportSearch"
            className="h-11 border-slate-300"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search loan number, executive, type, status or remark..."
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">From Date</Label>
            <Input type="date" className="h-11 border-slate-300" value={from} disabled={allDates} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">To Date</Label>
            <Input type="date" className="h-11 border-slate-300" value={to} disabled={allDates} onChange={(e) => setTo(e.target.value)} />
          </div>
          <FilterSelect label="Executive" value={exec} onChange={setExec} options={[...EXECUTIVES]} />
          <FilterSelect label="Payment Type" value={type} onChange={setType} options={["ECS", "Special"]} />
          <div className="sm:col-span-2 lg:col-span-4">
            <FilterSelect label="Status" value={status} onChange={setStatus} options={[...STATUSES]} />
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-3 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-slate-700">
            <Checkbox checked={allDates} onCheckedChange={(v) => setAllDates(v === true)} className="size-5" />
            Show all dates
          </label>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-slate-600 hover:bg-amber-50"
            onClick={() => {
              setFrom(today);
              setTo(today);
              setAllDates(false);
              setExec("all");
              setType("all");
              setStatus("all");
              setSearch("");
            }}
          >
            Reset Filters
          </Button>
        </div>
        {invalidDateRange && (
          <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm font-medium text-red-700">
            From Date cannot be later than To Date.
          </p>
        )}
      </section>

      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-slate-800">
          {invalidDateRange ? 0 : rows.length} entries
          <span className="ml-2 font-normal text-slate-500">· {formatAmount(invalidDateRange ? 0 : total)}</span>
        </p>
        <span className="w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">
          Information only — not collection
        </span>
      </div>

      {isLoading ? (
        <p className="rounded-xl border border-amber-100 bg-white p-8 text-center text-slate-500">Loading ECS / Special entries...</p>
      ) : invalidDateRange ? (
        <p className="rounded-xl border border-amber-100 bg-white p-8 text-center text-slate-500">Correct the date range to view entries.</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-amber-100 bg-white p-8 text-center text-slate-500">
          No ECS / Special entries found for the selected filters.
        </p>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-amber-200 bg-white md:block">
            <div className="max-h-[650px] overflow-auto">
              <table className="w-full min-w-[1050px] border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 bg-amber-100 text-xs uppercase tracking-wide text-slate-700">
                  <tr>
                    <th className="px-3 py-3 font-bold">Loan ID</th>
                    <th className="px-3 py-3 font-bold">Executive</th>
                    <th className="px-3 py-3 text-right font-bold">Amount</th>
                    <th className="px-3 py-3 font-bold">Type</th>
                    <th className="px-3 py-3 font-bold">Payment Date</th>
                    <th className="px-3 py-3 font-bold">Entry Date / Time</th>
                    <th className="px-3 py-3 font-bold">Status</th>
                    <th className="px-3 py-3 font-bold">Remark</th>
                    <th className="px-3 py-3 text-right font-bold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100 hover:bg-amber-50/50">
                      <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-900">{r.loanId}</td>
                      <td className="px-3 py-3 text-slate-700">{r.executive}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">{formatAmount(r.amount)}</td>
                      <td className="px-3 py-3"><TypeBadge type={r.paymentType} /></td>
                      <td className="whitespace-nowrap px-3 py-3 text-slate-600">{r.paymentDate}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-slate-600">{r.entryDate} {r.entryTime}</td>
                      <td className="px-3 py-3"><StatusBadge status={r.status} /></td>
                      <td className="max-w-[220px] truncate px-3 py-3 text-slate-600" title={r.remark || "-"}>{r.remark || "-"}</td>
                      <td className="px-3 py-3 text-right">
                        {canEdit(r.executive) ? (
                          <Button variant="outline" size="sm" className="border-amber-300 hover:bg-amber-50" onClick={() => openEdit(r)}>
                            Update
                          </Button>
                        ) : (
                          <span className="text-xs text-slate-400">View only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {rows.map((r) => (
              <article key={r.id} className="rounded-xl border border-amber-200 bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-all font-bold text-slate-900">{r.loanId}</p>
                    <p className="mt-0.5 text-sm text-slate-500">{r.executive}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-bold tabular-nums text-slate-900">{formatAmount(r.amount)}</p>
                    <TypeBadge type={r.paymentType} />
                  </div>
                </div>
                <div className="my-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-sm">
                  <div>
                    <p className="text-xs text-slate-500">Payment Date</p>
                    <p className="mt-0.5 font-medium text-slate-800">{r.paymentDate}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Entry Date / Time</p>
                    <p className="mt-0.5 font-medium text-slate-800">{r.entryDate} {r.entryTime}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="mb-1 text-xs text-slate-500">Status</p>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="col-span-2 min-w-0">
                    <p className="text-xs text-slate-500">Remark</p>
                    <p className="mt-0.5 break-words text-slate-700">{r.remark || "-"}</p>
                  </div>
                </div>
                {canEdit(r.executive) ? (
                  <Button variant="outline" className="h-10 w-full border-amber-300 text-slate-800 hover:bg-amber-50" onClick={() => openEdit(r)}>
                    Update Remark / Status
                  </Button>
                ) : (
                  <p className="text-center text-xs text-slate-400">View only — you can update your own entries.</p>
                )}
              </article>
            ))}
          </div>
        </>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl">Update {editing?.loanId}</DialogTitle>
            <DialogDescription>
              The original entry is kept. Only status and remark are updated.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-base">Status</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger className="h-11 text-base"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-base">Remark</Label>
              <Textarea className="min-h-20 text-base" maxLength={300} value={newRemark} onChange={(e) => setNewRemark(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" className="h-11" onClick={() => setEditing(null)}>Cancel</Button>
            <Button className="h-11 bg-amber-400 font-semibold text-slate-950 hover:bg-amber-500" onClick={() => setConfirmUpdate(true)}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmUpdate} onOpenChange={setConfirmUpdate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl">Confirm update</DialogTitle>
            <DialogDescription>
              Set status to &quot;{newStatus}&quot; for {editing?.loanId}? This entry stays information-only and never affects collection totals.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" className="h-11" onClick={() => setConfirmUpdate(false)}>Cancel</Button>
            <Button className="h-11 bg-amber-400 font-semibold text-slate-950 hover:bg-amber-500" onClick={doUpdate} disabled={updating}>
              {updating ? "Saving..." : "Confirm Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 sm:p-4">
      <p className="text-xs font-semibold text-amber-900/80 sm:text-sm">{label}</p>
      <p className="mt-1 break-words text-lg font-bold tabular-nums text-slate-900 sm:text-xl">{value}</p>
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
      type === "ECS"
        ? "border-blue-200 bg-blue-50 text-blue-800"
        : "border-amber-200 bg-amber-100 text-amber-900"
    }`}>
      {type}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Confirmed: "border-emerald-200 bg-emerald-50 text-emerald-800",
    Bounced: "border-red-200 bg-red-50 text-red-800",
    Cleared: "border-blue-200 bg-blue-50 text-blue-800",
    Cancelled: "border-slate-200 bg-slate-100 text-slate-700",
  };
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${styles[status] ?? "border-slate-200 bg-slate-50 text-slate-700"}`}>
      {status || "Unknown"}
    </span>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-slate-700">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-11 border-slate-300 bg-white text-base">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-1">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-right font-semibold text-slate-900">{v}</dd>
    </div>
  );
}
