import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { EXECUTIVES, formatAmount } from "@/lib/executives";
import { getCurrentSession } from "@/lib/auth.functions";
import { getPending, markPendingDone, savePending } from "@/lib/mahavtaar.functions";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/pending")({
  head: () => ({
    meta: [
      { title: "Pending Receipts — Mahavtaar Daily Collection" },
      {
        name: "description",
        content:
          "Upload payment slip photos for pending loan receipts and mark them done once collected.",
      },
      { property: "og:title", content: "Pending Receipts — Mahavtaar Daily Collection" },
      {
        property: "og:description",
        content: "Upload pending payment slips and mark them done once verified.",
      },
    ],
  }),
  component: PendingPage,
});

async function fileToBase64(file: File) {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

type PendingReceipt = {
  id: string;
  row: number;
  executive: string;
  loanNumber: string;
  amount: number;
  links: string[];
  status: string;
  settlement: boolean;
  timestamp: string;
};

function formatPendingDate(value: string) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function PendingPage() {
  const qc = useQueryClient();
  const fetchPending = useServerFn(getPending);
  const save = useServerFn(savePending);
  const done = useServerFn(markPendingDone);

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

  const [loanNumber, setLoanNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [settlement, setSettlement] = useState(false);
  const [fileKey, setFileKey] = useState(0);
  const [showConfirm, setShowConfirm] = useState(false);
  const [doneTarget, setDoneTarget] = useState<{ id: string; loanNumber: string } | null>(null);
  const [queueTab, setQueueTab] = useState<"pending" | "completed">("pending");
  const [search, setSearch] = useState("");

  const { data: rawPending = [], isLoading } = useQuery({
    queryKey: ["pending"],
    queryFn: async () => {
      const res = await fetchPending();
      return Array.isArray(res) ? (res as PendingReceipt[]) : [];
    },
  });
  const records = Array.isArray(rawPending) ? rawPending : [];
  const pendingRecords = records.filter((p) => p.status === "Pending");
  const completedRecords = records.filter((p) => p.status === "Done");
  const visibleRecords = useMemo(() => {
    const source = queueTab === "pending" ? pendingRecords : completedRecords;
    const term = search.trim().toLowerCase();
    if (!term) return source;
    return source.filter(
      (p) => p.loanNumber.toLowerCase().includes(term) || p.executive.toLowerCase().includes(term),
    );
  }, [queueTab, pendingRecords, completedRecords, search]);
  const pendingTotal = pendingRecords.reduce((sum, p) => sum + p.amount, 0);

  const submit = useMutation({
    mutationFn: async () => {
      const photos = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          mimeType: f.type || "image/jpeg",
          base64: await fileToBase64(f),
        })),
      );
      return save({
        data: {
          executive,
          loanNumber: loanNumber.trim(),
          amount: Number(amount),
          settlement,
          photos,
        } as never,
      });
    },
    onSuccess: () => {
      toast.success("Pending receipt saved");
      setShowConfirm(false);
      setExecutive(session?.role === "Executive" ? session.name : "");
      setLoanNumber("");
      setAmount("");
      setFiles([]);
      setSettlement(false);
      setFileKey((k) => k + 1);
      qc.invalidateQueries({ queryKey: ["pending"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Upload failed"),
  });

  const complete = useMutation({
    mutationFn: (id: string) => done({ data: { id } as never }),
    onSuccess: () => {
      toast.success("Marked as done and added to collections");
      setDoneTarget(null);
      setQueueTab("completed");
      qc.invalidateQueries({ queryKey: ["pending"] });
      qc.invalidateQueries({ queryKey: ["collections"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update"),
  });

  const valid =
    executive !== "" && loanNumber.trim() !== "" && Number(amount) > 0 && files.length > 0;

  return (
    <main className="mx-auto w-full max-w-[1600px] bg-white px-4 pb-16 pt-5 text-slate-900 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pending Receipts</h1>
          <p className="mt-1 text-sm text-slate-600 sm:text-base">
            Upload payment slips and move verified payments into Collections.
          </p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-slate-700">
          {session?.role === "Admin"
            ? "Admin View · All Executives"
            : session?.name || "Executive View"}
        </div>
      </div>

      <section className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SummaryTile
          label="Pending Cases"
          value={pendingRecords.length.toLocaleString("en-IN")}
          detail="Awaiting confirmation"
        />
        <SummaryTile
          label="Pending Amount"
          value={formatAmount(pendingTotal)}
          detail="Total amount in pending queue"
        />
      </section>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(320px,390px)_minmax(0,1fr)] xl:gap-6">
        <section className="rounded-2xl border border-amber-200 bg-white shadow-sm">
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
            <h2 className="text-lg font-bold">New Pending Entry</h2>
            <p className="mt-0.5 text-sm text-slate-600">Add payment details and receipt photos.</p>
          </div>
          <div className="space-y-4 p-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Executive Name</Label>
              {session?.role === "Admin" ? (
                <Select value={executive} onValueChange={setExecutive}>
                  <SelectTrigger className="h-11 border-amber-200 bg-white">
                    <SelectValue placeholder="Select executive" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXECUTIVES.map((e) => (
                      <SelectItem key={e} value={e}>
                        {e}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex h-11 items-center rounded-md border border-amber-200 bg-slate-50 px-3 text-sm">
                  {sessionLoading
                    ? "Loading logged-in executive..."
                    : executive || session?.name || "Executive not available"}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="pending-loan" className="text-sm font-semibold text-slate-700">
                Loan Number
              </Label>
              <Input
                id="pending-loan"
                className="h-11 border-amber-200 focus-visible:ring-amber-300"
                maxLength={60}
                value={loanNumber}
                onChange={(e) => setLoanNumber(e.target.value)}
                placeholder="Enter loan number"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pending-amount" className="text-sm font-semibold text-slate-700">
                Pending Amount
              </Label>
              <Input
                id="pending-amount"
                type="number"
                inputMode="decimal"
                min={1}
                className="h-11 border-amber-200 focus-visible:ring-amber-300"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pending-slips" className="text-sm font-semibold text-slate-700">
                Upload Slips <span className="font-normal text-slate-500">(up to 10 photos)</span>
              </Label>
              <Input
                id="pending-slips"
                key={fileKey}
                type="file"
                accept="image/*"
                multiple
                className="min-h-11 border-amber-200 bg-white py-2 file:mr-3 file:rounded-md file:border-0 file:bg-amber-100 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-amber-950"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 10))}
              />
              <p className="text-xs text-slate-500">
                {files.length > 0
                  ? `${files.length} photo(s) selected`
                  : "At least one receipt photo is required."}
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <Checkbox
                checked={settlement}
                onCheckedChange={(v) => setSettlement(v === true)}
                className="mt-0.5 data-[state=checked]:border-amber-500 data-[state=checked]:bg-amber-400"
              />
              <span className="text-sm font-medium leading-snug text-slate-800">
                Settlement Payment
              </span>
            </label>

            <Button
              className="h-12 w-full bg-amber-300 font-bold text-amber-950 hover:bg-amber-400"
              disabled={!valid || submit.isPending}
              onClick={() => setShowConfirm(true)}
            >
              Review Entry
            </Button>
          </div>
        </section>

        <section className="min-w-0 rounded-2xl border border-amber-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3">
            <div>
              <h2 className="text-lg font-bold">Receipt Queue</h2>
              <p className="mt-0.5 text-sm text-slate-600">
                Review submitted slips and confirm collection.
              </p>
            </div>
            <div
              className="inline-flex rounded-lg border border-amber-200 bg-white p-1"
              role="tablist"
              aria-label="Receipt status"
            >
              <button
                type="button"
                role="tab"
                aria-selected={queueTab === "pending"}
                onClick={() => setQueueTab("pending")}
                className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${queueTab === "pending" ? "bg-amber-300 text-amber-950 shadow-sm" : "text-slate-600 hover:bg-amber-50"}`}
              >
                Pending ({pendingRecords.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={queueTab === "completed"}
                onClick={() => setQueueTab("completed")}
                className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${queueTab === "completed" ? "bg-amber-300 text-amber-950 shadow-sm" : "text-slate-600 hover:bg-amber-50"}`}
              >
                Completed ({completedRecords.length})
              </button>
            </div>
          </div>

          <div className="border-b border-amber-100 p-4">
            <Input
              aria-label="Search pending receipts"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by loan number or executive..."
              className="h-11 border-amber-200 bg-white focus-visible:ring-amber-300"
            />
          </div>

          <div className="space-y-3 p-4">
            {isLoading && (
              <p className="rounded-lg border border-amber-100 p-6 text-center text-sm text-slate-500">
                Loading receipts...
              </p>
            )}
            {!isLoading && visibleRecords.length === 0 && (
              <p className="rounded-xl border border-dashed border-amber-200 bg-amber-50/40 p-8 text-center text-sm text-slate-500">
                {search.trim()
                  ? "No receipts match your search."
                  : queueTab === "pending"
                    ? "No pending receipts."
                    : "No completed receipts yet."}
              </p>
            )}
            {!isLoading &&
              visibleRecords.map((p) => (
                <article
                  key={p.id}
                  className="rounded-xl border border-amber-100 bg-white p-4 transition-shadow hover:shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-all text-lg font-bold tracking-tight text-slate-900">
                        {p.loanNumber}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">{p.executive}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatPendingDate(p.timestamp)}
                      </p>
                      {p.settlement && (
                        <span className="mt-2 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">
                          Settlement
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="whitespace-nowrap text-lg font-bold tabular-nums text-slate-900">
                        {formatAmount(p.amount)}
                      </p>
                      {queueTab === "pending" ? (
                        <Button
                          className="h-10 bg-amber-300 px-4 font-semibold text-amber-950 hover:bg-amber-400"
                          onClick={() => setDoneTarget({ id: p.id, loanNumber: p.loanNumber })}
                        >
                          Mark Done
                        </Button>
                      ) : (
                        <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                          Done
                        </span>
                      )}
                    </div>
                  </div>
                  {p.links.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                      <span className="mr-1 text-xs font-medium text-slate-500">Receipts:</span>
                      {p.links.map((link, i) => (
                        <a
                          key={link}
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-950 underline-offset-2 hover:bg-amber-100 hover:underline"
                        >
                          Slip {i + 1}
                        </a>
                      ))}
                    </div>
                  )}
                </article>
              ))}
          </div>
        </section>
      </div>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl">Confirm pending receipt</DialogTitle>
            <DialogDescription>Photos will be uploaded after you confirm.</DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 text-base">
            <Line k="Executive" v={executive} />
            <Line k="Loan Number" v={loanNumber} />
            <Line k="Pending Amount" v={formatAmount(Number(amount) || 0)} />
            <Line k="Photos" v={`${files.length}`} />
            <Line k="Settlement Payment" v={settlement ? "Yes" : "No"} />
          </dl>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              className="h-12 text-base"
              onClick={() => setShowConfirm(false)}
            >
              Cancel / Edit
            </Button>
            <Button
              className="h-12 bg-amber-300 text-base text-amber-950 hover:bg-amber-400"
              disabled={submit.isPending}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? "Uploading..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={doneTarget !== null} onOpenChange={(o) => !o && setDoneTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl">Mark as done?</DialogTitle>
            <DialogDescription>
              Loan {doneTarget?.loanNumber} will be added to Collections and removed from the
              pending queue.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              className="h-12 text-base"
              onClick={() => setDoneTarget(null)}
            >
              Cancel
            </Button>
            <Button
              className="h-12 bg-amber-300 text-base text-amber-950 hover:bg-amber-400"
              disabled={complete.isPending}
              onClick={() => doneTarget && complete.mutate(doneTarget.id)}
            >
              {complete.isPending ? "Updating..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function SummaryTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b pb-1">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-semibold">{v}</dd>
    </div>
  );
}
