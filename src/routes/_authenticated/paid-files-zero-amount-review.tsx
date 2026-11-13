import { useMemo, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ClipboardPaste, RefreshCw, Save, Search } from "lucide-react";
import { getCurrentSession } from "@/lib/auth.functions";
import { applyPaidFileChangeSet, fetchMasterMatchingData } from "@/lib/paid-file.functions";
import type { MasterRow } from "@/lib/paid-file-reconciliation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/paid-files-zero-amount-review")({
  beforeLoad: async () => {
    const session = await getCurrentSession();
    if (!session) throw redirect({ to: "/auth" });
    if (session.role !== "Admin") throw redirect({ to: "/" });
    // Zero-amount review now belongs to the uploaded Paid File reconciliation session.
    throw redirect({ to: "/paid-file" });
  },
  head: () => ({ meta: [{ title: "Paid File Reconciliation — Mahavtaar Daily Collection" }] }),
  component: PaidFilesZeroAmountReviewPage,
});

type ComponentKey = "dac" | "ecs" | "special";
type ReviewRow = { agreementId: string; dac: number; ecs: number; special: number; paymentDate: string; sourceLine: number };
const COMPONENTS: { key: ComponentKey; label: string }[] = [
  { key: "dac", label: "DAC" },
  { key: "ecs", label: "ECS" },
  { key: "special", label: "Special" },
];
const money = (value: number) => "₹" + value.toLocaleString("en-IN", { maximumFractionDigits: 2 });

