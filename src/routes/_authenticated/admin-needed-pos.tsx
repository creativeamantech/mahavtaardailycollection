import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, RefreshCw, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAdminNeededPosReport } from "@/lib/admin-needed-pos.functions";

type Metric = { cases:number; paidCount:number; unpaidCount:number; collection:number; pos:number; mainPaidPos:number; rollbackPos:number };
type ExecutiveRow = Metric & { executive:string };
type CityRow = Metric & { city:string; executives:ExecutiveRow[] };
const money = (v:number) => new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(v);
const number = (v:number) => new Intl.NumberFormat("en-IN",{maximumFractionDigits:0}).format(v);
export const Route = createFileRoute("/_authenticated/admin-needed-pos")({ component: AdminNeededPosPage });

function AdminNeededPosPage() {
  const load = useServerFn(getAdminNeededPosReport);
  const { data, isLoading, error, refetch, isFetching } = useQuery({ queryKey:["admin-needed-pos-report"], queryFn:()=>load(), staleTime:0 });
  const [bucket,setBucket] = useState("1");
  const [mainTarget,setMainTarget] = useState("60");
  const [rollbackTarget,setRollbackTarget] = useState("18");
  const mainRate = Math.max(0,Number(mainTarget)||0)/100;
  const rollbackRate = Math.max(0,Number(rollbackTarget)||0)/100;
  const current = data?.buckets.find(b=>b.bucket===bucket);
  const reports = useMemo(() => (current?.cities ?? []).map(city => {
    const needed = city.pos*mainRate-city.mainPaidPos;
    const neededRollback = city.pos*rollbackRate-city.rollbackPos;
    return {city:city.city,needed,neededRollback};
  }),[current,mainRate,rollbackRate]);
  const neededRows = reports.filter(r=>r.needed>0).sort((a,b)=>b.needed-a.needed);
  const rollbackRows = reports.filter(r=>r.neededRollback>0).sort((a,b)=>b.neededRollback-a.neededRollback);
  const bucketOptions = data?.buckets.map(b=>b.bucket) ?? ["1","2","3","4","5"];
  const makeText = (title:string, rows:{city:string;needed:number;neededRollback:number}[], field:"needed"|"neededRollback") =>
    [title,"Bucket "+bucket,field==="needed"?"Main target "+mainTarget+"%":"Rollback target "+rollbackTarget+"%","City | Needed POS",...rows.map(r=>r.city+" | "+money(r[field]))].join("\n");
  async function share(title:string, rows:typeof neededRows, field:"needed"|"neededRollback") {
    if(!rows.length){toast.info("इस Bucket में 0 से अधिक Needed amount नहीं है।");return;}
    const text = makeText(title,rows,field);
    try {
      if(navigator.share) await navigator.share({title,text});
      else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);toast.success("Report copied. अब WhatsApp या किसी अन्य app में share करें.");}
      else {window.prompt("Copy report text:",text);}
    } catch(e) { if(e instanceof Error && e.name!=="AbortError") toast.error("Share नहीं हो पाया।"); }
  }
  function table(title:string, rows:typeof neededRows, field:"needed"|"neededRollback") {
    return <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div><h2 className="font-bold">{title}</h2><p className="text-xs text-muted-foreground">केवल positive amounts · {rows.length} cities</p></div><Button size="sm" variant="outline" onClick={()=>void share(title,rows,field)}><Share2 className="mr-2 size-4"/>Share</Button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[330px] text-sm"><thead className="bg-muted/60"><tr><th className="px-4 py-3 text-left">City</th><th className="px-4 py-3 text-right">Needed POS</th></tr></thead><tbody>{rows.map(r=><tr key={r.city} className="border-t"><td className="px-4 py-3 font-medium">{r.city}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{money(r[field])}</td></tr>)}{!rows.length&&<tr><td colSpan={2} className="px-4 py-8 text-center text-muted-foreground">No city has a positive needed amount for this bucket.</td></tr>}</tbody><tfoot className="border-t bg-muted/30"><tr><td className="px-4 py-3 font-bold">Total</td><td className="px-4 py-3 text-right font-bold tabular-nums">{money(rows.reduce((s,r)=>s+r[field],0))}</td></tr></tfoot></table></div>
    </section>;
  }
  return <main className="mx-auto w-full max-w-7xl space-y-5 px-3 py-5 sm:px-6">
    <header className="rounded-2xl border bg-white p-4 shadow-sm sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-amber-700">Admin only</p><h1 className="mt-1 text-xl font-extrabold">IDFC Main Performance — Needed POS</h1><p className="mt-1 text-sm text-muted-foreground">Live city-wise calculation from the current-month Master Allocation Data tab.</p></div><Button variant="outline" size="sm" onClick={()=>void refetch()} disabled={isFetching}><RefreshCw className={"mr-2 size-4 "+(isFetching?"animate-spin":"")}/>Refresh</Button></div>
    {data?.master&&<div className="mt-4 rounded-xl bg-muted/40 p-3 text-sm"><span className="font-semibold">{data.master.name}</span><a className="ml-3 text-primary underline" href={data.master.url} target="_blank" rel="noreferrer">Open Master File</a></div>}</header>
    <section className="grid gap-3 rounded-2xl border bg-white p-4 shadow-sm sm:grid-cols-3"><label className="grid gap-1 text-sm font-medium">Bucket<select value={bucket} onChange={e=>setBucket(e.target.value)} className="h-10 rounded-md border bg-background px-3">{bucketOptions.map(b=><option key={b} value={b}>Bucket {b}</option>)}</select></label><label className="grid gap-1 text-sm font-medium">Main Target %<Input type="number" min="0" max="100" step="0.1" value={mainTarget} onChange={e=>setMainTarget(e.target.value)}/></label><label className="grid gap-1 text-sm font-medium">Rollback Target %<Input type="number" min="0" max="100" step="0.1" value={rollbackTarget} onChange={e=>setRollbackTarget(e.target.value)}/></label></section>
    {isLoading&&<div className="rounded-xl border bg-white p-5 text-sm">Master File से report load हो रही है…</div>}
    {error&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error.message}</div>}
    {data&&<><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border bg-white p-4"><p className="text-xs text-muted-foreground">Allocated cases in selected bucket</p><p className="mt-1 text-2xl font-bold">{number(current?.cities.reduce((s,c)=>s+c.cases,0)??0)}</p></div><div className="rounded-xl border bg-white p-4"><p className="text-xs text-muted-foreground">Cities with positive Needed POS / Rollback</p><p className="mt-1 text-2xl font-bold">{neededRows.length} / {rollbackRows.length}</p></div></div>{table("City-wise Needed POS",neededRows,"needed")}{table("City-wise Needed Rollback POS",rollbackRows,"neededRollback")}<p className="text-xs text-muted-foreground">Formula: Needed POS = (Total POS × Main Target %) − Main Paid POS. Needed Rollback POS = (Total POS × Rollback Target %) − Rollback POS. दोनों अलग-अलग calculate होते हैं; एक दूसरे से subtract नहीं होते. केवल 0 से अधिक values दिखाई जाती हैं. Data is read-only; report refreshes from Master File.</p></>}
  </main>;
}
