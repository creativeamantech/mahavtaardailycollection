import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { FileSpreadsheet, UploadCloud, ShieldCheck, AlertTriangle, History, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/paid-file-implementation")({
  head: () => ({ meta: [{ title: "Paid File Implementation — Mahavtaar Daily Collection" }, { name: "description", content: "Admin workspace to review paid files before updating Master Allocation." }] }),
  component: PaidFileImplementationPage,
});

function PaidFileImplementationPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [review, setReview] = useState(false);

  function choose(next?: File) {
    setError("");
    if (!next) return;
    const ext = next.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "xlsb", "csv"].includes(ext ?? "")) return setError("Select an XLSX, XLS, XLSB or CSV file.");
    if (next.size > 25 * 1024 * 1024) return setError("File size must be 25 MB or less.");
    setFile(next); setReview(false);
  }
  function clear() { setFile(null); setReview(false); setError(""); if (inputRef.current) inputRef.current.value = ""; }

  return <main className="mx-auto w-full max-w-6xl space-y-5 px-3 py-4 sm:px-5 sm:py-6">
    <section className="rounded-2xl border border-[#f0df9e] bg-gradient-to-r from-[#fff8df] via-white to-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center gap-3"><div className="grid size-12 place-items-center rounded-xl bg-[#f7c928] text-[#493900]"><FileSpreadsheet /></div><div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase tracking-widest text-[#947000]">Administration</p><h1 className="text-xl font-extrabold text-[#292510] sm:text-2xl">Paid File Implementation</h1><p className="mt-1 text-xs text-[#776a43] sm:text-sm">Upload, analyze and safely reconcile paid files with Master Allocation.</p></div><span className="rounded-full border border-[#e8dba9] bg-white px-3 py-1.5 text-[10px] font-bold text-[#766321]">ADMIN ONLY</span></div>
    </section>
    <section className="grid gap-3 sm:grid-cols-3">{[["01","Upload Paid File","Select bank paid file."],["02","Analyze & Review","Match Agreement IDs and inspect differences."],["03","Confirm Implementation","Apply only approved changes."]].map(([n,t,d],i)=><div key={n} className={`rounded-xl border p-3 ${(review?i===1:i===0)?"border-[#e7c64f] bg-[#fffaf0]":"border-[#e8e9eb] bg-white"}`}><p className="text-[10px] font-extrabold tracking-widest text-[#9b7a10]">STEP {n}</p><p className="mt-1 text-sm font-bold text-[#292510]">{t}</p><p className="mt-1 text-xs text-muted-foreground">{d}</p></div>)}</section>
    <section className="rounded-2xl border border-[#e8e9eb] bg-white p-4 shadow-sm sm:p-6">
      <div className="flex items-center gap-2"><UploadCloud className="size-5 text-[#8a6b00]"/><h2 className="text-base font-bold text-[#292510]">Upload Paid File</h2></div><p className="mt-1 text-xs text-muted-foreground">XLSX, XLS, XLSB or CSV · Maximum 25 MB</p>
      <input ref={inputRef} type="file" accept=".xlsx,.xls,.xlsb,.csv" className="sr-only" onChange={e=>choose(e.target.files?.[0])}/>
      {!file?<button type="button" onClick={()=>inputRef.current?.click()} className="mt-5 flex min-h-44 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#e6d28a] bg-[#fffdf6] px-4 text-center hover:bg-[#fff8e5]"><UploadCloud className="size-8 text-[#9b7a10]"/><span className="mt-3 text-sm font-bold text-[#38321d]">Choose Paid File</span><span className="mt-1 text-xs text-muted-foreground">Browse device to select the file</span></button>:<div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-[#e8e9eb] bg-[#fafbf9] p-4"><FileSpreadsheet className="size-8 text-[#54815f]"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{file.name}</p><p className="text-xs text-muted-foreground">{(file.size/1048576).toFixed(2)} MB · Selected</p></div><Button variant="ghost" size="icon" onClick={clear} aria-label="Remove file"><X className="size-4"/></Button></div>}
      {error&&<p role="alert" className="mt-3 flex items-center gap-2 text-xs font-medium text-red-600"><AlertTriangle className="size-4"/>{error}</p>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4"/>Selecting a file does not change Master Allocation.</p><Button disabled={!file} onClick={()=>setReview(true)} className="h-11 bg-[#f1c52e] px-5 font-bold text-[#302600] hover:bg-[#e4b91d]">Continue to Analysis <ArrowRight className="ml-2 size-4"/></Button></div>
      {review&&file&&<div className="mt-4 rounded-xl border border-[#e7c64f] bg-[#fffaf0] p-4"><h3 className="text-sm font-bold">File selected for analysis</h3><p className="mt-1 text-xs text-muted-foreground">{file.name} is selected. The live parser and Master Allocation comparison are not connected yet.</p></div>}
    </section>
    <section className="grid gap-4 md:grid-cols-2"><div className="rounded-xl border bg-white p-4"><h2 className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="size-4 text-[#54815f]"/>Implementation safeguards</h2><ul className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground"><li>• Match records using Agreement ID / Loan ID.</li><li>• Calculate DAC as SFDC + Online; compare Total, ECS, Special and Payment Date.</li><li>• Flag unmatched IDs, duplicate IDs and amount differences.</li><li>• Never overwrite the master automatically; require Admin confirmation.</li><li>• Keep a batch-wise audit history of approved updates.</li></ul></div><div className="rounded-xl border bg-white p-4"><h2 className="flex items-center gap-2 text-sm font-bold"><History className="size-4 text-[#8a6b00]"/>Implementation history</h2><p className="mt-3 text-xs text-muted-foreground">Confirmed paid-file batches will appear here once the reconciliation workflow is connected.</p><div className="mt-4 rounded-lg border border-dashed bg-[#fafbf9] px-3 py-5 text-center text-xs text-muted-foreground">No implementation batches yet.</div></div></section>
    <p className="rounded-xl border border-[#f0df9e] bg-[#fffdf5] p-3 text-xs leading-relaxed text-[#75632a]">Initial page UI only: file parsing, live comparison, conflict resolution and spreadsheet write-back still need implementation. No spreadsheet is modified by this page yet.</p>
  </main>;
}
