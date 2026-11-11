import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  getBankPortalData,
  startBankPortalSession,
  endBankPortalSession,
  submitBankPortalComplaint,
  resolveBankPortalComplaint,
  issueBankPortalWarning,
  requestBankPortalAccess,
  respondBankPortalAccessRequest,
} from "@/lib/bank-portal.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/bank-portal")({
  component: BankPortalPage,
});

function BankPortalPage() {
  const queryClient = useQueryClient();
  const load = useServerFn(getBankPortalData);
  const start = useServerFn(startBankPortalSession);
  const end = useServerFn(endBankPortalSession);
  const complain = useServerFn(submitBankPortalComplaint);
  const resolve = useServerFn(resolveBankPortalComplaint);
  const warn = useServerFn(issueBankPortalWarning);
  const requestAccess = useServerFn(requestBankPortalAccess);
  const respondAccess = useServerFn(respondBankPortalAccessRequest);
  const { data, isLoading, error } = useQuery({
    queryKey: ["bank-portal"],
    queryFn: () => load(),
    refetchInterval: 30_000,
    retry: false,
  });
  const [issueType, setIssueType] = useState("Login / Access");
  const [description, setDescription] = useState("");
  const [warningName, setWarningName] = useState("");
  const [warningReason, setWarningReason] = useState("");
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [elapsed, setElapsed] = useState(0);
  const [accessReason, setAccessReason] = useState("");
  const [accessDuration, setAccessDuration] = useState("15");
  const active = data?.activeSession;

  useEffect(() => {
    if (!active) { setElapsed(0); return; }
    const started = new Date(`${active.loginDate} ${active.loginTime}`).getTime();
    const update = () => setElapsed(Number.isFinite(started) ? Math.max(0, Math.floor((Date.now() - started) / 1000)) : 0);
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [active, active?.id, active?.loginDate, active?.loginTime]);

  const elapsedLabel = useMemo(() => {
    const h = Math.floor(elapsed / 3600).toString().padStart(2, "0");
    const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, "0");
    const s = (elapsed % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  }, [elapsed]);

  async function refresh() { await queryClient.invalidateQueries({ queryKey: ["bank-portal"] }); }
  async function startSession() {
    if (!window.confirm("Start a new Bank Portal session now?")) return;
    try { await start(); toast.success("Bank Portal session started."); await refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not start session."); }
  }
  async function endSession() {
    if (!active || !window.confirm("End your active Bank Portal session?")) return;
    try { await end({ data: { sessionId: active.id } }); toast.success("Session ended."); await refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not end session."); }
  }
  async function submitComplaint(event: React.FormEvent) {
    event.preventDefault();
    try {
      await complain({ data: { sessionId: active?.id, issueType, description } });
      setDescription(""); toast.success("Complaint submitted."); await refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Complaint could not be submitted."); }
  }
  async function resolveComplaint(id: string) {
    const remark = remarks[id]?.trim();
    if (!remark) { toast.error("Enter an Admin remark first."); return; }
    try { await resolve({ data: { complaintId: id, remark } }); toast.success("Complaint resolved."); await refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not resolve complaint."); }
  }
  async function issueWarning(event: React.FormEvent) {
    event.preventDefault();
    try {
      await warn({ data: { executiveName: warningName, reason: warningReason } });
      setWarningName(""); setWarningReason(""); toast.success("Warning issued."); await refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not issue warning."); }
  }

  if (isLoading) return <main className="mx-auto max-w-5xl p-6">Loading Bank Portal...</main>;
  if (error || !data) return <main className="mx-auto max-w-5xl p-6"><h1 className="text-2xl font-bold">Bank Portal</h1><p className="mt-3 text-red-700">{error instanceof Error ? error.message : "Bank Portal data could not be loaded."}</p><Button className="mt-4" onClick={() => refresh()}>Retry</Button></main>;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 sm:px-6">
      <header><h1 className="text-2xl font-bold">Bank Portal</h1><p className="text-sm text-muted-foreground">Portal session tracking, schedules and issue reporting</p></header>
      <section className={`rounded-2xl border p-4 ${active ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-sm font-semibold">{active ? "Portal session active" : "No active portal session"}</p><p className="mt-1 text-xs text-muted-foreground">{active ? `Started ${active.loginDate} at ${active.loginTime}` : "Start a session when you enter the bank portal."}</p></div>
          {active ? <div className="flex items-center gap-3"><span className="font-mono text-lg font-bold tabular-nums">{elapsedLabel}</span><Button variant="destructive" onClick={endSession}>End Session</Button></div> : <Button onClick={startSession}>Start Portal Session</Button>}
        </div>
        {data.banned && <p className="mt-3 text-sm font-semibold text-red-700">Your Bank Portal access is suspended. Please contact Admin.</p>}
      </section>
      <section className="rounded-2xl border bg-white p-4">
        <h2 className="font-semibold">Today’s allocated schedule</h2>
        {data.schedules.length ? <div className="mt-3 space-y-2">{data.schedules.map((s) => <div key={s.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm"><span>{s.start} – {s.end}</span><span className="text-muted-foreground">{s.status}</span></div>)}</div> : <p className="mt-2 text-sm text-muted-foreground">No portal time slot allocated for today.</p>}
      </section>
      <section className="rounded-2xl border bg-white p-4">
        <h2 className="font-semibold">Report an issue / complaint</h2>
        <form onSubmit={submitComplaint} className="mt-3 grid gap-3">
          <select className="h-11 rounded-md border bg-white px-3 text-sm" value={issueType} onChange={(e) => setIssueType(e.target.value)}><option>Login / Access</option><option>Portal not working</option><option>Technical error</option><option>Payment / Account issue</option><option>Other</option></select>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the issue..." maxLength={2000} required />
          <Button type="submit" className="w-full sm:w-fit">Submit Complaint</Button>
        </form>
      </section>
      <section className="rounded-2xl border bg-white p-4">
        <h2 className="font-semibold">Your complaints</h2>
        {data.complaints.length ? <div className="mt-3 space-y-3">{data.complaints.map((c) => <article key={c.id} className="rounded-lg border p-3"><div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{c.type}</strong><span>{c.status}</span></div><p className="mt-2 text-sm">{c.description}</p>{c.remark && <p className="mt-2 text-xs text-muted-foreground">Admin: {c.remark}</p>}</article>)}</div> : <p className="mt-2 text-sm text-muted-foreground">No complaints recorded.</p>}
      </section>
      {data.session.role === "Admin" && <section className="space-y-4 rounded-2xl border border-amber-300 bg-amber-50/30 p-4">
        <h2 className="text-lg font-bold">Admin Management</h2>
        <div className="rounded-xl border bg-white p-3"><h3 className="font-semibold">All portal sessions</h3><div className="mt-3 space-y-2">{data.sessions.map((s) => <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm"><span><strong>{s.executive}</strong><br />{s.loginDate} {s.loginTime} · {s.status}</span>{s.status === "Active" && <Button size="sm" variant="outline" onClick={async () => { try { await end({ data: { sessionId: s.id } }); await refresh(); toast.success("Session terminated."); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not end session."); } }}>End Session</Button>}</div>)}</div></div>
        <div className="rounded-xl border bg-white p-3"><h3 className="font-semibold">Resolve complaints</h3><div className="mt-3 space-y-3">{data.complaints.filter((c) => c.status !== "Resolved").map((c) => <div key={c.id} className="rounded-lg border p-3"><p className="text-sm font-semibold">{c.executive} · {c.type}</p><p className="mt-1 text-sm">{c.description}</p><Input className="mt-2" value={remarks[c.id] ?? ""} onChange={(e) => setRemarks((old) => ({ ...old, [c.id]: e.target.value }))} placeholder="Admin remark" /><Button className="mt-2" size="sm" onClick={() => resolveComplaint(c.id)}>Mark Resolved</Button></div>)}</div></div>
        <form onSubmit={issueWarning} className="rounded-xl border bg-white p-3"><h3 className="font-semibold">Issue warning</h3><div className="mt-3 grid gap-2 sm:grid-cols-2"><Input value={warningName} onChange={(e) => setWarningName(e.target.value)} placeholder="Executive name" required /><Input value={warningReason} onChange={(e) => setWarningReason(e.target.value)} placeholder="Reason for warning" required /></div><Button className="mt-3" type="submit">Issue Warning</Button></form>
      </section>}
    </main>
  );
}
