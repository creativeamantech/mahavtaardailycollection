import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { toast } from "sonner";
import { EXECUTIVES, formatAmount, nowTime, todayISO } from "@/lib/executives";
import {
  getCollections,
  markConflictRows,
  saveCollection,
  uploadReceiptImage,
} from "@/lib/mahavtaar.functions";
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
  entryDate: string;
  entryType: "Normal" | "Previous Paid File";
  settlement: boolean;
  receiptLink?: string;
};

type ExistingEntry = {
  row: number;
  executive: string;
  loanId: string;
  amount: number;
  date: string;
  time: string;
};

function normaliseLoanId(v: string) {
  return String(v ?? "")
    .replace(/^['`\u2018\u2019]+/, "")
    .trim()
    .toUpperCase();
}

async function fileToBase64(file: File) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}



function EntryPage() {
  const today = todayISO();
  const yesterday = todayISO(new Date(Date.now() - 86400000));
  const [executive, setExecutive] = useState("");
  const [loanId, setLoanId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState(nowTime());
  const [confirmed, setConfirmed] = useState(false);
  const [isPrevious, setIsPrevious] = useState(false);
  const [settlement, setSettlement] = useState(false);
  const [prevConfirmed, setPrevConfirmed] = useState(false);

  const [prevDate, setPrevDate] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();


  const save = useServerFn(saveCollection);
  const uploadReceipt = useServerFn(uploadReceiptImage);
  const fetchCollections = useServerFn(getCollections);
  const flagConflicts = useServerFn(markConflictRows);
  const { data: existing = [], refetch: refetchCollections } = useQuery({
    queryKey: ["collections"],
    queryFn: () => fetchCollections(),
    staleTime: 60_000,
  });
  const [receipts, setReceipts] = useState<{ name: string; link: string }[]>([]);
  const [pendingFiles, setPendingFiles] = useState<{ file: File; preview: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [fileKey, setFileKey] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [remark, setRemark] = useState("");
  const receiptLink = receipts.length > 0 ? receipts[0]!.link : "";

  function addPendingFiles(fileList: Iterable<File> | null) {
    setUploadError("");
    const files = Array.from(fileList ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) {
      setUploadError("Please select only image files.");
      return;
    }
    setPendingFiles((prev) =>
      [...prev, ...files.map((file) => ({ file, preview: URL.createObjectURL(file) }))].slice(
        0,
        10,
      ),
    );
    setFileKey((k) => k + 1);
  }

  function removePendingFile(preview: string) {
    URL.revokeObjectURL(preview);
    setPendingFiles((prev) => prev.filter((p) => p.preview !== preview));
  }

  function removeUploadedReceipt(link: string) {
    setReceipts((prev) => prev.filter((r) => r.link !== link));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (uploading) return;
    addPendingFiles(e.dataTransfer.files);
  }

  async function uploadPendingFiles() {
    setUploadError("");
    if (pendingFiles.length === 0) return;
    if (loanId.trim() === "") {
      setUploadError("Enter the Loan Number before uploading receipt images.");
      return;
    }
    setUploading(true);
    const uploaded: { name: string; link: string }[] = [];
    try {
      for (const { file } of pendingFiles) {
        const base64 = await fileToBase64(file);
        const res = (await uploadReceipt({
          data: {
            loanNumber: loanId.trim(),
            name: file.name || "receipt.jpg",
            mimeType: file.type,
            base64,
          } as never,
        })) as { link: string };
        uploaded.push({ name: file.name || "receipt", link: res.link });
      }
      setReceipts((prev) => [...prev, ...uploaded].slice(0, 10));
      pendingFiles.forEach((p) => URL.revokeObjectURL(p.preview));
      setPendingFiles([]);
      toast.success(`${uploaded.length} receipt(s) uploaded to Google Drive`);
    } catch (e) {
      setUploadError(
        e instanceof Error ? e.message : "Upload failed. Please upload the receipt image again.",
      );
      toast.error("Receipt upload failed. Please upload the receipt image again.");
    } finally {
      setUploading(false);
    }
  }

  const amountNum = useMemo(() => Number(amount), [amount]);
  const prevDateValid = prevDate !== "" && prevDate < today;
  const paymentDate = isPrevious ? prevDate : today;
  const remarkWords = remark.trim().split(/\s+/).filter(Boolean).length;
  const remarkValid = remarkWords > 3;
  const proofValid = receiptLink !== "" || remarkValid;
  const valid =
    executive !== "" &&
    loanId.trim() !== "" &&
    amountNum > 0 &&
    confirmed &&
    !saving &&
    !uploading &&
    proofValid &&
    (!isPrevious || (prevDateValid && prevConfirmed));

  const normLoanId = normaliseLoanId(loanId);
  const matches = useMemo(() => {
    if (normLoanId === "" || !(amountNum > 0)) return [] as ExistingEntry[];
    return (existing as ExistingEntry[]).filter(
      (c) => normaliseLoanId(c.loanId) === normLoanId && Number(c.amount) === amountNum,
    );
  }, [existing, normLoanId, amountNum]);
  const duplicates = useMemo(
    () => matches.filter((m) => m.executive.trim() === executive.trim()),
    [matches, executive],
  );
  const conflicts = useMemo(
    () => matches.filter((m) => m.executive.trim() !== executive.trim()),
    [matches, executive],
  );

  async function openConfirm() {
    if (!valid) return;
    setTime(nowTime());
    // Refresh right before submission so the check uses the latest data.
    await refetchCollections();
    setShowConfirm(true);
  }

  async function doSave() {
    setSaving(true);
    try {
      const entry = {
        executive,
        loanId: loanId.trim(),
        amount: amountNum,
        date: paymentDate,
        time,
        entryDate: today,
        entryType: (isPrevious ? "Previous Paid File" : "Normal") as
          | "Normal"
          | "Previous Paid File",
        settlement,
      };
      const saved = (await save({
        data: {
          ...entry,
          receiptLinks: receipts.map((r) => r.link),
          remark: receiptLink === "" ? remark.trim() : "",
        } as never,
      })) as { row?: number };

      if (conflicts.length > 0) {
        const rows = [
          ...conflicts.map((c) => c.row).filter((r) => r > 1),
          ...(saved?.row && saved.row > 1 ? [saved.row] : []),
        ];
        if (rows.length > 0) {
          try {
            await flagConflicts({ data: { rows } as never });
            toast.warning("Payment conflict marked in red in the Google Sheet");
          } catch {
            toast.error("Saved, but the conflict could not be marked in the sheet");
          }
        }
      }
      setReceipt({ ...entry, receiptLink });
      qc.invalidateQueries({ queryKey: ["collections"] });
      setShowConfirm(false);

      setExecutive("");
      setLoanId("");
      setAmount("");
      setConfirmed(false);
      setDate(today);
      setIsPrevious(false);
      setSettlement(false);
      setPrevConfirmed(false);
      setPrevDate("");
      pendingFiles.forEach((p) => URL.revokeObjectURL(p.preview));
      setPendingFiles([]);
      setReceipts([]);
      setRemark("");
      setUploadError("");
      setFileKey((k) => k + 1);
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
      ["Payment Date", receipt.date],
      ["Entry Date", receipt.entryDate],
      ["Entry Time", receipt.time],
      ["Entry Type", receipt.entryType],
      ["Settlement Payment", receipt.settlement ? "Yes" : "No"],
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

      <div
        className={`mt-6 space-y-5 rounded-xl border p-4 ${
          conflicts.length > 0
            ? "border-red-500 bg-red-50"
            : duplicates.length > 0
              ? "border-amber-500 bg-amber-50"
              : ""
        }`}
      >
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

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
          <Checkbox
            checked={settlement}
            onCheckedChange={(v) => setSettlement(v === true)}
            className="mt-1 size-5"
          />
          <span className="text-base leading-snug">Settlement Payment</span>
        </label>


        <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
          <Checkbox
            checked={isPrevious}
            onCheckedChange={(v) => {
              const on = v === true;
              setIsPrevious(on);
              if (!on) {
                setPrevDate("");
                setPrevConfirmed(false);
              }
            }}
            className="mt-1 size-5"
          />
          <span className="text-base leading-snug">
            This payment belongs to a Previous Paid File (Next-Day Entry)
          </span>
        </label>

        {isPrevious && (
          <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm leading-snug text-amber-900">
              This payment will be counted on the selected Original Payment Date, while today&apos;s
              date will be stored as the Entry Date for audit purposes.
            </p>
            <div className="space-y-2">
              <Label className="text-base" htmlFor="prevDate">
                Original Payment Date
              </Label>
              <Input
                id="prevDate"
                type="date"
                max={yesterday}
                className="h-12 bg-white text-base"
                value={prevDate}
                onChange={(e) => setPrevDate(e.target.value)}
              />
              {prevDate !== "" && !prevDateValid && (
                <p className="text-sm font-medium text-destructive">
                  Select a date earlier than today. Today and future dates are not allowed.
                </p>
              )}
            </div>
            <label className="flex cursor-pointer items-start gap-3">
              <Checkbox
                checked={prevConfirmed}
                onCheckedChange={(v) => setPrevConfirmed(v === true)}
                className="mt-1 size-5"
              />
              <span className="text-sm leading-snug text-amber-900">
                I confirm that this payment actually belongs to the selected previous payment date
                and is being entered today because it was received in a later paid file.
              </span>
            </label>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-base" htmlFor="date">
              {isPrevious ? "Payment Date" : "Date"}
            </Label>
            <Input
              id="date"
              type="date"
              className="h-12 text-base"
              value={paymentDate}
              readOnly
            />
          </div>
          <div className="space-y-2">
            <Label className="text-base" htmlFor="time">
              Time
            </Label>
            <Input id="time" className="h-12 text-base" value={time} readOnly />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-base" htmlFor="receiptImage">
            Payment Receipt Images (multiple allowed)
          </Label>
          <div
            role="button"
            tabIndex={0}
            aria-label="Receipt image drop zone"
            onDragOver={(e) => {
              e.preventDefault();
              if (!uploading) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById("receiptImage")?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ")
                document.getElementById("receiptImage")?.click();
            }}
            className={`flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
              dragOver
                ? "border-primary bg-primary/10"
                : "border-muted-foreground/30 bg-muted/30"
            }`}
          >
            <p className="text-base font-medium">
              {dragOver ? "Drop receipt images here" : "Drag & drop receipt images here"}
            </p>
            <p className="text-sm text-muted-foreground">or tap to choose images</p>
          </div>
          <Input
            id="receiptImage"
            key={fileKey}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => addPendingFiles(e.target.files)}
          />
          {pendingFiles.length > 0 && (
            <div className="space-y-2">
              <ul className="grid grid-cols-3 gap-2">
                {pendingFiles.map((p) => (
                  <li key={p.preview} className="relative">
                    <img
                      src={p.preview}
                      alt={p.file.name}
                      className="h-20 w-full rounded-lg border object-cover"
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${p.file.name}`}
                      onClick={() => removePendingFile(p.preview)}
                      className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-destructive text-xs font-bold text-destructive-foreground"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full text-base"
                disabled={uploading}
                onClick={uploadPendingFiles}
              >
                {uploading
                  ? "Uploading..."
                  : `Upload ${pendingFiles.length} receipt image${pendingFiles.length > 1 ? "s" : ""}`}
              </Button>
            </div>
          )}
          {receipts.length > 0 && (
            <ul className="space-y-1 text-sm font-medium text-green-700">
              {receipts.map((r) => (
                <li key={r.link} className="flex items-center justify-between gap-2">
                  <span>
                    Uploaded: {r.name} ·{" "}
                    <a href={r.link} target="_blank" rel="noreferrer" className="underline">
                      View on Drive
                    </a>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove uploaded ${r.name}`}
                    onClick={() => removeUploadedReceipt(r.link)}
                    className="text-destructive underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {uploadError !== "" && (
            <p className="text-sm font-medium text-destructive">{uploadError}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-base" htmlFor="remark">
            Remark (only if receipt image is not available)
          </Label>
          <Input
            id="remark"
            className="h-12 text-base"
            maxLength={200}
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="e.g. Receipt not received from customer"
            disabled={receiptLink !== ""}
          />
          {receiptLink === "" && remark.trim() !== "" && !remarkValid && (
            <p className="text-sm font-medium text-destructive">
              Remark must have more than 3 words.
            </p>
          )}
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

        {conflicts.length > 0 && (
          <div className="space-y-2 rounded-lg border-2 border-red-500 bg-red-50 p-3">
            <p className="text-base font-bold text-red-700">
              PAYMENT CONFLICT: This Loan ID already has the same payment amount entered by
              another Executive.
            </p>
            <ul className="space-y-2 text-sm text-red-900">
              {conflicts.map((c) => (
                <li key={c.row} className="rounded-md bg-white/70 p-2">
                  <div>Loan ID: {c.loanId}</div>
                  <div>Existing Executive: {c.executive}</div>
                  <div>Existing Amount: {formatAmount(c.amount)}</div>
                  <div>
                    Existing Date/Time: {c.date} {c.time}
                  </div>
                  <div>Current Executive: {executive || "-"}</div>
                  <div>Current Amount: {formatAmount(amountNum || 0)}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {conflicts.length === 0 && duplicates.length > 0 && (
          <div className="rounded-lg border-2 border-amber-500 bg-amber-50 p-3">
            <p className="text-base font-bold text-amber-800">
              Warning: This payment is already entered for this Loan ID with the same amount.
            </p>
            <ul className="mt-2 space-y-1 text-sm text-amber-900">
              {duplicates.map((d) => (
                <li key={d.row}>
                  {d.executive} · {formatAmount(d.amount)} · {d.date} {d.time}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Button className="h-14 w-full text-lg" disabled={!valid} onClick={openConfirm}>
          Submit
        </Button>
        {!proofValid && (
          <p className="text-center text-sm text-muted-foreground">
            Upload a receipt image or write a remark of more than 3 words to enable Submit.
          </p>
        )}
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
            <Row k={isPrevious ? "Original Payment Date" : "Payment Date"} v={paymentDate} />
            <Row k="Entry Date" v={today} />
            <Row k="Entry Time" v={time} />
            <Row k="Entry Type" v={isPrevious ? "Previous Paid File" : "Normal"} />
            <Row k="Settlement Payment" v={settlement ? "Yes" : "No"} />
            <Row k="Receipt Images" v={`${receipts.length} uploaded`} />
            {receiptLink === "" && <Row k="Remark" v={remark.trim()} />}
          </dl>

          {isPrevious && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              I confirm that this payment actually belongs to the selected previous payment date and
              is being entered today because it was received in a later paid file.
            </p>
          )}
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
              <Row k="Payment Date" v={receipt.date} />
              <Row k="Entry Date" v={receipt.entryDate} />
              <Row k="Entry Time" v={receipt.time} />
              <Row k="Entry Type" v={receipt.entryType} />
              <Row k="Settlement Payment" v={receipt.settlement ? "Yes" : "No"} />
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
