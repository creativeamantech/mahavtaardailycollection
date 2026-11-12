import { useMemo, useRef, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentSession } from "@/lib/auth.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { fetchMasterMatchingData, applyPaidFileChangeSet } from "@/lib/paid-file.functions";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/_authenticated/paid-file")({
  beforeLoad: async () => {
    const session = await getCurrentSession();
    if (!session) throw redirect({ to: "/auth" });
    if (session.role !== "Admin") throw redirect({ to: "/" });
  },
  head: () => ({ meta: [{ title: "Paid File Reconciliation — Mahavtaar Daily Collection" }] }),
  component: PaidFilePage,
});

type Target = "monthly-master" | "daily-collections";
type Mapping = { agreementId: number; sfdc: number; online: number; ecs: number; special: number };
type MasterRow = { row: number; agreementId: string; existingTotal: number; existingDac: number; bucket: string; city: string; customer?: string; executive?: string };
type ParsedRow = { agreementId: string; sfdc: number; online: number; ecs: number; special: number; sourceRows: number; dac: number };
type PreviewRow = ParsedRow & { master?: MasterRow; newTotal?: number };
type SheetInfo = { name: string; rowCount: number; headers: string[]; mapping: Mapping };
type WorkerEvent =
  | { type: "progress"; percent: number; label: string }
  | { type: "inspected"; sheets: SheetInfo[]; defaultSheet: string }
  | { type: "processed"; fileName: string; records: ParsedRow[]; invalidRows: number; totalRows: number }
  | { type: "error"; message: string };

const money = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const today = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
};
const fields: { key: keyof Mapping; label: string; required: boolean }[] = [
  { key: "agreementId", label: "Agreement ID", required: true },
  { key: "sfdc", label: "SFDC", required: true },
  { key: "online", label: "Online", required: true },
  { key: "ecs", label: "ECS", required: false },
  { key: "special", label: "Special", required: false },
];

