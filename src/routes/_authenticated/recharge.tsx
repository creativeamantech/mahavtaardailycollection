import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getRechargeData, saveRechargeNumbers, createRechargeCredit, createRechargeRequest } from "@/lib/recharge.functions";

export const Route = createFileRoute("/_authenticated/recharge")({ component: RechargePage });
function RechargePage() {
  const client = useQueryClient();
  const load = useServerFn(getRechargeData);
  const save = useServerFn(saveRechargeNumbers);
  const credit = useServerFn(createRechargeCredit);
  const submit = useServerFn(createRechargeRequest);
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({ queryKey: ["recharge"], queryFn: () => load(), retry: 1, retryDelay: 1500 });
  const [numbers, setNumbers] = useState(["", ""]);
  const [executive, setExecutive] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [requestAmount, setRequestAmount] = useState("");
  const [selectedSlot, setSelectedSlot] = useState("1");
  const [reference, setReference] = useState("");
  const [creditFile, setCreditFile] = useState<File | null>(null);
  const [requestFile, setRequestFile] = useState<File | null>(null);
  const admin = data?.session.role === "Admin";
  async function proof(file: File | null) {
    if (!file) throw new Error("Payment screenshot select karein.");
    if (file.size > 12 * 1024 * 1024) throw new Error("Screenshot 12 MB se chhota hona chahiye.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("JPEG, PNG ya WebP screenshot upload karein.");
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = reject; reader.readAsDataURL(file);
    });
    return { name: file.name, mimeType: file.type as "image/jpeg" | "image/png" | "image/webp", base64 };
  }
  async function act(work: () => Promise<unknown>) {
    try { await work(); toast.success("Saved successfully"); await client.invalidateQueries({ queryKey: ["recharge"] }); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Operation failed"); }
  }
  if (isLoading) return <main className="mx-auto max-w-4xl p-5">Loading recharge management…</main>;
  if (isError || !data) return <main className="mx-auto max-w-xl space-y-3 p-5"><h1 className="text-xl font-bold">Recharge Management</h1><p className="text-sm text-destructive">Recharge data load nahi ho paya: {error instanceof Error ? error.message : "Unknown error"}</p><p className="text-xs text-muted-foreground">Google Sheets connection, spreadsheet access aur server configuration check karein.</p><button onClick={() => void refetch()} disabled={isFetching} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">{isFetching ? "Retrying…" : "Retry"}</button></main>;
  return <main className="mx-auto max-w-5xl space-y-5 p-4 pb-8 sm:p-6">
    <header><h1 className="text-2xl font-bold">Recharge Management</h1><p className="text-sm text-muted-foreground">Executive-wise credit and calling-number recharge ledger</p></header>
    <section className="grid grid-cols-3 gap-2">
      <Metric label="Total Credit" value={data.creditTotal}/><Metric label="Approved Used" value={data.used}/><Metric label="Available" value={data.balance}/>
    </section>
    {!admin && <section className="space-y-3 rounded-2xl border bg-card p-4">
      <h2 className="font-semibold">My calling numbers</h2><p className="text-sm text-muted-foreground">Apne maximum 2 calling numbers khud enter karein. Admin inhe sirf view kar sakta hai.</p>
      {numbers.map((n, i) => <input key={i} value={n} onChange={e => setNumbers(old => old.map((v,j) => i === j ? e.target.value : v))} placeholder={"Calling number " + (i+1)} className="w-full rounded-lg border bg-background p-3"/>)}
      <button onClick={() => void act(async () => save({ data: { numbers } }))} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground">Save numbers</button>
      <p className="text-sm">Saved: {data.numbers.join(" · ") || "No numbers saved"}</p>
    </section>}
    {admin ? <section className="space-y-3 rounded-2xl border bg-card p-4">
      <h2 className="font-semibold">Transfer credit to executive</h2>
      <select value={executive} onChange={e => setExecutive(e.target.value)} className="w-full rounded-lg border bg-background p-3"><option value="">Select executive</option>{data.executives.map(n => <option key={n}>{n}</option>)}</select>
      <input type="number" min="1" value={creditAmount} onChange={e => setCreditAmount(e.target.value)} placeholder="Total amount transferred" className="w-full rounded-lg border bg-background p-3"/>
      <input value={reference} onChange={e => setReference(e.target.value)} placeholder="Transfer reference / note (optional)" className="w-full rounded-lg border bg-background p-3"/>
      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setCreditFile(e.target.files?.[0] ?? null)} className="w-full text-sm"/>
      <button disabled={!executive || !creditAmount || Number(creditAmount) <= 0 || !creditFile} onClick={() => void act(async () => { await credit({ data: { executive, amount: Number(creditAmount), image: await proof(creditFile), reference } }); setCreditAmount(""); setReference(""); setCreditFile(null); })} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">Save credit + screenshot</button>
      <p className="text-xs text-muted-foreground">Ek executive ko total credit. Dono calling numbers isi balance ko share karenge.</p>
    </section> : <section className="space-y-3 rounded-2xl border bg-card p-4">
      <h2 className="font-semibold">Record recharge</h2>
      <select value={selectedSlot} onChange={e => setSelectedSlot(e.target.value)} className="w-full rounded-lg border bg-background p-3">{[1,2].map(slot => { const cycle = data.slotCycles?.find((item: {slot:number;available:boolean;nextAvailableAt:string|null}) => item.slot === slot); const number = data.numbers[slot-1]; return <option key={slot} value={String(slot)} disabled={!number || !cycle?.available}>Slot {slot} · {number || "Number not saved"}{cycle?.available ? " · Available" : " · Next: " + new Date(cycle?.nextAvailableAt ?? "").toLocaleDateString("en-IN")}</option>; })}</select>
      <input type="number" min="1" value={requestAmount} onChange={e => setRequestAmount(e.target.value)} placeholder="Recharge amount" className="w-full rounded-lg border bg-background p-3"/>
      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setRequestFile(e.target.files?.[0] ?? null)} className="w-full text-sm"/>
      <button disabled={!data.numbers[Number(selectedSlot)-1] || !data.slotCycles?.find((item: {slot:number}) => item.slot === Number(selectedSlot))?.available || !requestAmount || !Number.isFinite(Number(requestAmount)) || Number(requestAmount) <= 0 || !requestFile} onClick={() => void act(async () => { await submit({ data: { slot: selectedSlot, number: data.numbers[Number(selectedSlot)-1], amount: Number(requestAmount), image: await proof(requestFile) } }); setRequestAmount(""); setRequestFile(null); })} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">Save recharge record</button>
      <div className="space-y-1 text-xs text-muted-foreground">{data.slotCycles?.map((cycle: {slot:number;lastRechargeAt:string|null;nextAvailableAt:string|null;available:boolean}) => <p key={cycle.slot}>Slot {cycle.slot}: {cycle.lastRechargeAt ? "Last recharge " + new Date(cycle.lastRechargeAt).toLocaleDateString("en-IN") + " · " : ""}{cycle.available ? "Available now" : "Next recharge " + new Date(cycle.nextAvailableAt ?? "").toLocaleDateString("en-IN")}</p>)}<p>Har slot ka 28-day cycle alag hai. Next cycle ke liye number badal sakte hain; purane records safe rahenge.</p></div>
    </section>}
    <section className="space-y-3"><h2 className="font-semibold">Recharge requests</h2>
      {data.requests.length === 0 ? <p className="rounded-xl border p-4 text-sm text-muted-foreground">No requests yet.</p> : data.requests.slice().reverse().map(r => <article key={r.id} className="space-y-2 rounded-xl border bg-card p-3">
        <div className="flex flex-wrap justify-between gap-2"><b>{r.executive} · Slot {r.slot || "—"} · ₹{r.amount.toLocaleString("en-IN")}</b><span className="text-sm">{r.status}</span></div><p className="text-xs text-muted-foreground">{r.number} · {r.date}</p>
        {r.screenshot && <a href={r.screenshot} target="_blank" rel="noreferrer" className="text-sm underline">View screenshot</a>}
        
      </article>)}
    </section>
    <section className="space-y-2"><h2 className="font-semibold">Admin credit history</h2>{data.credits.slice().reverse().map(c => <div key={c.id} className="rounded-xl border bg-card p-3 text-sm"><b>{c.name} · ₹{c.amount.toLocaleString("en-IN")}</b><p className="text-xs text-muted-foreground">{c.date} · {c.by}</p>{c.screenshot && <a href={c.screenshot} target="_blank" rel="noreferrer" className="underline">View transfer proof</a>}</div>)}</section>
  </main>;
}
function Metric({label,value}:{label:string;value:number}) { return <div className="rounded-xl border bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-bold">₹{value.toLocaleString("en-IN")}</p></div>; }
