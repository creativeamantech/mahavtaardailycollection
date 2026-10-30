import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, RefreshCw, Save, LockKeyhole, ExternalLink, CheckSquare, Square, Trash2, CheckCircle2, ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PasswordGate, ADMIN_SESSION_KEY, ADMIN_CREDENTIAL_KEY } from "@/components/PasswordGate";
import { getAdminCollections, getAdminReviewState, saveAdminReviewEvents, adminUpdateCollectionRow, deleteCollectionRow } from "@/lib/mahavtaar.functions";
import { formatAmount } from "@/lib/executives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/admin-loan-audit")({
  head: () => [{ meta: [{ title: "Productivity Desk — Mahavtaar Daily Collection" }] }],
  component: AdminLoanAuditPage,
});

type Entry = {
  row: number; executive: string; loanId: string; amount: number; date: string; time?: string;
  entryDate?: string; entryType?: string; settlement?: boolean; settlementType?: "No" | "Settlement" | "Foreclosure";
  receiptLinks?: string[]; remark?: string; amansRemarks?: string; city?: string; bucket?: string; portalUrl?: string;
};

const SESSION_KEY = ADMIN_SESSION_KEY;

function receiptImage(url: string) {
  const match = url.match(/(?:id=|\/d\/)([a-zA-Z0-9_-]+)/);
  return match ? `https://lh3.googleusercontent.com/d/${match[1]}=w900` : url;
}

function parseLoanNumbers(value: string) {
  return [...new Set(value.split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean))];
}

function AdminLoanAuditPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [availableLoans, setAvailableLoans] = useState<string[]>([]);
  const [selectedLoans, setSelectedLoans] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Partial<Entry>>>({});
  const [verifiedRows, setVerifiedRows] = useState<number[]>([]);
  const [activeLoanIndex, setActiveLoanIndex] = useState(0);

  const fetchCollections = useServerFn(getAdminCollections);
  const fetchReviewState = useServerFn(getAdminReviewState);
  const saveReviewEvents = useServerFn(saveAdminReviewEvents);
  const saveRow = useServerFn(adminUpdateCollectionRow);
  const deleteRow = useServerFn(deleteCollectionRow);
  const qc = useQueryClient();

  useEffect(() => {
    const savedPassword = sessionStorage.getItem(ADMIN_CREDENTIAL_KEY) || "";
    setAdminPassword(savedPassword);
    setUnlocked(sessionStorage.getItem(SESSION_KEY) === "1" && savedPassword.length > 0);
  }, []);

  const { data = [], isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["collections"],
    queryFn: async () => {
      const result = await fetchCollections({ data: { adminPassword } });
      if (!Array.isArray(result)) throw new Error("Google Sheets से collections load नहीं हो पाए।");
      return result as Entry[];
    },
    staleTime: 10_000,
    enabled: unlocked && adminPassword.length > 0,
  });

  const { data: persistedVerifiedRows = [], refetch: refetchReviewState } = useQuery({
    queryKey: ["admin-review-state"],
    queryFn: () => fetchReviewState({ data: { adminPassword } }),
    enabled: unlocked && adminPassword.length > 0,
    staleTime: 5_000,
  });
  useEffect(() => setVerifiedRows(persistedVerifiedRows), [persistedVerifiedRows]);

  const selectedSet = useMemo(() => new Set(selectedLoans.map((s) => s.toLowerCase())), [selectedLoans]);
  const matches = useMemo(() => {
    if (selectedSet.size === 0) return [];
    return data.filter((entry) => selectedSet.has(String(entry.loanId ?? "").trim().toLowerCase()))
      .sort((a, b) => String(a.loanId).localeCompare(String(b.loanId)) ||
        (a.date || "").localeCompare(b.date || "") || a.row - b.row);
  }, [data, selectedSet]);

  const reviewGroups = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const entry of data) {
      const key = String(entry.loanId ?? "").trim();
      if (!key) continue;
      const group = map.get(key) ?? [];
      group.push(entry);
      map.set(key, group);
    }
    return [...map.entries()].map(([loan, entries]) => ({ loan, entries: entries.sort((a,b) => (a.date || "").localeCompare(b.date || "") || a.row-b.row) }))
      .sort((a,b) => a.loan.localeCompare(b.loan));
  }, [data]);
  const activeGroup = reviewGroups[activeLoanIndex];
  const activeRows = activeGroup?.entries ?? [];
  const verifiedCount = activeRows.filter(e => verifiedRows.includes(e.row)).length;
  const totalReviewAmount = activeRows.reduce((sum,e) => sum + Number(e.amount || 0), 0);
  const completedLoans = reviewGroups.filter(g => g.entries.length > 0 && g.entries.every(e => verifiedRows.includes(e.row))).length;
  async function setEntryVerified(row: number, checked: boolean) {
    const entry = data.find((item) => item.row === row);
    if (!entry) return;
    try {
      await saveReviewEvents({ data: { adminPassword, events: [{
        loanNumber: entry.loanId, collectionRow: row, action: checked ? "VERIFIED" : "UNVERIFIED",
        note: checked ? "Verified from Productivity Desk" : "Verification reverted from Productivity Desk",
      }] } });
      await refetchReviewState();
      toast.success(checked ? "Entry verified and saved to Google Sheets audit." : "Verification reverted and saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verification could not be saved.");
    }
  }
  async function verifyCurrentLoan() {
    if (!activeGroup || !activeRows.length) return;
    try {
      await saveReviewEvents({ data: { adminPassword, events: activeRows
        .filter((entry) => !verifiedRows.includes(entry.row))
        .map((entry) => ({ loanNumber: activeGroup.loan, collectionRow: entry.row, action: "VERIFIED" as const, note: "Bulk verified from Productivity Desk" })) } });
      await refetchReviewState();
      toast.success(`Loan ${activeGroup.loan} की entries Google Sheets audit में verify हो गईं।`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk verification could not be saved.");
    }
  }
  function goNextLoan() { setActiveLoanIndex(i => Math.min(i + 1, reviewGroups.length - 1)); }
  function goPreviousLoan() { setActiveLoanIndex(i => Math.max(0, i - 1)); }

  function loadLoanNumbers() {
    const parsed = parseLoanNumbers(bulkInput);
    if (!parsed.length) {
      toast.error("पहले loan numbers paste करें।");
      return;
    }
    setAvailableLoans(parsed);
    setSelectedLoans([]);
    toast.success(`${parsed.length} unique loan number(s) list में आ गए। अब जिन loans को check करना है, उन्हें select करें।`);
  }

  function setField(row: number, field: keyof Entry, value: unknown) {
    setDrafts((old) => ({ ...old, [row]: { ...old[row], [field]: value } }));
  }

  function toggleLoan(loan: string) {
    setSelectedLoans((old) => old.includes(loan) ? old.filter((x) => x !== loan) : [...old, loan]);
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

  async function removeEntry(entry: Entry) {
    const ok = window.confirm(`क्या आप Loan ${entry.loanId} की Row ${entry.row} वाली पूरी collection entry delete करना चाहते हैं? यह Google Sheet से हटेगी और वापस लाना आसान नहीं होगा।`);
    if (!ok) return;
    try {
      await deleteRow({ data: { row: entry.row } });
      setDrafts((old) => { const next = { ...old }; delete next[entry.row]; return next; });
      await qc.invalidateQueries({ queryKey: ["collections"] });
      toast.success(`Loan ${entry.loanId} की entry delete हो गई।`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Entry delete नहीं हो पाई।");
    }
  }

  if (!unlocked) return <main className="mx-auto w-full max-w-md px-4 py-12">
    <div className="mb-5 flex items-center gap-3"><LockKeyhole className="h-7 w-7"/><div><h1 className="text-2xl font-bold">Productivity Desk</h1><p className="text-sm text-muted-foreground">Admin password required</p></div></div>
    <PasswordGate label="Unlock Productivity Desk" onUnlock={() => { setAdminPassword(sessionStorage.getItem(ADMIN_CREDENTIAL_KEY) || ""); setUnlocked(true); }} />
  </main>;

  return <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6">
    <section className="overflow-hidden rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="mb-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold"><ShieldCheck className="h-3.5 w-3.5"/> ADMIN WORKSPACE</div><h1 className="text-3xl font-bold tracking-tight">Productivity Desk</h1><p className="mt-1 text-sm text-muted-foreground">One loan at a time. Review every entry together, correct mistakes, verify, and move on.</p></div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}/>Refresh</Button>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Unique loans</p><p className="mt-1 text-2xl font-bold">{reviewGroups.length}</p></div>
        <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Completed loans</p><p className="mt-1 text-2xl font-bold">{completedLoans}</p></div>
        <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Remaining loans</p><p className="mt-1 text-2xl font-bold">{Math.max(0,reviewGroups.length-completedLoans)}</p></div>
        <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Current loan entries</p><p className="mt-1 text-2xl font-bold">{activeRows.length}</p></div>
      </div>
    </section>
    {isLoading && <p className="mt-6 text-sm text-muted-foreground">Google Sheets से entries load हो रही हैं…</p>}
    {error && <p className="mt-6 text-sm text-destructive">Data load नहीं हुआ: {error instanceof Error ? error.message : "Unknown error"}</p>}
    {activeGroup && <section className="mt-5 overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 p-4">
        <div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sequential review · {activeLoanIndex+1} / {reviewGroups.length}</p><h2 className="mt-1 break-all text-xl font-bold">Loan {activeGroup.loan}</h2><p className="text-sm text-muted-foreground">{activeRows.length} entries · Combined {formatAmount(totalReviewAmount)}</p></div>
        <div className="rounded-full border bg-background px-3 py-2 text-sm font-semibold">{verifiedCount}/{activeRows.length} verified</div>
      </div>
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-3">
          {activeRows.map((entry,index) => { const d={...entry,...drafts[entry.row]}; const dirty=Boolean(drafts[entry.row]); const checked=verifiedRows.includes(entry.row); return <article key={entry.row} className={`rounded-xl border p-3 ${checked?"border-emerald-500/40 bg-emerald-500/5":""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">Entry {index+1} <span className="text-xs font-normal text-muted-foreground">· Row {entry.row}</span></p><p className="text-xs text-muted-foreground">{entry.executive} · {entry.date} {entry.time||""}</p></div><label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={checked} onChange={e=>void setEntryVerified(entry.row,e.target.checked)}/>{checked?"Verified":"Mark verified"}</label></div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">Amount</p><p className="font-semibold">{formatAmount(Number(d.amount||0))}</p></div><div><p className="text-xs text-muted-foreground">Payment date</p><p className="font-medium">{d.date||"—"}</p></div><div><p className="text-xs text-muted-foreground">Type</p><p className="font-medium">{d.entryType||"Normal"}</p></div><div><p className="text-xs text-muted-foreground">Receipts</p><p className="font-medium">{entry.receiptLinks?.length||0}</p></div></div>
            <details className="mt-3 rounded-lg border bg-background p-3"><summary className="cursor-pointer text-sm font-semibold">Edit this entry</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label>Loan number</Label><Input value={d.loanId} onChange={e=>setField(entry.row,"loanId",e.target.value)}/></div><div className="space-y-1"><Label>Amount (₹)</Label><Input type="number" min="0" step="0.01" value={d.amount} onChange={e=>setField(entry.row,"amount",Number(e.target.value))}/></div><div className="space-y-1"><Label>Payment date</Label><Input type="date" value={d.date||""} onChange={e=>setField(entry.row,"date",e.target.value)}/></div><div className="space-y-1"><Label>Executive</Label><Input value={d.executive} onChange={e=>setField(entry.row,"executive",e.target.value)}/></div><div className="space-y-1 sm:col-span-2"><Label>Remark</Label><Textarea value={d.remark||""} onChange={e=>setField(entry.row,"remark",e.target.value)}/></div><div className="space-y-1 sm:col-span-2"><Label>Admin remarks</Label><Textarea value={d.amansRemarks||""} onChange={e=>setField(entry.row,"amansRemarks",e.target.value)}/></div><div className="flex flex-wrap gap-2 sm:col-span-2"><Button size="sm" disabled={!dirty} onClick={()=>save(entry)}><Save className="mr-2 h-4 w-4"/>Save correction</Button>{entry.receiptLinks?.map((url,i)=><a key={url+i} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-xs">Receipt {i+1}<ExternalLink className="h-3 w-3"/></a>)}</div></div></details>
          </article>;})}
          <div className="flex flex-wrap gap-2"><Button onClick={verifyCurrentLoan} disabled={!activeRows.length||verifiedCount===activeRows.length}><CheckCircle2 className="mr-2 h-4 w-4"/>Verify all entries</Button><Button variant="outline" onClick={goPreviousLoan} disabled={activeLoanIndex===0}><ChevronLeft className="mr-1 h-4 w-4"/>Previous</Button><Button onClick={goNextLoan} disabled={activeLoanIndex>=reviewGroups.length-1}>Next loan<ChevronRight className="ml-1 h-4 w-4"/></Button></div>
        </div>
        <aside className="space-y-3 rounded-xl bg-muted/40 p-3"><h3 className="font-semibold">Portal workspace</h3><p className="text-sm text-muted-foreground">Embedded Salesforce view becomes available when the source collection data exposes the exact portal URL. No URL is guessed.</p>{activeRows.some(e=>e.portalUrl) ? <iframe title="Bank portal" src={activeRows.find(e=>e.portalUrl)?.portalUrl} className="h-[520px] w-full rounded-lg border bg-background"/> : <div className="rounded-lg border border-dashed bg-background p-4 text-sm text-muted-foreground">Portal URL is not currently present in the loaded collection records.</div>}<p className="text-xs text-muted-foreground">Verification history is recorded in the shared Google Sheets VerificationAudit tab after server-side password validation.</p></aside>
      </div>
    </section>}
    <div className="mt-8"><h2 className="text-lg font-bold">Bulk loan audit</h2><p className="text-sm text-muted-foreground">Paste specific loan numbers to narrow the review queue.</p></div>
    <section className="mt-3 space-y-3 rounded-xl border bg-card p-4">
      <div><h1 className="text-2xl font-bold tracking-tight">Admin Loan Audit</h1><p className="mt-1 text-sm text-muted-foreground">Bulk loan numbers paste करें, फिर checkbox से सिर्फ़ वही loans चुनें जिन्हें audit करना है।</p></div>
      <Button variant="outline" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}/>Refresh</Button>
    </div>

    <section className="mt-5 space-y-3 rounded-xl border bg-card p-4">
      <Label htmlFor="bulk-loans">Bulk loan numbers</Label>
      <Textarea id="bulk-loans" className="min-h-28" placeholder={"हर line में एक loan number paste करें…\nया comma / space / semicolon से अलग करें"} value={bulkInput} onChange={e => setBulkInput(e.target.value)}/>
      <div className="flex flex-wrap gap-2">
        <Button onClick={loadLoanNumbers}><Search className="mr-2 h-4 w-4"/>Load loan list</Button>
        {availableLoans.length > 0 && <Button type="button" variant="outline" onClick={() => setSelectedLoans([...availableLoans])}>Select all</Button>}
        {selectedLoans.length > 0 && <Button type="button" variant="outline" onClick={() => setSelectedLoans([])}>Clear selection</Button>}
      </div>
      {availableLoans.length > 0 && <div className="space-y-2 border-t pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">Choose loans to audit ({selectedLoans.length} selected of {availableLoans.length})</p><p className="text-xs text-muted-foreground">Duplicates automatically removed</p></div>
        <div className="grid gap-2 sm:grid-cols-2">
          {availableLoans.map(loan => {
            const checked = selectedLoans.includes(loan);
            const exists = data.some(entry => String(entry.loanId ?? "").trim().toLowerCase() === loan.toLowerCase());
            return <label key={loan} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${checked ? "border-primary bg-primary/5" : "bg-background"}`}>
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={checked} onChange={() => toggleLoan(loan)}/>
              {checked ? <CheckSquare className="h-4 w-4 text-primary"/> : <Square className="h-4 w-4 text-muted-foreground"/>}
              <span className="min-w-0 flex-1 break-all text-sm font-medium">{loan}</span>
              <span className={`text-xs ${exists ? "text-emerald-600" : "text-destructive"}`}>{isLoading ? "Checking…" : exists ? "Found" : "Not found"}</span>
            </label>;
          })}
        </div>
        <Button className="w-full sm:w-auto" disabled={selectedLoans.length === 0 || isLoading} onClick={() => document.getElementById("audit-results")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Show selected loans</Button>
      </div>}
    </section>

    {isLoading && <p className="mt-6">Google Sheets से entries लोड हो रही हैं…</p>}
    {error && <p className="mt-6 text-destructive">Data load नहीं हुआ: {error instanceof Error ? error.message : "Unknown error"}</p>}
    {isFetching && !isLoading && <p className="mt-3 text-xs text-muted-foreground">Google Sheets refresh हो रही है…</p>}

    {selectedLoans.length > 0 && <div id="audit-results" className="mt-5 space-y-4 scroll-mt-4">
      <div className="rounded-lg border p-3 text-sm">Selected loans: <strong>{selectedLoans.length}</strong> · Matching entries: <strong>{matches.length}</strong> · Total amount: <strong>{formatAmount(matches.reduce((sum, e) => sum + Number(e.amount || 0), 0))}</strong></div>
      {selectedLoans.map(loan => {
        const loanEntries = matches.filter(e => String(e.loanId).trim().toLowerCase() === loan.toLowerCase());
        return <div key={loan} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2"><div><h2 className="font-semibold break-all">Loan {loan}</h2><p className="text-xs text-muted-foreground">{loanEntries.length} entr{loanEntries.length === 1 ? "y" : "ies"} · {formatAmount(loanEntries.reduce((sum,e) => sum + Number(e.amount || 0),0))}</p></div><Button size="sm" variant="outline" onClick={() => toggleLoan(loan)}>Remove from selection</Button></div>
          {loanEntries.length === 0 ? <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">इस loan number की कोई entry नहीं मिली।</div> : loanEntries.map(entry => {
            const d = { ...entry, ...drafts[entry.row] };
            const dirty = Boolean(drafts[entry.row]);
            return <section key={entry.row} className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 p-3"><div><p className="font-semibold">Row {entry.row} · {entry.loanId}</p><p className="text-xs text-muted-foreground">{entry.executive} · {entry.date} {entry.time || ""} · {entry.entryType || "Normal"}</p></div><div className="flex gap-2"><Button onClick={() => save(entry)} disabled={!dirty} size="sm"><Save className="mr-2 h-4 w-4"/>Save changes</Button><Button onClick={() => removeEntry(entry)} variant="destructive" size="sm"><Trash2 className="mr-2 h-4 w-4"/>Delete entry</Button></div></div>
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
        </div>;
      })}
    </div>}
    <p className="mt-8 text-xs text-muted-foreground">Note: यह page मौजूदा Collections Google Sheet को इस्तेमाल करता है। Save करने से source sheet में बदलाव होगा।</p>
  </main>;
}
