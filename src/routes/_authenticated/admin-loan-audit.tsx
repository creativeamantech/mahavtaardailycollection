import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, RefreshCw, Save, LockKeyhole, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { PasswordGate } from "@/components/PasswordGate";
import { getCollections, updateCollectionRow } from "@/lib/mahavtaar.functions";
import { formatAmount } from "@/lib/executives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/admin-loan-audit")({
  head: () => [{ meta: [{ title: "Admin Loan Audit — Mahavtaar Daily Collection" }] }],
  component: AdminLoanAuditPage,
});

type Entry = {
  row: number; executive: string; loanId: string; amount: number; date: string; time?: string;
  entryDate?: string; entryType?: string; settlement?: boolean; settlementType?: "No" | "Settlement" | "Foreclosure";
  receiptLinks?: string[]; remark?: string; amansRemarks?: string; city?: string; bucket?: string;
};

const SESSION_KEY = "mahavtaar-admin-loan-audit-unlocked";

function receiptImage(url: string) {
  const match = url.match(/(?:id=|\/d\/)([a-zA-Z0-9_-]+)/);
  return match ? `https://lh3.googleusercontent.com/d/${match[1]}=w900` : url;
}

function AdminLoanAuditPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<number, Partial<Entry>>>({});
  const fetchCollections = useServerFn(getCollections);
  const saveRow = useServerFn(updateCollectionRow);
  const qc = useQueryClient();

  useEffect(() => setUnlocked(sessionStorage.getItem(SESSION_KEY) === "1"), []);

  const { data = [], isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["collections"],
    queryFn: async () => {
      const result = await fetchCollections();
      if (!Array.isArray(result)) throw new Error("Google Sheets से collections load नहीं हो पाए।");
      return result as Entry[];
    },
    staleTime: 10_000,
  });

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return data.filter((entry) => String(entry.loanId ?? "").trim().toLowerCase() === q ||
      String(entry.loanId ?? "").trim().toLowerCase().includes(q))
      .sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.row - b.row);
  }, [data, query]);

  function setField(row: number, field: keyof Entry, value: unknown) {
    setDrafts((old) => ({ ...old, [row]: { ...old[row], [field]: value } }));
  }

  async function save(entry: Entry) {
    const d = { ...entry, ...drafts[entry.row] };
    try {
      await saveRow({ data: {
        row: d.row, executive: d.executive, loanId: d.loanId, amount: Number(d.amount),
        date: d.date, time: d.time || "", entryDate: d.entryDate || d.date,
        entryType: d.entryType === "Previous Paid File" ? "Previous Paid File" : "Normal",
        settlement: Boolean(d.settlement), settlementType: d.settlementType || (d.settlement ? "Settlement" : "No"),
        receiptLinks: d.receiptLinks || [], remark: d.remark || "", amansRemarks: d.amansRemarks || "",
      }});
      await qc.invalidateQueries({ queryKey: ["collections"] });
      setDrafts((old) => { const next = { ...old }; delete next[entry.row]; return next; });
      toast.success(`Loan ${d.loanId} की entry (row ${entry.row}) Google Sheets में save हो गई।`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save नहीं हो पाया। कृपया फिर कोशिश करें।");
    }
  }

  if (!unlocked) return <main className="mx-auto w-full max-w-md px-4 py-12">
    <div className="mb-5 flex items-center gap-3"><LockKeyhole className="h-7 w-7"/><div><h1 className="text-2xl font-bold">Admin Loan Audit</h1><p className="text-sm text-muted-foreground">Admin password required</p></div></div>
    <PasswordGate label="Unlock Admin Audit" onUnlock={() => { sessionStorage.setItem(SESSION_KEY, "1"); setUnlocked(true); }} />
  </main>;

  return <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold tracking-tight">Admin Loan Audit</h1><p className="mt-1 text-sm text-muted-foreground">एक लोन की सभी collection entries और receipts एक जगह verify और edit करें।</p></div>
      <Button variant="outline" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}/>Refresh</Button>
    </div>
    <form className="mt-5 flex gap-2" onSubmit={e => { e.preventDefault(); setQuery(search.trim()); }}>
      <div className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input className="h-11 pl-9" placeholder="Loan number enter करें…" value={search} onChange={e => setSearch(e.target.value)}/></div>
      <Button className="h-11" type="submit">Search</Button>
    </form>
    {isLoading && <p className="mt-6">Google Sheets से entries लोड हो रही हैं…</p>}
    {error && <p className="mt-6 text-destructive">Data load नहीं हुआ: {error instanceof Error ? error.message : "Unknown error"}</p>}
    {query && <div className="mt-5 space-y-4">
      <div className="rounded-lg border p-3 text-sm">Loan search: <strong>{query}</strong> · Entries: <strong>{matches.length}</strong> · Total amount: <strong>{formatAmount(matches.reduce((sum, e) => sum + Number(e.amount || 0), 0))}</strong></div>
      {!isLoading && matches.length === 0 && <div className="rounded-xl border p-8 text-center text-muted-foreground">इस loan number की कोई entry नहीं मिली।</div>}
      {matches.map(entry => {
        const d = { ...entry, ...drafts[entry.row] };
        const dirty = Boolean(drafts[entry.row]);
        return <section key={entry.row} className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 p-3"><div><p className="font-semibold">Row {entry.row} · {entry.loanId}</p><p className="text-xs text-muted-foreground">{entry.executive} · {entry.date} {entry.time || ""} · {entry.entryType || "Normal"}</p></div><Button onClick={() => save(entry)} disabled={!dirty} size="sm"><Save className="mr-2 h-4 w-4"/>Save changes</Button></div>
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Loan number</Label><Input value={d.loanId} onChange={e => setField(entry.row,"loanId",e.target.value)}/></div>
              <div className="space-y-1"><Label>Amount (₹)</Label><Input type="number" min="0.01" step="0.01" value={d.amount} onChange={e => setField(entry.row,"amount",Number(e.target.value))}/></div>
              <div className="space-y-1"><Label>Payment date</Label><Input type="date" value={d.date || ""} onChange={e => setField(entry.row,"date",e.target.value)}/></div>
              <div className="space-y-1"><Label>Time</Label><Input value={d.time || ""} onChange={e => setField(entry.row,"time",e.target.value)}/></div>
              <div className="col-span-2 space-y-1"><Label>Executive</Label><Input value={d.executive} onChange={e => setField(entry.row,"executive",e.target.value)}/></div>
              <div className="col-span-2 space-y-1"><Label>Remark</Label><Textarea value={d.remark || ""} onChange={e => setField(entry.row,"remark",e.target.value)}/></div>
              <div className="col-span-2 space-y-1"><Label>Admin verification remarks</Label><Textarea value={d.amansRemarks || ""} onChange={e => setField(entry.row,"amansRemarks",e.target.value)}/></div>
              <p className="col-span-2 text-xs text-muted-foreground">City: {entry.city || "—"} · Bucket: {entry.bucket || "—"} · Settlement: {entry.settlementType || (entry.settlement ? "Settlement" : "No")}</p>
            </div>
            <div><h3 className="mb-2 font-semibold">Receipt images ({entry.receiptLinks?.length || 0})</h3>
              {entry.receiptLinks?.length ? <div className="grid grid-cols-2 gap-2">{entry.receiptLinks.map((url,i) => <a key={url+i} href={url} target="_blank" rel="noreferrer" className="group rounded-lg border p-2"><img src={receiptImage(url)} alt={`Receipt ${i+1} for loan ${entry.loanId}`} loading="lazy" className="h-40 w-full rounded object-contain bg-muted" onError={e => { e.currentTarget.style.display = "none"; }}/><span className="mt-1 flex items-center gap-1 text-xs underline">Open receipt <ExternalLink className="h-3 w-3"/></span></a>)}</div> : <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">इस entry के साथ receipt image link नहीं है।</p>}
            </div>
          </div>
        </section>;
      })}
    </div>}
    <p className="mt-8 text-xs text-muted-foreground">Note: यह page मौजूदा Collections Google Sheet को इस्तेमाल करता है। Save करने से source sheet में बदलाव होगा।</p>
  </main>;
}
