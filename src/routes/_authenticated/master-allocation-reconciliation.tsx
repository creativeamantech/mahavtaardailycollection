import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMasterAllocationReconciliation, previewMasterAllocationReconciliation, applyMasterAllocationReconciliation, uploadPaidFileSnapshot } from "@/lib/master-allocation-reconciliation.functions";

type FileItem={id:string;name:string;sequence:number;modifiedTime:string;url:string};
type LoanRow={loan:string;row:number;oldTotal:number;newTotal:number;remaining:number;date:string;dac:number;ecs:number|null;special:number|null;status:string};
type Preview={file:{id:string;name:string;sequence:number};rows:LoanRow[];notFoundLoans:string[];counts:{master:number;found:number;notFound:number;zeroZero:number;duplicates:number;invalid:number;pending:number;overpaid:number;manualReview:number};fingerprint:string;sequence:number};
const money=(v:number)=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(v);
export const Route=createFileRoute("/_authenticated/master-allocation-reconciliation")({component:ReconciliationPage});
function ReconciliationPage(){
  const qc=useQueryClient();
  const load=useServerFn(getMasterAllocationReconciliation), previewFn=useServerFn(previewMasterAllocationReconciliation), applyFn=useServerFn(applyMasterAllocationReconciliation);
  const {data,isLoading,error}=useQuery({queryKey:["master-allocation-reconciliation"],queryFn:()=>load(),staleTime:0});
  const [selected,setSelected]=useState<Preview|null>(null);
  const [fileChoice,setFileChoice]=useState("auto");
  const [uploading,setUploading]=useState(false);
  const [uploadSequence,setUploadSequence]=useState(1);
  const previewMutation=useMutation({mutationFn:(fileId:string)=>previewFn({data:{fileId}}),onSuccess:r=>{setSelected(r as Preview);toast.success("Read-only preview ready. Master Data has not been changed.");},onError:e=>toast.error(e.message)});
  const applyMutation=useMutation({mutationFn:()=>{if(!selected)throw new Error("Preview a Paid File first.");return applyFn({data:{fileId:selected.file.id,fingerprint:selected.fingerprint,confirm:true}});},onSuccess:async r=>{toast.success("Applied "+r.applied+" Master Allocation loans. Audit and snapshot state recorded.");setSelected(null);await qc.invalidateQueries({queryKey:["master-allocation-reconciliation"]});},onError:e=>toast.error(e.message)});
  const files=(data?.files??[]) as FileItem[];
  const counts=selected?.counts;
  const eligibleCount=selected?.rows.filter(r=>r.status==="Ready"||r.status==="Overpaid").length??0;
  const busy=previewMutation.isPending||applyMutation.isPending||uploading;
  const autoFile=files.reduce<FileItem|null>((latest,file)=>!latest||file.sequence>latest.sequence?file:latest,null);
  const chosenFile=fileChoice==="auto"?autoFile:files.find(file=>file.id===fileChoice)??null;
  const uploadPaidFile=async(file:File)=>{
    const ext=file.name.toLowerCase().split(".").pop();
    const types:Record<string,string>={xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",xls:"application/vnd.ms-excel",csv:"text/csv"};
    const mimeType=types[ext??""];
    if(!mimeType){toast.error("केवल .xlsx, .xls या .csv फ़ाइल चुनें।");return;}
    if(file.size>15*1024*1024){toast.error("फ़ाइल 15 MB से छोटी होनी चाहिए।");return;}
    setUploading(true);
    try{
      const bytes=new Uint8Array(await file.arrayBuffer());let binary="";
      for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
      const base64=btoa(binary);
      const result=await uploadPaidFileSnapshot({data:{fileName:file.name,mimeType:mimeType as "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"|"application/vnd.ms-excel"|"text/csv",base64,sequence:uploadSequence}});
      toast.success("Paid File Google Sheet में upload और convert हो गई: "+result.name);
      setFileChoice(result.id);setSelected(null);
      await qc.invalidateQueries({queryKey:["master-allocation-reconciliation"]});
    }catch(e){toast.error(e instanceof Error?e.message:"Paid File upload failed.");}
    finally{setUploading(false);}
  };

  return <main className="mx-auto w-full max-w-7xl space-y-5 px-3 py-5 sm:px-6">
    <header className="rounded-2xl border bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800"><FileSpreadsheet/></span><div className="min-w-0"><h1 className="text-xl font-extrabold">Master Allocation Reconciliation</h1><p className="mt-1 text-sm text-muted-foreground">Current-month Master Allocation is selected automatically. Same-day Paid File Google Sheets are listed by sequence.</p></div></div>
      {data?.master&&<div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/40 p-3"><div><p className="text-xs text-muted-foreground">Current Master Allocation</p><p className="text-sm font-semibold">{data.master.name}</p></div><a className="text-sm font-semibold text-primary underline" href={data.master.url} target="_blank" rel="noreferrer">Open Master Sheet</a></div>}
    </header>
    {isLoading&&<p className="rounded-xl border bg-white p-4 text-sm">Loading Master Allocation and Paid Files…</p>}
    {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error.message}</p>}
    <section className="rounded-2xl border bg-white p-4 shadow-sm sm:p-5"><h2 className="font-bold">Upload Paid File manually</h2><p className="mt-1 text-xs text-muted-foreground">Admin upload only · XLSX, XLS या CSV · अधिकतम 15 MB. फ़ाइल Drive में native Google Sheet में convert होगी; Master Allocation पर कोई बदलाव नहीं होगा।</p><div className="mt-3 grid gap-3 sm:grid-cols-[150px_1fr] sm:items-end"><label className="grid gap-1 text-sm font-medium">Snapshot sequence<input type="number" min={1} max={9999} value={uploadSequence} onChange={e=>setUploadSequence(Math.max(1,Number(e.target.value)||1))} className="h-10 rounded-md border bg-background px-3"/></label><label className="grid gap-1 text-sm font-medium">Choose Paid File<input type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void uploadPaidFile(file);e.currentTarget.value="";}} className="block w-full rounded-md border bg-background p-2 text-sm"/></label></div>{uploading&&<p className="mt-2 text-sm">Uploading and converting to Google Sheets…</p>}</section>
    <section className="rounded-2xl border bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-bold">Available Paid File snapshots</h2><p className="text-xs text-muted-foreground">Only files matching today’s date and the exact Paid File naming pattern are listed. Extra loan IDs outside Master Data are ignored.</p></div><Button variant="outline" size="sm" onClick={()=>void qc.invalidateQueries({queryKey:["master-allocation-reconciliation"]})}><RefreshCw className="mr-2 size-4"/>Refresh</Button></div>
      {!isLoading&&!files.length&&<p className="mt-4 rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">No same-day Paid File Google Sheets found.</p>}
      <div className="mt-4 grid gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-[1fr_auto] sm:items-end"><label className="grid gap-1.5 text-sm font-medium">Paid File snapshot to preview<select className="h-10 w-full rounded-md border bg-background px-3 text-sm font-normal" value={fileChoice} onChange={e=>{setFileChoice(e.target.value);setSelected(null);}} disabled={busy||!files.length}><option value="auto">Auto-detect — latest sequence{autoFile?" ("+autoFile.name+")":""}</option>{files.map(file=><option key={file.id} value={file.id}>Select manually — #{file.sequence} · {file.name}</option>)}</select></label><Button disabled={busy||!chosenFile} onClick={()=>chosenFile&&previewMutation.mutate(chosenFile.id)}>{previewMutation.isPending?"Preparing preview…":"Preview selected snapshot"}</Button><p className="text-xs text-muted-foreground sm:col-span-2">Auto-detect chooses the highest available snapshot sequence. Choose any listed snapshot to override it; only the snapshot previewed here can be approved and applied.</p></div><div className="mt-3 divide-y rounded-xl border">{files.map(file=><div key={file.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="break-all text-sm font-semibold">{file.name}</p><p className="mt-1 text-xs text-muted-foreground">Snapshot sequence: {file.sequence}{file.modifiedTime?" · Updated "+new Date(file.modifiedTime).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"}):""}{chosenFile?.id===file.id?" · Selected":""}</p></div><a href={file.url} target="_blank" rel="noreferrer" className="inline-flex h-9 shrink-0 items-center rounded-md border px-3 text-xs font-medium">Open</a></div>)}</div>
    </section>
    {selected&&counts&&<section className="space-y-4 rounded-2xl border bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-bold">Read-only preview</h2><p className="text-xs text-muted-foreground">{selected.file.name} · sequence {selected.sequence}</p></div><span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800"><ShieldCheck className="size-3"/>No write-back yet</span></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">{[["Master loans",counts.master],["Found",counts.found],["Not found",counts.notFound],["All-zero manual review",counts.zeroZero],["Manual review",counts.manualReview],["Duplicates",counts.duplicates],["Invalid",counts.invalid],["Pending (blank)",counts.pending],["Overpaid",counts.overpaid]].map(([label,value])=><div key={String(label)} className="rounded-xl bg-muted/50 p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div>)}</div>
      <p className="text-xs text-muted-foreground">Matching iterates only Master Allocation loan numbers. Paid File loans absent from Master Allocation are not processed or counted. Not Found means a Master loan was absent from this Paid File.</p>
      {selected.notFoundLoans?.length>0&&<details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm font-semibold">Not Found in Paid File — {selected.notFoundLoans.length} Master loan numbers</summary><div className="mt-3 max-h-56 overflow-auto rounded-lg bg-muted/40 p-3 font-mono text-xs leading-6">{selected.notFoundLoans.map((loan,i)=><span key={loan+"-"+i} className="mr-3 inline-block">{loan}</span>)}</div></details>}
      <div className="max-h-[480px] overflow-auto rounded-xl border"><table className="w-full min-w-[850px] text-left text-xs"><thead className="sticky top-0 bg-muted"><tr>{["Master Loan Number","Data Row","Original Total","New Paid Total","Remaining","Date","DAC","ECS","Special","Status"].map(h=><th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead><tbody>{selected.rows.map((r,i)=><tr key={r.loan+"-"+i} className="border-t"><td className="px-3 py-2 font-semibold">{r.loan}</td><td className="px-3 py-2">{r.row}</td><td className="px-3 py-2">{money(r.oldTotal)}</td><td className="px-3 py-2">{money(r.newTotal)}</td><td className="px-3 py-2">{money(r.remaining)}</td><td className="px-3 py-2">{r.date||"—"}</td><td className="px-3 py-2">{money(r.dac)}</td><td className="px-3 py-2">{r.ecs===null?"—":money(r.ecs)}</td><td className="px-3 py-2">{r.special===null?"—":money(r.special)}</td><td className="px-3 py-2">{r.status}</td></tr>)}</tbody></table></div>
      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">Original Total is preserved. Admin approval is required. Ready and Overpaid rows apply; blank, invalid, duplicate and all-zero manual-review rows are skipped. Original Total remains unchanged.</p><Button disabled={busy||eligibleCount===0} onClick={()=>{if(window.confirm("Approve this snapshot and apply only Ready and Overpaid payment rows? Blank, invalid, duplicate and all-zero manual-review rows will be skipped. Original Total will remain untouched. This action will be audited."))applyMutation.mutate();}}>Approve & Apply</Button></div>
    </section>}
  </main>;
}
