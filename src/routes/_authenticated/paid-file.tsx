import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileSpreadsheet, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { getPaidFileSetup, savePaidFileMaster, uploadPaidFile, previewPaidFile, applyPaidFile } from "@/lib/paid-file.functions";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type PreviewRow = { agreementId:string; rowNumber:number; oldTotal:number; newTotal:number; remaining:number; date:string; dac:number; ecs?:number; special?:number; status:string };
type Preview = { fileId:string; fileName:string; preview:PreviewRow[]; duplicateCount:number; unmatchedCount:number; invalidCount:number; paidRows:number; matchedCount:number };
export const Route = createFileRoute("/_authenticated/paid-file")({ component: PaidFilePage });

function money(value:number) { return new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(value); }
function PaidFilePage() {
  const qc=useQueryClient();
  const getSetup=useServerFn(getPaidFileSetup), saveMaster=useServerFn(savePaidFileMaster);
  const upload=useServerFn(uploadPaidFile), previewFile=useServerFn(previewPaidFile), apply=useServerFn(applyPaidFile);
  const {data:setup,isLoading}=useQuery({queryKey:["paid-file-setup"],queryFn:()=>getSetup(),staleTime:30000});
  const [selected,setSelected]=useState("");
  const [result,setResult]=useState<Preview|null>(null);
  const [busy,setBusy]=useState(false);
  const fileInputRef=useRef<HTMLInputElement>(null);
  const masterMutation=useMutation({mutationFn:()=>saveMaster({data:{spreadsheetId:selected}}),onSuccess:async()=>{toast.success("Master Allocation saved.");await qc.invalidateQueries({queryKey:["paid-file-setup"]});},onError:e=>toast.error(e.message)});
  async function handleUpload(file?:File) {
    if(!file)return;
    if(!setup?.masterId){toast.error("First select and save the Master Allocation spreadsheet.");return;}
    setBusy(true);setResult(null);
    try {
      // Android document providers often return an empty or unrelated filename/MIME.
      // Identify XLSB by its ZIP package entry instead of browser metadata.
      const fileBytes = await file.arrayBuffer();
      const bytes = new Uint8Array(fileBytes);
      if(bytes.length < 8 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
        throw new Error("The selected file is not a valid Excel workbook. Please choose the original .xlsb file.");
      }
      const packageDirectory = new TextDecoder().decode(bytes);
      if(!packageDirectory.includes("xl/workbook.bin")) {
        throw new Error("This file does not contain the XLSB workbook structure (xl/workbook.bin). Please choose an actual .xlsb file, not .xlsx.");
      }
      const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error("Could not read selected file."));reader.onload=()=>resolve(String(reader.result??""));reader.readAsDataURL(file);});
      const safeBaseName = (file.name || "Paid-File").replace(/[?#].*$/, "").replace(/\.xlsb$/i, "") || "Paid-File";
      const uploadName = `${safeBaseName}.xlsb`;
      const response=await upload({data:{fileName:uploadName,base64}});
      setResult(response as Preview);
      toast.success("Paid File converted and preview generated. Master data is unchanged.");
    } catch(e) {toast.error(e instanceof Error?e.message:"Paid File upload failed.");}
    finally{setBusy(false);}
  }
  async function refreshPreview() {
    if(!result)return;
    setBusy(true);
    try { const next=await previewFile({data:{fileId:result.fileId}});setResult({...result,...next,fileName:next.fileName ?? result.fileName});toast.success("Preview refreshed."); }
    catch(e){toast.error(e instanceof Error?e.message:"Preview refresh failed.");}
    finally{setBusy(false);}
  }
  async function applyNow() {
    if(!result)return;
    const approved=window.confirm(`You are about to update ${result.matchedCount} matched loans in the selected Master Allocation. Original Total will be preserved; New Total, Remaining, Date and available DAC/ECS/Special fields will be updated. Continue?`);
    if(!approved)return;
    setBusy(true);
    try {const done=await apply({data:{fileId:result.fileId,confirm:true}});toast.success(`Applied to ${done.applied} loans. Audit record saved.`);setResult(null);}
    catch(e){toast.error(e instanceof Error?e.message:"Write-back failed.");}
    finally{setBusy(false);}
  }
  const selectedId=selected||setup?.masterId||"";
  return <main className="mx-auto w-full max-w-6xl space-y-5 px-3 py-5 sm:px-6">
    <header className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-amber-100 text-amber-800"><FileSpreadsheet/></span><div><h1 className="text-xl font-extrabold">Paid File Reconciliation</h1><p className="text-sm text-muted-foreground">Admin-only XLSB upload, validation and controlled write-back</p></div></div>
    </header>
    <section className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5">
      <h2 className="font-bold">1. Select Master Allocation</h2>
      <p className="text-sm text-muted-foreground">Choose the Google spreadsheet containing the Data tab. This selection is saved in app settings and does not change the app's own collection database.</p>
      {isLoading?<p className="text-sm">Loading Drive spreadsheets…</p>:<div className="flex flex-col gap-2 sm:flex-row"><Select value={selectedId} onValueChange={setSelected}><SelectTrigger className="min-w-0 flex-1"><SelectValue placeholder="Choose Master Allocation spreadsheet"/></SelectTrigger><SelectContent>{(setup?.files??[]).map(f=><SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent></Select><Button disabled={!selectedId||busy||masterMutation.isPending} onClick={()=>{setSelected(selectedId);masterMutation.mutate();}}>Save Master</Button></div>}
      {setup?.masterId&&<p className="text-xs text-emerald-700">Saved Master ID: {setup.masterId}</p>}
    </section>
    <section className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5">
      <h2 className="font-bold">2. Upload Paid File (.xlsb)</h2>
      <p className="text-sm text-muted-foreground">Upload up to 12 MB. The workbook is converted in Drive; the original Total column is never overwritten. Upload only creates a preview and does not change Data.</p>
      <div className="flex min-h-28 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/50 p-4 text-center">
        <Upload className="size-6 text-amber-700"/>
        <Button type="button" disabled={busy} onClick={()=>fileInputRef.current?.click()}>
          {busy?"Processing…":"Choose XLSB Paid File"}
        </Button>
        <span className="text-xs text-muted-foreground">.xlsb only · maximum 12 MB</span>
        <input ref={fileInputRef} className="hidden" type="file" accept=".xlsb,application/octet-stream,application/vnd.ms-excel.sheet.binary.macroEnabled.12,*/*" disabled={busy} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value="";void handleUpload(file);}}/>
      </div>
      {!setup?.masterId&&<p className="text-xs text-amber-700">You can select the file now; save a Master Allocation before uploading it.</p>}
    </section>
    {result&&<section className="space-y-4 rounded-2xl border bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-bold">3. Review before applying</h2><p className="text-xs text-muted-foreground">{result.fileName}</p></div><Button variant="outline" size="sm" disabled={busy} onClick={()=>void refreshPreview()}><RefreshCw className="mr-2 size-4"/>Refresh</Button></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Paid rows",result.paidRows],["Matched",result.matchedCount],["Unmatched",result.unmatchedCount],["Duplicates",result.duplicateCount]].map(([label,value])=><div key={String(label)} className="rounded-xl bg-muted/50 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold">{value}</p></div>)}</div>
      {result.invalidCount>0&&<p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Invalid amount rows: {result.invalidCount}. Write-back is blocked until corrected.</p>}
      {result.duplicateCount>0&&<p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Duplicate Agreement IDs detected. Duplicate records are excluded and write-back is blocked.</p>}
      <div className="max-h-[420px] overflow-auto rounded-xl border"><table className="w-full min-w-[760px] text-left text-xs"><thead className="sticky top-0 bg-muted"><tr>{["Agreement ID","Data row","Original Total","Paid Total","Remaining","Payment Date","DAC","Status"].map(h=><th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead><tbody>{result.preview.slice(0,250).map(r=><tr key={r.rowNumber} className="border-t"><td className="px-3 py-2 font-medium">{r.agreementId}</td><td className="px-3 py-2">{r.rowNumber}</td><td className="px-3 py-2">{money(r.oldTotal)}</td><td className="px-3 py-2">{money(r.newTotal)}</td><td className="px-3 py-2">{money(r.remaining)}</td><td className="px-3 py-2">{r.date||"—"}</td><td className="px-3 py-2">{money(r.dac)}</td><td className="px-3 py-2">{r.status}</td></tr>)}</tbody></table></div>
      {result.preview.length>250&&<p className="text-xs text-muted-foreground">Showing first 250 of {result.preview.length} matched records. All matched records are included in the write-back.</p>}
      <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between"><p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4"/>Admin confirmation required. An audit entry is written after application.</p><Button disabled={busy||!result.matchedCount||result.duplicateCount>0||result.invalidCount>0} onClick={()=>void applyNow()}>Approve & Apply {result.matchedCount} rows</Button></div>
    </section>}
  </main>;
}
