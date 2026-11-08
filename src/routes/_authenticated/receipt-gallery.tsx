import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatAmount } from "@/lib/executives";
import { getReceiptGallery, setReceiptValidity } from "@/lib/receipt-gallery.functions";

export const Route = createFileRoute("/_authenticated/receipt-gallery")({
  head: () => ({ meta: [{ title: "Receipt Gallery — Mahavtaar Daily Collection" }] }),
  component: ReceiptGalleryPage,
});

type GalleryReceipt = {
  key: string; rowNumber: number; loanNumber: string; executive: string;
  paymentDate: string; amount: number; url: string; status: string;
  reason: string; markedBy: string; markedAt: string;
};

function imagePreview(url: string) {
  const id = /(?:id=|\/d\/)([a-zA-Z0-9_-]{20,})/.exec(url)?.[1];
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w900` : url;
}

function ReceiptGalleryPage() {
  const qc = useQueryClient();
  const fetchGallery = useServerFn(getReceiptGallery);
  const updateValidity = useServerFn(setReceiptValidity);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "invalid">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [dialogStatus, setDialogStatus] = useState<"Invalid" | "Valid" | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["receipt-gallery"],
    queryFn: async () => {
      const result = await fetchGallery();
      return (result?.receipts ?? []) as GalleryReceipt[];
    },
  });
  const receipts = data ?? [];
  const invalidCount = receipts.filter((item) => item.status === "Invalid").length;
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return receipts.filter((item) => {
      if (tab === "invalid" && item.status !== "Invalid") return false;
      if (!term) return true;
      return [item.loanNumber, item.executive, item.paymentDate].some((value) => String(value ?? "").toLowerCase().includes(term));
    });
  }, [receipts, search, tab]);

  const mutation = useMutation({
    mutationFn: (status: "Invalid" | "Valid") => updateValidity({
      data: { receiptKeys: selected, status, reason: status === "Invalid" ? reason.trim() : "" } as never,
    }),
    onSuccess: (result) => {
      toast.success(`${result.updated} receipt(s) marked ${result.status.toLowerCase()}`);
      setSelected([]);
      setReason("");
      setDialogStatus(null);
      qc.invalidateQueries({ queryKey: ["receipt-gallery"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update receipt status"),
  });

  const toggle = (key: string, checked: boolean) =>
    setSelected((current) => checked ? [...new Set([...current, key])] : current.filter((item) => item !== key));
  const allVisibleSelected = visible.length > 0 && visible.every((item) => selected.includes(item.key));

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-5 text-slate-900 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Receipt Gallery</h1>
          <p className="mt-1 text-sm text-slate-600">Review collection receipts by loan number and flag invalid slips.</p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
      </div>

      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Summary label="Total Receipts" value={receipts.length} />
        <Summary label="Invalid Receipts" value={invalidCount} />
        <Summary label="Selected" value={selected.length} />
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button onClick={() => { setTab("all"); setSelected([]); }} className={tab === "all" ? "rounded-md bg-white px-3 py-2 text-sm font-semibold shadow-sm" : "px-3 py-2 text-sm text-slate-600"}>All Receipts</button>
            <button onClick={() => { setTab("invalid"); setSelected([]); }} className={tab === "invalid" ? "rounded-md bg-white px-3 py-2 text-sm font-semibold shadow-sm" : "px-3 py-2 text-sm text-slate-600"}>Invalid ({invalidCount})</button>
          </div>
          <p className="text-xs text-slate-500">Original receipt files are never deleted.</p>
        </div>

        <div className="mt-3">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by loan number, executive or date..." className="h-11" />
        </div>

        {selected.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <span className="mr-auto text-sm font-semibold">{selected.length} selected</span>
            <Button variant="outline" size="sm" onClick={() => setSelected([])}>Clear</Button>
            {tab === "all" ? (
              <Button size="sm" className="bg-rose-600 text-white hover:bg-rose-700" onClick={() => setDialogStatus("Invalid")}>Mark Invalid</Button>
            ) : (
              <Button size="sm" onClick={() => setDialogStatus("Valid")}>Restore as Valid</Button>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2 border-b border-slate-100 pb-3">
          <Checkbox checked={allVisibleSelected} onCheckedChange={(value) => setSelected((current) => value === true ? [...new Set([...current, ...visible.map((item) => item.key)])] : current.filter((key) => !visible.some((item) => item.key === key)))} />
          <span className="text-sm font-medium text-slate-700">Select all visible receipts</span>
        </div>

        {isLoading && <p className="p-10 text-center text-sm text-slate-500">Loading receipt gallery...</p>}
        {isError && <p className="p-10 text-center text-sm text-rose-600">Could not load receipts. Please refresh.</p>}
        {!isLoading && !isError && visible.length === 0 && (
          <p className="p-10 text-center text-sm text-slate-500">{tab === "invalid" ? "No invalid receipts found." : "No receipt images found in Collections."}</p>
        )}

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((item) => (
            <article key={item.key} className={`overflow-hidden rounded-xl border bg-white ${item.status === "Invalid" ? "border-rose-300" : "border-slate-200"}`}>
              <div className="relative aspect-[4/3] bg-slate-100">
                <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open receipt for loan ${item.loanNumber}`}>
                  <img src={imagePreview(item.url)} alt={`Receipt for loan ${item.loanNumber}`} loading="lazy" className="h-full w-full object-contain" />
                </a>
                <div className="absolute left-3 top-3 rounded-md bg-white/95 p-1 shadow">
                  <Checkbox checked={selected.includes(item.key)} onCheckedChange={(value) => toggle(item.key, value === true)} aria-label={`Select receipt for loan ${item.loanNumber}`} />
                </div>
                {item.status === "Invalid" && <span className="absolute right-3 top-3 rounded-full bg-rose-600 px-3 py-1 text-xs font-bold text-white">INVALID</span>}
              </div>
              <div className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="break-all text-base font-bold">{item.loanNumber}</p><p className="text-xs text-slate-500">Loan Number · Row {item.rowNumber}</p></div>
                  <span className="shrink-0 text-sm font-bold tabular-nums">{formatAmount(Number(item.amount) || 0)}</span>
                </div>
                <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-600"><span>{item.executive}</span><span>{item.paymentDate || "Date unavailable"}</span></div>
                {item.status === "Invalid" && <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-800"><p className="font-semibold">Reason: {item.reason || "Not provided"}</p><p className="mt-1">Marked by {item.markedBy || "Admin"} · {item.markedAt ? new Date(item.markedAt).toLocaleString("en-IN") : ""}</p></div>}
              </div>
            </article>
          ))}
        </div>
      </section>

      <Dialog open={dialogStatus !== null} onOpenChange={(open) => !open && setDialogStatus(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogStatus === "Invalid" ? "Mark selected receipts invalid?" : "Restore selected receipts?"}</DialogTitle>
            <DialogDescription>{dialogStatus === "Invalid" ? "This only flags the receipts for review. The original images and collection entries remain unchanged." : "The selected receipts will be moved back to the valid list."}</DialogDescription>
          </DialogHeader>
          {dialogStatus === "Invalid" && <div className="space-y-2"><label htmlFor="receipt-invalid-reason" className="text-sm font-medium">Reason (optional)</label><Textarea id="receipt-invalid-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. unclear image, wrong loan number..." maxLength={300} /></div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogStatus(null)}>Cancel</Button>
            <Button disabled={mutation.isPending} className={dialogStatus === "Invalid" ? "bg-rose-600 text-white hover:bg-rose-700" : ""} onClick={() => dialogStatus && mutation.mutate(dialogStatus)}>{mutation.isPending ? "Saving..." : "Confirm"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value.toLocaleString("en-IN")}</p></div>;
}
