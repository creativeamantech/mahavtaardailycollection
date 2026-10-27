import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatAmount } from "@/lib/executives";
import { updateAmansRemarks, updateCollectionRow } from "@/lib/mahavtaar.functions";
import { fetchDriveReceiptBase64 } from "@/lib/receipt-ocr.functions";
import {
  compareReceiptWithEntry,
  type ParsedReceiptResult,
  scanReceiptOcr,
} from "@/lib/receipt-ocr";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface AuditableCollectionRow {
  row?: number;
  executive: string;
  loanId: string;
  amount: number;
  date: string;
  time?: string;
  entryDate?: string;
  entryType?: string;
  settlement?: boolean;
  settlementType?: string;
  receiptLinks?: string[];
  remark?: string;
  amansRemarks?: string;
}

export function ReceiptOcrAuditDialog({
  item,
  onClose,
  onSuccess,
}: {
  item: AuditableCollectionRow | null;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const fetchReceiptImg = useServerFn(fetchDriveReceiptBase64);
  const saveRemarkOnly = useServerFn(updateAmansRemarks);
  const saveFullRow = useServerFn(updateCollectionRow);
  const qc = useQueryClient();

  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<ParsedReceiptResult | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [saving, setSaving] = useState(false);

  const receiptUrl = item?.receiptLinks?.[0] ?? "";

  useEffect(() => {
    if (!item || !receiptUrl) {
      setOcrResult(null);
      setPreviewDataUrl(null);
      setError("");
      return;
    }

    let cancelled = false;
    async function runAudit() {
      setScanning(true);
      setProgress(5);
      setError("");
      setOcrResult(null);
      try {
        const res = (await fetchReceiptImg({ data: { receiptUrl } })) as {
          dataUrl: string;
          parsed?: ParsedReceiptResult;
        };
        if (cancelled) return;
        setPreviewDataUrl(res.dataUrl);
        if (res.parsed) {
          setProgress(100);
          setOcrResult(res.parsed);
        } else {
          const parsed = await scanReceiptOcr(res.dataUrl, (pct) => {
            if (!cancelled) setProgress(pct);
          });
          if (!cancelled) {
            setOcrResult(parsed);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to scan receipt image.");
        }
      } finally {
        if (!cancelled) {
          setScanning(false);
          setProgress(0);
        }
      }
    }

    void runAudit();
    return () => {
      cancelled = true;
    };
  }, [item, receiptUrl, fetchReceiptImg]);

  const comparison = useMemo(
    () =>
      ocrResult && item
        ? compareReceiptWithEntry(ocrResult, {
            amount: item.amount,
            date: item.date,
            time: item.time,
            loanId: item.loanId,
          })
        : null,
    [ocrResult, item],
  );

  async function handleSaveAmansRemarkOnly() {
    if (!item?.row || !comparison) return;
    setSaving(true);
    try {
      await saveRemarkOnly({
        data: {
          row: item.row,
          remarks: comparison.amansRemarkText,
        },
      });
      toast.success(`Aman's Remarks updated for Row ${item.row}`);
      await qc.invalidateQueries({ queryKey: ["collections"] });
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update Aman's Remarks");
    } finally {
      setSaving(false);
    }
  }

  async function handleApplyFixesAndSave() {
    if (!item?.row || !comparison || !ocrResult) return;
    setSaving(true);
    try {
      const correctedAmount = comparison.suggestedAmount ?? item.amount;
      const correctedDate = comparison.suggestedDate ?? item.date;
      const correctedTime = comparison.suggestedTime || item.time || "";
      const correctedLoanId = comparison.suggestedLoanId || item.loanId;

      await saveFullRow({
        data: {
          row: item.row,
          executive: item.executive,
          loanId: correctedLoanId,
          amount: correctedAmount,
          date: correctedDate,
          time: correctedTime,
          entryDate: item.entryDate || correctedDate,
          entryType: item.entryType === "Previous Paid File" ? "Previous Paid File" : "Normal",
          settlement: Boolean(item.settlement),
          settlementType:
            item.settlementType === "Foreclosure"
              ? "Foreclosure"
              : item.settlementType === "Settlement"
                ? "Settlement"
                : "No",
          receiptLinks: item.receiptLinks ?? [],
          remark: item.remark ?? "",
          amansRemarks: comparison.amansRemarkText,
        },
      });
      toast.success(`Row ${item.row} updated with OCR values & Aman's Remarks!`);
      await qc.invalidateQueries({ queryKey: ["collections"] });
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update row in sheet");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Receipt AI Scanner · Loan {item?.loanId ?? "—"} {item?.row ? `(Row ${item.row})` : ""}
          </DialogTitle>
          <DialogDescription>
            AI verification comparing the Google Drive receipt image against the Google Sheet entry.
          </DialogDescription>
        </DialogHeader>

        {scanning && (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
            <div className="flex items-center justify-between font-medium text-slate-800">
              <span>Downloading &amp; analyzing receipt image with AI...</span>
              <span className="font-mono tabular-nums">{progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-slate-900 transition-all duration-150"
                style={{ width: `${Math.max(10, progress)}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {!scanning && ocrResult && comparison && item && (
          <div className="grid gap-4 md:grid-cols-12">
            {/* Receipt Preview Column */}
            <div className="md:col-span-5">
              {previewDataUrl ? (
                <img
                  src={previewDataUrl}
                  alt={`Receipt for ${item.loanId}`}
                  referrerPolicy="no-referrer"
                  className="max-h-96 w-full rounded-lg border border-slate-200 object-contain bg-slate-100"
                />
              ) : null}
            </div>

            {/* Side-by-Side Comparison Column */}
            <div className="space-y-3 md:col-span-7">
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 font-mono text-xs tabular-nums">
                <div className="grid grid-cols-3 border-b border-slate-200 pb-2 font-sans font-semibold text-slate-700">
                  <span>Field</span>
                  <span>Sheet Row</span>
                  <span>Receipt OCR</span>
                </div>

                <div className="divide-y divide-slate-200/80">
                  <div className="grid grid-cols-3 items-center py-2">
                    <span className="font-sans text-slate-600">Status</span>
                    <span>Confirmed</span>
                    <span
                      className={`font-semibold ${
                        ocrResult.transactionStatus === "SUCCESS"
                          ? "text-emerald-700"
                          : "text-red-700"
                      }`}
                    >
                      {ocrResult.transactionStatus}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 items-center py-2">
                    <span className="font-sans text-slate-600">Amount</span>
                    <span>{formatAmount(item.amount)}</span>
                    <span
                      className={`font-semibold ${
                        comparison.amountMatches ? "text-emerald-700" : "text-amber-700"
                      }`}
                    >
                      {ocrResult.effectiveAmount !== null
                        ? formatAmount(ocrResult.effectiveAmount)
                        : "Not detected"}
                      {ocrResult.convenienceFee ? ` (Total ₹${ocrResult.totalPaidAmount})` : ""}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 items-center py-2">
                    <span className="font-sans text-slate-600">Payment Date</span>
                    <span>{item.date}</span>
                    <span
                      className={`font-semibold ${
                        comparison.dateMatches ? "text-emerald-700" : "text-amber-700"
                      }`}
                    >
                      {ocrResult.paymentDate ?? "Not detected"}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 items-center py-2">
                    <span className="font-sans text-slate-600">Time</span>
                    <span>{item.time || "—"}</span>
                    <span>{ocrResult.paymentTime ?? "—"}</span>
                  </div>

                  <div className="grid grid-cols-3 items-center py-2">
                    <span className="font-sans text-slate-600">Loan ID</span>
                    <span>{item.loanId}</span>
                    <span
                      className={`font-semibold ${
                        comparison.loanIdMatches === false ? "text-red-700" : "text-slate-800"
                      }`}
                    >
                      {ocrResult.loanId ?? "—"}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 items-center py-2">
                    <span className="font-sans text-slate-600">App / UTR</span>
                    <span>{item.executive}</span>
                    <span>
                      {ocrResult.paymentApp ?? "UPI"}
                      {ocrResult.utrNumber ? ` · ${ocrResult.utrNumber}` : ""}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs">
                <p className="font-semibold text-slate-700">
                  Suggested Aman&apos;s Remarks (Column S):
                </p>
                <p className="mt-1 text-slate-900">{comparison.amansRemarkText}</p>
              </div>

              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setShowRaw((v) => !v)}
                >
                  {showRaw ? "Hide Raw OCR Text" : "Show Raw OCR Text"}
                </Button>
              </div>

              {showRaw && (
                <pre className="max-h-32 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] whitespace-pre-wrap text-slate-700">
                  {ocrResult.rawText || "No text extracted."}
                </pre>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Close
          </Button>
          {item?.row && comparison && (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={saving || scanning}
                onClick={handleSaveAmansRemarkOnly}
              >
                {saving ? "Saving..." : "Write to Aman's Remarks Only"}
              </Button>
              {(!comparison.amountMatches || !comparison.dateMatches) && (
                <Button
                  type="button"
                  disabled={saving || scanning}
                  onClick={handleApplyFixesAndSave}
                >
                  {saving ? "Updating..." : "Fix Sheet Amount/Date & Save Remark"}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