function parsePaste(raw: string): { rows: ReviewRow[]; errors: string[] } {
  const rows: ReviewRow[] = [];
  const errors: string[] = [];
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  lines.forEach((line, index) => {
    const cells = line.split("\t").length > 1 ? line.split("\t") : line.split(",");
    const values = cells.map((cell) => cell.trim().replace(/^["']|["']$/g, ""));
    if (index === 0 && /loan|agreement|lan/i.test(values[0] ?? "")) return;
    const agreementId = (values[0] ?? "").replace(/^'+|'+$/g, "").trim().toUpperCase();
    if (!agreementId) { errors.push("Line " + (index + 1) + ": missing Loan Number"); return; }
    const parseAmount = (value: string | undefined) => {
      if (!value) return 0;
      const n = Number(value.replace(/[₹,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
      return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
    };
    const dac = parseAmount(values[1]);
    const ecs = parseAmount(values[2]);
    const special = parseAmount(values[3]);
    if (![dac, ecs, special].every(Number.isFinite)) {
      errors.push("Line " + (index + 1) + ": invalid or negative amount");
      return;
    }
    rows.push({ agreementId, dac, ecs, special, paymentDate: values[4] ?? "", sourceLine: index + 1 });
  });
  return { rows, errors };
}

function PaidFilesZeroAmountReviewPage() {
  const qc = useQueryClient();
  const fetchMaster = useServerFn(fetchMasterMatchingData);
  const applyChanges = useServerFn(applyPaidFileChangeSet);
  const [paste, setPaste] = useState("");
  const [activeComponent, setActiveComponent] = useState<ComponentKey>("dac");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const masterQuery = useQuery({
    queryKey: ["paid-files-zero-review-master"],
    queryFn: () => fetchMaster({ data: { target: "monthly-master" } }),
    staleTime: 30_000,
  });
  const parsed = useMemo(() => parsePaste(paste), [paste]);
  const masterRows = useMemo(
    () => masterQuery.data?.found ? masterQuery.data.rows as MasterRow[] : [],
    [masterQuery.data],
  );
  const masterById = useMemo(() => {
    const map = new Map<string, MasterRow[]>();
    for (const row of masterRows) {
      const list = map.get(row.agreementId) ?? [];
      list.push(row);
      map.set(row.agreementId, list);
    }
    return map;
  }, [masterRows]);

  const duplicateIds = useMemo(() => new Set(parsed.rows.filter((row, i) =>
    parsed.rows.findIndex((other) => other.agreementId === row.agreementId) !== i
  ).map((row) => row.agreementId)), [parsed.rows]);

  const reviewed = useMemo(() => parsed.rows.map((row) => {
    const matches = masterById.get(row.agreementId) ?? [];
    const master = matches.length === 1 ? matches[0] : undefined;
    const protectedRow = master ? master.dacSource === "MANUAL" || master.dacSource === "CORRECTED" || master.isCorrected : false;
    const duplicateMaster = matches.length > 1;
    const isZero = row.dac === 0 && row.ecs === 0 && row.special === 0;
    return { ...row, master, isZero, matched: matches.length === 1, duplicateMaster, protectedRow };
  }), [parsed.rows, masterById]);

  const ready = reviewed.filter((row) => row.matched && !row.duplicateMaster && !row.protectedRow && !duplicateIds.has(row.agreementId));
  const updateCount = ready.filter((row) => row.dac > 0 || row.ecs > 0 || row.special > 0).length;
  const visible = reviewed.filter((row) => !filter || row.agreementId.toLowerCase().includes(filter.toLowerCase()));

  async function handleApply() {
    if (busy || !confirmed || updateCount === 0) return;
    const changes = ready.filter((row) => row.dac > 0 || row.ecs > 0 || row.special > 0).map((row) => {
      const master = row.master!;
      const dac = Math.round((master.existingDac + row.dac) * 100) / 100;
      const ecs = Math.round((master.existingEcs + row.ecs) * 100) / 100;
      const special = Math.round((master.existingSpecial + row.special) * 100) / 100;
      const baseTotal = Math.max(master.existingTotal, master.existingNewTotal);
      const delta = row.dac + row.ecs + row.special;
      return {
        row: master.row,
        agreementId: row.agreementId,
        dac,
        ecs,
        special,
        newTotal: Math.round((baseTotal + delta) * 100) / 100,
        paymentDate: row.paymentDate,
        clearProvisional: false,
      };
    });
    setBusy(true);
    try {
      const result = await applyChanges({
        data: {
          target: "monthly-master",
          sourceMode: "MANUAL",
          fileName: "Paid Files Zero Amount Review (Admin Manual Entry)",
          fileDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()),
          totalDac: ready.reduce((sum, row) => sum + row.dac, 0),
          totalSfdc: 0,
          totalOnline: 0,
          protectedSkips: reviewed.filter((row) => row.protectedRow).length,
          unmatchedSkipped: reviewed.filter((row) => !row.matched || row.duplicateMaster || duplicateIds.has(row.agreementId)).length,
          duplicatesReplaced: 0,
          changes,
          conflictFlags: [],
        },
      });
      toast.success(result.applied + " loan(s) updated and audit logged.");
      setPaste("");
      setConfirmed(false);
      await qc.invalidateQueries({ queryKey: ["paid-files-zero-review-master"] });
      await qc.invalidateQueries({ queryKey: ["paid-file-master"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply manual review updates.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-5 px-3 pb-24 pt-5 sm:px-5 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-primary">Admin · Paid File Support</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Paid Files Zero Amount Review</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Paste Loan Numbers from the Paid File, match them with the current Master, then enter manual DAC, ECS or Special amounts. This review does not change the normal reconciliation calculation.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void masterQuery.refetch()} disabled={masterQuery.isFetching}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh Master
        </Button>
      </header>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Pasted Loans", reviewed.length],
          ["Master Matched", reviewed.filter((row) => row.matched).length],
          ["Zero Amount", reviewed.filter((row) => row.isZero).length],
          ["Ready to Update", updateCount],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border bg-card p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{Number(value).toLocaleString("en-IN")}</p>
          </div>
        ))}
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2 font-semibold"><ClipboardPaste className="h-4 w-4" /> Paste Paid File Loan List</div>
        <p className="text-xs text-muted-foreground">Paste tab-separated rows in this order: Loan Number, DAC, ECS, Special, Payment Date (optional). You may paste only Loan Numbers; amounts default to zero for manual review.</p>
        <div className="rounded-lg bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap">Loan Number    DAC    ECS    Special    Payment Date{"\n"}LN10001    0    0    0{"\n"}LN10002    0    0    0</div>
        <Textarea value={paste} onChange={(event) => { setPaste(event.target.value); setConfirmed(false); }} rows={6} placeholder="Paste Excel rows here…" className="font-mono text-xs" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{parsed.rows.length} valid pasted rows · {parsed.errors.length} input errors</p>
          <Button variant="outline" size="sm" onClick={() => { setPaste(""); setConfirmed(false); }}>Clear list</Button>
        </div>
        {parsed.errors.length > 0 && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{parsed.errors.slice(0, 5).join(" · ")}</div>}
      </section>

      {masterQuery.isLoading ? (
        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Loading current-month Master Allocation…</div>
      ) : !masterQuery.data?.found ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">Master Allocation could not be loaded: {masterQuery.data?.errorMessage ?? "Please retry."}</div>
      ) : (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> {masterQuery.data.spreadsheetName}</div>
            <span className="text-xs text-muted-foreground">{masterRows.length.toLocaleString("en-IN")} Master rows loaded · {masterQuery.data.tab}</span>
          </div>
          <Tabs value={activeComponent} onValueChange={(value) => setActiveComponent(value as ComponentKey)}>
            <TabsList className="grid w-full grid-cols-3">
              {COMPONENTS.map((component) => <TabsTrigger key={component.key} value={component.key}>{component.label}</TabsTrigger>)}
            </TabsList>
            {COMPONENTS.map((component) => (
              <TabsContent key={component.key} value={component.key} className="space-y-3">
                <p className="text-xs text-muted-foreground">Enter the additional amount for this component only. Other component values remain unchanged.</p>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search Loan Number…" className="pl-9" />
                </div>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-muted/60 text-left text-xs">
                      <tr><th className="p-2">Loan Number</th><th className="p-2">Match</th><th className="p-2">Existing {component.label}</th><th className="p-2">Manual Add {component.label}</th><th className="p-2">Review</th></tr>
                    </thead>
                    <tbody>
                      {visible.map((row) => {
                        const status = !row.matched ? "Unmatched" : row.duplicateMaster ? "Duplicate in Master" : duplicateIds.has(row.agreementId) ? "Duplicate pasted" : row.protectedRow ? "Protected" : row.isZero ? "Zero amount" : "Amount supplied";
                        const current = row.master ? row.master[component.key === "dac" ? "existingDac" : component.key === "ecs" ? "existingEcs" : "existingSpecial"] : 0;
                        return <tr key={row.agreementId + "-" + row.sourceLine} className="border-t">
                          <td className="p-2 font-mono text-xs">{row.agreementId}</td>
                          <td className="p-2">{row.matched && !row.duplicateMaster ? <span className="text-emerald-700">Matched · row {row.master?.row}</span> : <span className="text-destructive">{status}</span>}</td>
                          <td className="p-2 tabular-nums">{money(current)}</td>
                          <td className="p-2"><Input type="number" min="0" step="0.01" className="h-9 w-32" value={row[component.key]} disabled={!row.matched || row.duplicateMaster || row.protectedRow || duplicateIds.has(row.agreementId)} onChange={(event) => {
                            const amount = Number(event.target.value);
                            if (!Number.isFinite(amount) || amount < 0) return;
                            const next = parsed.rows.map((item) => item.sourceLine === row.sourceLine ? { ...item, [component.key]: Math.round(amount * 100) / 100 } : item);
                            setPaste(next.map((item) => [item.agreementId, item.dac, item.ecs, item.special, item.paymentDate].join("\t")).join("\n"));
                            setConfirmed(false);
                          }} /></td>
                          <td className="p-2 text-xs">{status}</td>
                        </tr>;
                      })}
                      {visible.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No pasted loans to display.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
            ))}
          </Tabs>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <div className="flex items-start gap-2 text-xs text-muted-foreground"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Only unique, matched, unprotected Loan Numbers can be updated. Amounts are additive to the current component balance.</div>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I reviewed these manual additions</label>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void handleApply()} disabled={!confirmed || updateCount === 0 || busy || parsed.errors.length > 0}>
              <Save className="mr-2 h-4 w-4" /> {busy ? "Applying…" : "Validate & Apply " + updateCount + " Loans"}
            </Button>
          </div>
        </section>
      )}
    </main>
  );
}
