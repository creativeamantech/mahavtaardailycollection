import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { EXECUTIVES, formatAmount, nowTime, todayISO } from "@/lib/executives";
import { saveCollection } from "@/lib/mahavtaar.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mahavtaar Daily Collection" },
      {
        name: "description",
        content:
          "Record daily loan collections by executive with instant confirmation and printable receipts.",
      },
      { property: "og:title", content: "Mahavtaar Daily Collection" },
      {
        property: "og:description",
        content: "Record daily loan collections by executive with instant confirmation and printable receipts.",
      },
    ],
  }),
  component: EntryPage,
});

type Receipt = {
  executive: string;
  loanId: string;
  amount: number;
  date: string;
  time: string;
};

function EntryPage() {
  const today = todayISO();
  const [executive, setExecutive] = useState("");
  const [loanId, setLoanId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState(nowTime());
  const [confirmed, setConfirmed] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

  const save = useServerFn(saveCollection);
  const amountNum = useMemo(() => Number(amount), [amount]);
  const valid =
    executive !== "" && loanId.trim() !== "" && amountNum > 0 && confirmed && !saving;

  function openConfirm() {
    if (!valid) return;
    setTime(nowTime());
    setShowConfirm(true);
  }

  async function doSave() {
    setSaving(true);
    try {
      const entry = { executive, loanId: loanId.trim(), amount: amountNum, date, time };
      await save({ data: entry as never });
      setReceipt(entry);
      setShowConfirm(false);
      setExecutive("");
      setLoanId("");
      setAmount("");
      setConfirmed(false);
      setDate(today);
      toast.success("Entry saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save entry");
    } finally {
      setSaving(false);
    }
  }

  async function downloadPdf() {
    if (!receipt) return;
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a5" });
    doc.setFontSize(18);
    doc.text("Mahavtaar Daily Collection", 40, 60);
    doc.setFontSize(13);
    doc.text("Payment Receipt", 40, 84);
    const lines: [string, string][] = [
      ["Executive Name", receipt.executive],
      ["Loan ID", receipt.loanId],
      ["Amount", `Rs. ${receipt.amount.toLocaleString("en-IN")}`],
      ["Date", receipt.date],
      ["Time", receipt.time],
      ["Status", "Confirmed"],
    ];
    let y = 120;
    lines.forEach(([k, v]) => {
      doc.setFontSize(11);
      doc.text(k, 40, y);
      doc.setFontSize(13);
      doc.text(String(v), 180, y);
      y += 28;
    });
    doc.save(`receipt-${receipt.loanId}.pdf`);
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-16 pt-6">
      <h1 className="text-3xl font-bold tracking-tight">Collection Entry</h1>
      <p className="mt-1 text-base text-muted-foreground">
        Record a payment collected by an executive.
      </p>

      <div className="mt-6 space-y-5 rounded-xl border p-4">
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
          <Label className="text-base" htmlFor="loanId">
            Loan ID / Loan Number
          </Label>
          <Input
            id="loanId"
            className="h-12 text-base"
            value={loanId}
            maxLength={60}
            onChange={(e) => setLoanId(e.target.value)}
            placeholder="Enter loan number"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-base" htmlFor="amount">
            Amount
          </Label>
          <Input
            id="amount"
            type="number"
            inputMode="decimal"
            min={1}
            className="h-12 text-base"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-base" htmlFor="date">
              Date
            </Label>
            <Input id="date" type="date" className="h-12 text-base" value={date} readOnly />
          </div>
          <div className="space-y-2">
            <Label className="text-base" htmlFor="time">
              Time
            </Label>
            <Input id="time" className="h-12 text-base" value={time} readOnly />
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
          <Checkbox
            checked={confirmed}
            onCheckedChange={(v) => setConfirmed(v === true)}
            className="mt-1 size-5"
          />
          <span className="text-base leading-snug">
            I confirm this is not ECS or Special payment, and this is the payment brought by the
            selected executive, and amount is correct.
          </span>
        </label>

        <Button className="h-14 w-full text-lg" disabled={!valid} onClick={openConfirm}>
          Submit
        </Button>
        {!confirmed && (
          <p className="text-center text-sm text-muted-foreground">
            Tick the confirmation to enable Submit.
          </p>
        )}
      </div>

      <div className="mt-4 text-center">
        <Link to="/report" className="text-base font-medium text-primary underline">
          View reports
        </Link>
      </div>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl">Confirm entry</DialogTitle>
            <DialogDescription>Please check the details before saving.</DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 text-base">
            <Row k="Executive" v={executive} />
            <Row k="Loan ID" v={loanId} />
            <Row k="Amount" v={formatAmount(amountNum || 0)} />
            <Row k="Date" v={date} />
            <Row k="Time" v={time} />
          </dl>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" className="h-12 text-base" onClick={() => setShowConfirm(false)}>
              Cancel / Edit
            </Button>
            <Button className="h-12 text-base" onClick={doSave} disabled={saving}>
              {saving ? "Saving..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {receipt && (
        <div className="mt-8">
          <div ref={receiptRef} id="receipt-print" className="rounded-xl border p-5">
            <h2 className="text-xl font-bold">Mahavtaar Daily Collection</h2>
            <p className="text-base text-muted-foreground">Payment Receipt</p>
            <dl className="mt-4 space-y-2 text-base">
              <Row k="Executive Name" v={receipt.executive} />
              <Row k="Loan ID" v={receipt.loanId} />
              <Row k="Amount" v={formatAmount(receipt.amount)} />
              <Row k="Date" v={receipt.date} />
              <Row k="Time" v={receipt.time} />
              <Row k="Status" v="Confirmed" />
            </dl>
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
    </main>
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