function PaidFilePage() {
  const fetchMaster = useServerFn(fetchMasterMatchingData);
  const applyChanges = useServerFn(applyPaidFileChangeSet);
  const workerRef = useRef<Worker | null>(null);
  const masterRowsRef = useRef<MasterRow[]>([]);
  const [target, setTarget] = useState<Target>("monthly-master");
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [mapping, setMapping] = useState<Mapping>({ agreementId: -1, sfdc: -1, online: -1, ecs: -1, special: -1 });
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [invalidRows, setInvalidRows] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("Choose a local bank file");
  const [busy, setBusy] = useState(false);
  const [loadingMaster, setLoadingMaster] = useState(false);
  const [applied, setApplied] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const ready = useMemo(() => rows.filter(r => r.master), [rows]);
  const unmatched = rows.filter(r => !r.master);
  const totalDac = ready.reduce((sum, r) => sum + r.dac, 0);
  const totalSfdc = ready.reduce((sum, r) => sum + r.sfdc, 0);
  const totalOnline = ready.reduce((sum, r) => sum + r.online, 0);
  const aggregated = rows.filter(r => r.sourceRows > 1).length;
  const visibleRows = rows.filter(r => {
    const matchesSearch = !search || r.agreementId.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "all" || (filter === "ready" && !!r.master) || (filter === "unmatched" && !r.master);
    return matchesSearch && matchesFilter;
  });

  function attachWorker() {
    workerRef.current?.terminate();
    const worker = new Worker(new URL("../../workers/paid-file.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerEvent>) => {
      const message = event.data;
      if (message.type === "progress") { setProgress(message.percent); setProgressLabel(message.label); }
      if (message.type === "inspected") {
        setSheets(message.sheets);
        setSheetName(message.defaultSheet);
        const selected = message.sheets.find(s => s.name === message.defaultSheet);
        if (selected) setMapping(selected.mapping);
        setProgress(70); setProgressLabel("Select worksheet and verify columns");
        setBusy(false);
      }
      if (message.type === "processed") {
        setFileName(message.fileName);
        setInvalidRows(message.invalidRows);
        setTotalRows(message.totalRows);
        setRows(message.records.map(record => {
          const master = masterRowsRef.current.find(r => r.agreementId === record.agreementId);
          return { ...record, master, newTotal: master ? master.existingTotal + record.dac : undefined };
        }));
        setProgress(100); setProgressLabel("Ready for reconciliation preview");
        setBusy(false);
        toast.success("Local file processed. Original file was not uploaded.");
      }
      if (message.type === "error") { setBusy(false); setProgressLabel("Processing failed"); toast.error(message.message); }
    };
    worker.onerror = event => { setBusy(false); toast.error(event.message || "Paid File worker failed."); };
    return worker;
  }

  async function onFile(file?: File) {
    if (!file) return;
    if (!/\.(xlsb|xlsx|xls|csv)$/i.test(file.name)) { toast.error("Choose an XLSB, XLSX, XLS or CSV file."); return; }
    setBusy(true); setApplied(false); setRows([]); setSheets([]); setProgress(0);
    setFileName(file.name);
    try {
      setLoadingMaster(true);
      const master = await fetchMaster({ data: { target } });
      masterRowsRef.current = master.rows as MasterRow[];
      setLoadingMaster(false);
      const worker = attachWorker();
      worker.postMessage({ type: "inspect", file, fileName: file.name });
    } catch (error) {
      setLoadingMaster(false); setBusy(false);
      toast.error(error instanceof Error ? error.message : "Could not load Master Sheet or local file.");
    }
  }

  function processSheet() {
    const requiredMissing = fields.filter(f => f.required && mapping[f.key] < 0);
    if (requiredMissing.length) { toast.error("Map required columns: " + requiredMissing.map(f => f.label).join(", ")); return; }
    if (!sheetName || !workerRef.current) { toast.error("Choose a worksheet first."); return; }
    setBusy(true); setRows([]); setProgress(40); setProgressLabel("Processing selected worksheet");
    workerRef.current.postMessage({ type: "process", sheetName, mapping });
  }

  async function apply() {
    if (!ready.length || applied) return;
    const confirmed = window.confirm("You are about to apply " + money(totalDac) + " across " + ready.length + " records to the Master Google Sheet. This action will be logged in the audit trail. Proceed?");
    if (!confirmed) return;
    setBusy(true); setProgress(0); setProgressLabel("Validating changes with Master Sheet");
    try {
      const result = await applyChanges({ data: {
        target, fileName, fileDate: today(), totalDac, totalSfdc, totalOnline,
        changes: ready.map(r => ({ row: r.master!.row, agreementId: r.agreementId, dac: r.dac, newTotal: r.newTotal!, ecs: r.ecs, special: r.special })),
      } });
      setApplied(true); setProgress(100); setProgressLabel("Applied successfully");
      toast.success(result.applied + " records applied in " + result.batches + " batch(es).");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply Paid File changes.");
    } finally { setBusy(false); }
  }

  return (
    <main className="mx-auto w-full max-w-[1700px] space-y-5 px-3 pb-24 pt-5 sm:px-5 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Admin · Master Sheet</p>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Paid File Reconciliation</h1>
          <p className="mt-1 text-sm text-muted-foreground">Bank files are parsed on this device. Only validated changes are sent to Google Sheets.</p>
        </div>
        {applied && <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">Applied</span>}
      </header>

      <section className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-[1fr_2fr]">
        <div>
          <label className="mb-1 block text-sm font-semibold">Target spreadsheet</label>
          <select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={target} disabled={busy || rows.length > 0} onChange={e => setTarget(e.target.value as Target)}>
            <option value="monthly-master">Monthly Master Allocation · Master Allocation Data</option>
            <option value="daily-collections">Main Daily Collection · Collections</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold">Choose bank file (processed locally)</label>
          <input type="file" accept=".xlsb,.xlsx,.xls,.csv" disabled={busy || loadingMaster} onChange={e => void onFile(e.target.files?.[0])} className="block w-full rounded-md border bg-white p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-amber-100 file:px-3 file:py-1.5 file:font-semibold" />
          <p className="mt-1 text-xs text-muted-foreground">Supported: XLSB, XLSX, XLS and CSV. No raw file or CSV is uploaded.</p>
        </div>
      </section>

      {(busy || progress > 0) && <section className="space-y-2 rounded-xl border bg-white p-4">
        <div className="flex justify-between gap-2 text-sm"><span className="font-semibold">{progressLabel}</span><span className="tabular-nums">{progress}%</span></div>
        <Progress value={progress} />
        {loadingMaster && <p className="text-xs text-muted-foreground">Loading minimum matching data from Master Sheet…</p>}
      </section>}

      {sheets.length > 0 && rows.length === 0 && <section className="space-y-4 rounded-xl border bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="mb-1 block text-sm font-semibold">Worksheet</label><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={sheetName} onChange={e => { setSheetName(e.target.value); const s=sheets.find(x=>x.name===e.target.value); if(s) setMapping(s.mapping); }}><option value="">Select sheet</option>{sheets.map(s=><option key={s.name} value={s.name}>{s.name} ({s.rowCount.toLocaleString("en-IN")} rows)</option>)}</select></div>
          <div className="self-end text-sm text-muted-foreground">Confirm detected column names or select the correct column manually.</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {fields.map(field => <div key={field.key}><label className="mb-1 block text-xs font-semibold">{field.label}{field.required ? " *" : " (optional)"}</label><select className="h-10 w-full rounded-md border bg-white px-2 text-sm" value={mapping[field.key]} onChange={e=>setMapping(prev=>({...prev,[field.key]:Number(e.target.value)}))}><option value={-1}>Not mapped</option>{(sheets.find(s=>s.name===sheetName)?.headers ?? []).map((h,i)=><option key={i} value={i}>{h || "Column "+(i+1)}</option>)}</select></div>)}
        </div>
        <Button onClick={processSheet} disabled={busy || !sheetName}>Process selected worksheet</Button>
      </section>}

      {rows.length > 0 && <>
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Rows in file" value={totalRows.toLocaleString("en-IN")} />
          <Kpi label="Matched · Ready" value={ready.length.toLocaleString("en-IN")} />
          <Kpi label="Unmatched" value={unmatched.length.toLocaleString("en-IN")} />
          <Kpi label="Aggregated" value={aggregated.toLocaleString("en-IN")} />
          <Kpi label="Invalid / Errors" value={invalidRows.toLocaleString("en-IN")} />
          <Kpi label="Total DAC" value={money(totalDac)} />
        </section>
        <section className="space-y-3 rounded-xl border bg-white p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h2 className="font-bold">Reconciliation preview</h2><p className="text-xs text-muted-foreground">{fileName} · {rows.length} unique Agreement IDs</p></div>
            <Button onClick={() => void apply()} disabled={busy || !ready.length || applied}>{applied ? "Updates Applied" : "Apply Validated Updates to Master Sheet"}</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {([{id:"all",label:"All"},{id:"ready",label:"Ready to Apply"},{id:"unmatched",label:"Unmatched"}]).map(t=><Button key={t.id} size="sm" variant={filter===t.id?"default":"outline"} onClick={()=>setFilter(t.id)}>{t.label} {t.id==="all"?rows.length:t.id==="ready"?ready.length:unmatched.length}</Button>)}
            <input className="h-9 min-w-[180px] flex-1 rounded-md border px-3 text-sm" placeholder="Search Agreement ID…" value={search} onChange={e=>setSearch(e.target.value)} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-xs">
              <thead className="border-b bg-amber-50 text-[11px] uppercase text-slate-700"><tr>{["Agreement ID","Customer / Executive","SFDC","Online","Calculated DAC","Old Total","New Total","Status"].map(h=><th key={h} className="whitespace-nowrap px-2 py-3">{h}</th>)}</tr></thead>
              <tbody className="divide-y">{visibleRows.slice(0,1000).map(r=><tr key={r.agreementId}>
                <td className="px-2 py-2 font-semibold">{r.agreementId}{r.sourceRows>1&&<div className="text-amber-700">Aggregated ({r.sourceRows} rows)</div>}</td>
                <td className="px-2 py-2">{r.master ? [r.master.customer,r.master.executive].filter(Boolean).join(" / ") || "—" : "—"}</td>
                <td className="px-2 py-2 tabular-nums">{money(r.sfdc)}</td><td className="px-2 py-2 tabular-nums">{money(r.online)}</td><td className="px-2 py-2 tabular-nums font-semibold">{r.master ? <input aria-label={"Override DAC for " + r.agreementId} type="number" step="0.01" className="h-8 w-28 rounded border px-2 text-xs" value={r.dac} onChange={e => { const value = Number(e.target.value); setRows(prev => prev.map(item => item.agreementId === r.agreementId ? { ...item, dac: value, newTotal: item.master ? item.master.existingTotal + value : undefined } : item)); }} /> : money(r.dac)}</td>
                <td className="px-2 py-2 tabular-nums">{r.master?money(r.master.existingTotal):"—"}</td><td className="px-2 py-2 tabular-nums">{r.newTotal===undefined?"—":money(r.newTotal)}</td>
                <td className="px-2 py-2"><span className={r.master?"rounded-full bg-amber-100 px-2 py-1 text-amber-900":"rounded-full bg-red-100 px-2 py-1 text-red-800"}>{r.master?"Ready":"Unmatched"}</span></td>
              </tr>)}</tbody>
            </table>
          </div>
          {visibleRows.length>1000&&<p className="text-xs text-muted-foreground">Showing first 1,000 filtered rows. Search to narrow the preview.</p>}
          <p className="text-xs text-muted-foreground">ECS and Special are kept in separate Master columns. Existing Total is not overwritten; New Total receives Existing Total + DAC.</p>
        </section>
      </>}
    </main>
  );
}

function Kpi({label,value}:{label:string;value:string}) {
  return <div className="rounded-xl border bg-white p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 break-words text-lg font-black tabular-nums">{value}</p></div>;
}
