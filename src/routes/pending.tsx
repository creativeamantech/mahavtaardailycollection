import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { EXECUTIVES, formatAmount } from "@/lib/executives";
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

export const Route = createFileRoute("/pending")({
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

function PendingPage() {
  const qc = useQueryClient();
  const fetchPending = useServerFn(getPending);
  const save = useServerFn(savePending);
  const done = useServerFn(markPendingDone);

  const [executive, setExecutive] = useState("");
  const [loanNumber, setLoanNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [doneTarget, setDoneTarget] = useState<{ id: string; loanNumber: string } | null>(null);

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ["pending"],
    queryFn: () => fetchPending(),
  });

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
          photos,
        } as never,
      });
    },
    onSuccess: () => {
      toast.success("Pending receipt saved");
      setShowConfirm(false);
      setExecutive("");
      setLoanNumber("");
      setAmount("");
      setFiles([]);
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
      qc.invalidateQueries({ queryKey: ["pending"] });
      qc.invalidateQueries({ queryKey: ["collections"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update"),
  });

  const valid =
    executive !== "" && loanNumber.trim() !== "" && Number(amount) > 0 && files.length > 0;

  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-16 pt-6">
      <h1 className="text-3xl font-bold tracking-tight">Pending Receipts</h1>
      <p className="mt-1 text-base text-muted-foreground">
        Upload slips now, mark done once the payment is collected.
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
          <Label className="text-base" htmlFor="ln">
            Loan Number
          </Label>
          <Input
            id="ln"
            className="h-12 text-base"
            maxLength={60}
            value={loanNumber}
            onChange={(e) => setLoanNumber(e.target.value)}
            placeholder="Enter loan number"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-base" htmlFor="pa">
            Pending Amount
          </Label>
          <Input
            id="pa"
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
          <Label className="text-base" htmlFor="slips">
            Upload Slips (multiple photos allowed)
          </Label>
          <Input
            id="slips"
            type="file"
            accept="image/*"
            multiple
            className="h-12 text-base"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 10))}
          />
          {files.length > 0 && (
            <p className="text-sm text-muted-foreground">{files.length} photo(s) selected</p>
          )}
        </div>

        <Button
          className="h-14 w-full text-lg"
          disabled={!valid || submit.isPending}
          onClick={() => setShowConfirm(true)}
        >
          Submit
        </Button>
      </div>

      <h2 className="mt-10 text-2xl font-bold">Pending List</h2>
      {isLoading && <p className="mt-3 text-base">Loading...</p>}
      {!isLoading && pending.length === 0 && (
        <p className="mt-3 rounded-xl border p-6 text-center text-base">No pending receipts.</p>
      )}
      <div className="mt-3 space-y-3">
        {pending.map((p) => (
          <div key={p.id} className="rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">{p.loanNumber}</p>
                <p className="text-base text-muted-foreground">
                  {p.executive} · {formatAmount(p.amount)}
                </p>
              </div>
              <Button
                className="h-11 text-base"
                onClick={() => setDoneTarget({ id: p.id, loanNumber: p.loanNumber })}
              >
                Done
              </Button>
            </div>
            {p.links.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-3">
                {p.links.map((l, i) => (
                  <a
                    key={l}
                    href={l}
                    target="_blank"
                    rel="noreferrer"
                    className="text-base text-primary underline"
                  >
                    Slip {i + 1}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
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
          </dl>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" className="h-12 text-base" onClick={() => setShowConfirm(false)}>
              Cancel / Edit
            </Button>
            <Button
              className="h-12 text-base"
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
              Loan {doneTarget?.loanNumber} will be removed from pending and counted in the
              collection report.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" className="h-12 text-base" onClick={() => setDoneTarget(null)}>
              Cancel
            </Button>
            <Button
              className="h-12 text-base"
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

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b pb-1">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-semibold">{v}</dd>
    </div>
  );
}
