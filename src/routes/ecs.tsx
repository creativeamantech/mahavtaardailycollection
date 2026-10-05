import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { EXECUTIVES, formatAmount, nowTime, todayISO } from "@/lib/executives";
import { getEcsEntries, saveEcsEntry, updateEcsEntry } from "@/lib/ecs.functions";
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

export const Route = createFileRoute("/ecs")({
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
        content: "Information-only ECS and Special payment register with remarks and status updates.",
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
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6">
      <h1 className="text-3xl font-bold tracking-tight">ECS / Special Entry</h1>
      <p className="mt-1 text-base text-muted-foreground">
        Information only. These entries are never counted in any collection report.
      </p>
      <Tabs defaultValue="entry" className="mt-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="entry" className="text-base">
            New Entry
          </TabsTrigger>
          <TabsTrigger value="report" className="text-base">
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
    </main>
  );
}

function EcsForm() {
  const today = todayISO();
  const yesterday = todayISO(new Date(Date.now() - 86400000));
  const [executive, setExecutive] = useState("");
  const [loanId, setLoanId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentType, setPaymentType] = useState<"ECS" | "Special">("ECS");
  const [isPrevious, setIsPrevious] = useState(false);
  const [prevDate, setPrevDate] = useState("");
  const [remark, setRemark] = useState("");
  const [time, setTime] = useState(nowTime());
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
      setExecutive("");
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
    <div>
      <div className="space-y-5 rounded-xl border p-4">
        <div className="space-y-2">
          <Label className="text-base">Executive Name</Label>
          <Select value={executive} onValueChange={setExecutive}>
            <SelectTrigger className="h-12 text-base">
              <SelectValue placeholder="Select executive" />
            </SelectTrigger>
            <SelectContent>
              {EXECUTIVES.map((e) => (
                <SelectItem key={e} value={e} className="text-base">
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-base" htmlFor="ecsLoanId">
            Loan ID / Loan Number
          </Label>
          <Input
            id="ecsLoanId"
            className="h-12 text-base"
            value={loanId}
            maxLength={60}
            onChange={(e) => setLoanId(e.target.value)}
            placeholder="Enter loan number"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-base" htmlFor="ecsAmount">
            Amount
          </Label>
          <Input
            id="ecsAmount"
            type="number"
            inputMode="decimal"
            min={1}
            className="h-12 text-base"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-base">Payment Type</Label>
          <Select value={paymentType} onValueChange={(v) => setPaymentType(v as "ECS" | "Special")}>
            <SelectTrigger className="h-12 text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ECS" className="text-base">
                ECS
              </SelectItem>
              <SelectItem value="Special" className="text-base">
                Special
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
          <Checkbox
            checked={isPrevious}
            onCheckedChange={(v) => {
              const on = v === true;
              setIsPrevious(on);
              if (!on) setPrevDate("");
            }}
            className="mt-1 size-5"
          />
          <span className="text-base leading-snug">
            This ECS / Special belongs to Previous Paid File
          </span>
        </label>

        {isPrevious && (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <Label className="text-base" htmlFor="ecsPrevDate">
              Original Payment Date
            </Label>
            <Input
              id="ecsPrevDate"
              type="date"
              max={yesterday}
              className="h-12 bg-white text-base"
              value={prevDate}
              onChange={(e) => setPrevDate(e.target.value)}
            />
            {prevDate !== "" && !prevDateValid && (
              <p className="text-sm font-medium text-destructive">
                Select a date earlier than today.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-base">Payment Date</Label>
            <Input className="h-12 text-base" value={paymentDate} readOnly />
          </div>
          <div className="space-y-2">
            <Label className="text-base">Entry Time</Label>
            <Input className="h-12 text-base" value={time} readOnly />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-base" htmlFor="ecsRemark">
            Remark (optional)
          </Label>
          <Textarea
            id="ecsRemark"
            className="min-h-20 text-base"
            maxLength={300}
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="Any note about this ECS / Special payment"
          />
        </div>

        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          This is an information-only entry. It will not be counted in any collection total, report,
          or chart.
        </p>

        <Button className="h-14 w-full text-lg" disabled={!valid} onClick={openConfirm}>
          Submit
        </Button>
      </div>

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
            <Button
              variant="outline"
              className="h-12 text-base"
              onClick={() => setShowConfirm(false)}
            >
              Cancel / Edit
            </Button>
            <Button className="h-12 text-base" onClick={doSave} disabled={saving}>
              {saving ? "Saving..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {slip && (
        <div className="mt-8">
          <div id="receipt-print" className="rounded-xl border p-5">
            <h2 className="text-xl font-bold">Mahavtaar Daily Collection</h2>
            <p className="text-base text-muted-foreground">ECS / Special Information Slip</p>
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
            <p className="mt-3 text-sm text-muted-foreground">
              Information only — not counted in collection.
            </p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 print:hidden">
            <Button variant="outline" className="h-12 text-base" onClick={() => window.print()}>
              Print
            </Button>
            <Button className="h-12 text-base" onClick={downloadPdf}>
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
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ecs-entries"],
    queryFn: () => load(),
  });

  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [allDates, setAllDates] = useState(false);
  const [exec, setExec] = useState("all");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");

  const [editing, setEditing] = useState<{ id: string; loanId: string } | null>(null);
  const [newStatus, setNewStatus] = useState<string>("Confirmed");
  const [newRemark, setNewRemark] = useState("");
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const update = useServerFn(updateEcsEntry);

  const rows = useMemo(() => {
    const list = data ?? [];
    return list.filter((r) => {
      if (!allDates) {
        if (from && r.paymentDate < from) return false;
        if (to && r.paymentDate > to) return false;
      }
      if (exec !== "all" && r.executive !== exec) return false;
      if (type !== "all" && r.paymentType !== type) return false;
      if (status !== "all" && r.status !== status) return false;
      return true;
    });
  }, [data, allDates, from, to, exec, type, status]);

  const total = rows.reduce((s, r) => s + r.amount, 0);

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

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-xl border p-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-base">From</Label>
            <Input
              type="date"
              className="h-12 text-base"
              value={from}
              disabled={allDates}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-base">To</Label>
            <Input
              type="date"
              className="h-12 text-base"
              value={to}
              disabled={allDates}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-3">
          <Checkbox
            checked={allDates}
            onCheckedChange={(v) => setAllDates(v === true)}
            className="size-5"
          />
          <span className="text-base">Show all dates</span>
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FilterSelect label="Executive" value={exec} onChange={setExec} options={[...EXECUTIVES]} />
          <FilterSelect label="Type" value={type} onChange={setType} options={["ECS", "Special"]} />
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            options={[...STATUSES]}
          />
        </div>
      </div>

      <p className="text-base font-medium">
        {rows.length} entries · {formatAmount(total)}{" "}
        <span className="text-muted-foreground">(information only)</span>
      </p>

      {isLoading ? (
        <p className="rounded-xl border p-6 text-center text-muted-foreground">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border p-6 text-center text-muted-foreground">
          No ECS / Special entries found.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{r.loanId}</p>
                  <p className="text-base text-muted-foreground">{r.executive}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold">{formatAmount(r.amount)}</p>
                  <span className="rounded-full border px-2 py-0.5 text-xs font-medium">
                    {r.paymentType}
                  </span>
                </div>
              </div>
              <dl className="mt-3 space-y-1 text-sm">
                <Row k="Payment Date" v={r.paymentDate} />
                <Row k="Entry Date" v={`${r.entryDate} ${r.entryTime}`} />
                <Row k="Status" v={r.status} />
                <Row k="Remark" v={r.remark || "-"} />
              </dl>
              <Button
                variant="outline"
                className="mt-3 h-11 w-full text-base"
                onClick={() => {
                  setEditing({ id: r.id, loanId: r.loanId });
                  setNewStatus(r.status || "Confirmed");
                  setNewRemark(r.remark ?? "");
                }}
              >
                Update Remark / Status
              </Button>
            </div>
          ))}
        </div>
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
                <SelectTrigger className="h-12 text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="text-base">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-base">Remark</Label>
              <Textarea
                className="min-h-20 text-base"
                maxLength={300}
                value={newRemark}
                onChange={(e) => setNewRemark(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" className="h-12 text-base" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button className="h-12 text-base" onClick={() => setConfirmUpdate(true)}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmUpdate} onOpenChange={setConfirmUpdate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl">Confirm update</DialogTitle>
            <DialogDescription>
              Set status to &quot;{newStatus}&quot; for {editing?.loanId}? This entry stays
              information-only and never affects collection totals.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              className="h-12 text-base"
              onClick={() => setConfirmUpdate(false)}
            >
              Cancel
            </Button>
            <Button className="h-12 text-base" onClick={doUpdate} disabled={updating}>
              {updating ? "Saving..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
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
      <Label className="text-base">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-12 text-base">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-base">
            All
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b pb-1">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-semibold">{v}</dd>
    </div>
  );
}
