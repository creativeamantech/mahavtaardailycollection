import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  getBankPortalData,
  startBankPortalSession,
  endBankPortalSession,
  forceEndBankPortalSession,
  submitBankPortalComplaint,
  resolveBankPortalComplaint,
  issueBankPortalWarning,
  requestBankPortalAccess,
  respondBankPortalAccessRequest,
  createBankPortalSchedule,
  updateBankPortalSchedule,
  cancelBankPortalSchedule,
} from "@/lib/bank-portal.functions";
import { EXECUTIVES } from "@/lib/executives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/bank-portal")({
  component: BankPortalPage,
});

type PortalTab = "session" | "timeline" | "issues" | "admin";
type ScheduleForm = { executive: (typeof EXECUTIVES)[number]; date: string; start: string; end: string };

function formatElapsed(seconds: number) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return h + ":" + m + ":" + s;
}
function formatMinutes(minutes: number) {
  if (minutes < 60) return minutes + "m";
  return Math.floor(minutes / 60) + "h " + (minutes % 60) + "m";
}
function BankPortalPage() {
  const queryClient = useQueryClient();
  const load = useServerFn(getBankPortalData);
  const start = useServerFn(startBankPortalSession);
  const end = useServerFn(endBankPortalSession);
  const forceEnd = useServerFn(forceEndBankPortalSession);
  const complain = useServerFn(submitBankPortalComplaint);
  const resolve = useServerFn(resolveBankPortalComplaint);
  const warn = useServerFn(issueBankPortalWarning);
  const requestAccess = useServerFn(requestBankPortalAccess);
  const respondAccess = useServerFn(respondBankPortalAccessRequest);
  const createSchedule = useServerFn(createBankPortalSchedule);
  const updateSchedule = useServerFn(updateBankPortalSchedule);
  const cancelSchedule = useServerFn(cancelBankPortalSchedule);
  const { data, isLoading, error } = useQuery({
    queryKey: ["bank-portal"],
    queryFn: () => load(),
    refetchInterval: 15_000,
    retry: false,
  });

  const [tab, setTab] = useState<PortalTab>("session");
  const [elapsed, setElapsed] = useState(0);
  const [issueType, setIssueType] = useState("Login / Access");
  const [description, setDescription] = useState("");
  const [accessReason, setAccessReason] = useState("");
  const [accessDuration, setAccessDuration] = useState<"15" | "30">("15");
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [warningName, setWarningName] = useState<(typeof EXECUTIVES)[number]>(EXECUTIVES[0]);
  const [warningReason, setWarningReason] = useState("");
  const [forceReasons, setForceReasons] = useState<Record<string, string>>({});
  const [cancelReasons, setCancelReasons] = useState<Record<string, string>>({});
  const [scheduleEditingId, setScheduleEditingId] = useState("");
  const [schedule, setSchedule] = useState<ScheduleForm>({ executive: EXECUTIVES[0], date: "", start: "10:00", end: "11:30" });
  const [busy, setBusy] = useState(false);

  const active = data?.activeSession;
  useEffect(() => {
    if (!active) { setElapsed(0); return; }
    const started = new Date(active.loginDate + "T" + active.loginTime + "+05:30").getTime();
    const update = () => setElapsed(Number.isFinite(started) ? Math.max(0, Math.floor((Date.now() - started) / 1000)) : 0);
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [active?.id, active?.loginDate, active?.loginTime]);
  useEffect(() => {
    if (data?.today && !schedule.date) setSchedule((old) => ({ ...old, date: data.today }));
  }, [data?.today, schedule.date]);

  const elapsedLabel = useMemo(() => formatElapsed(elapsed), [elapsed]);
  const elapsedMinutes = Math.floor(elapsed / 60);
  const capMinutes = active?.capMinutes ?? 60;
  const warningAt = Math.max(1, Math.min(45, capMinutes - 5));
  const nearingTimeout = Boolean(active && elapsedMinutes >= warningAt && elapsedMinutes < capMinutes);
  const currentName = data?.session.name ?? "";
  const otherLive = data?.liveSessions.find((s) => s.executive !== currentName);
  const hasApprovedAccess = Boolean(data?.accessRequests.some((r) => r.requester === currentName && r.status === "Approved" && r.expiresAt && new Date(r.expiresAt).getTime() > Date.now()));
  const ownCurrentSlot = data?.currentSlotOwner?.name === currentName;
  const canStart = Boolean(data && (data.session.role === "Admin" || ownCurrentSlot || hasApprovedAccess));
  const nextSlot = data?.nextSlotOwner;
  const portalInUse = data?.liveSessions[0];

  async function refresh() { await queryClient.invalidateQueries({ queryKey: ["bank-portal"] }); }
  async function runAction(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try { await action(); toast.success(success); await refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Action could not be completed."); }
    finally { setBusy(false); }
  }
  async function startSession() {
    await runAction(() => start(), "Bank Portal session started.");
  }
  async function endSession() {
    if (!active || !window.confirm("End your Bank Portal session?")) return;
    await runAction(() => end({ data: { sessionId: active.id } }), "Session ended.");
  }
  async function submitComplaint(event: React.FormEvent) {
    event.preventDefault();
    await runAction(async () => { await complain({ data: { sessionId: active?.id, issueType, description } }); setDescription(""); }, "Issue submitted.");
  }
  async function submitAccessRequest(event: React.FormEvent) {
    event.preventDefault();
    await runAction(async () => { await requestAccess({ data: { reason: accessReason, duration: accessDuration } }); setAccessReason(""); }, "Emergency access request sent.");
  }
  async function replyAccess(requestId: string, decision: "Approved" | "Rejected") {
    await runAction(() => respondAccess({ data: { requestId, decision } }), decision === "Approved" ? "Emergency access approved." : "Request declined.");
  }
  async function submitSchedule(event: React.FormEvent) {
    event.preventDefault();
    await runAction(async () => {
      const payload = { executive: schedule.executive, date: schedule.date, start: schedule.start, end: schedule.end };
      if (scheduleEditingId) await updateSchedule({ data: { scheduleId: scheduleEditingId, ...payload } });
      else await createSchedule({ data: payload });
      setScheduleEditingId("");
      setSchedule((old) => ({ ...old, start: "10:00", end: "11:30" }));
    }, scheduleEditingId ? "Schedule updated." : "Slot allocated.");
  }
  async function forceClose(sessionId: string) {
    const reason = forceReasons[sessionId]?.trim();
    if (!reason) { toast.error("Enter a reason before force-closing the session."); return; }
    await runAction(async () => {
      await forceEnd({ data: { sessionId, reason } });
      setForceReasons((old) => ({ ...old, [sessionId]: "" }));
    }, "Session force-closed and audit entry recorded.");
  }
  async function cancelSlot(scheduleId: string) {
    const reason = cancelReasons[scheduleId]?.trim();
    if (!reason) { toast.error("Enter a cancellation reason."); return; }
    await runAction(async () => {
      await cancelSchedule({ data: { scheduleId, reason } });
      setCancelReasons((old) => ({ ...old, [scheduleId]: "" }));
    }, "Slot cancelled.");
  }
  async function resolveComplaint(id: string) {
    const remark = remarks[id]?.trim();
    if (!remark) { toast.error("Enter an Admin remark first."); return; }
    await runAction(() => resolve({ data: { complaintId: id, remark } }), "Complaint resolved.");
  }
  async function issueWarning(event: React.FormEvent) {
    event.preventDefault();
    await runAction(async () => { await warn({ data: { executiveName: warningName, reason: warningReason } }); setWarningReason(""); }, "Warning issued.");
  }
  function editSlot(slot: { id: string; executive: string; start: string; end: string }) {
    setScheduleEditingId(slot.id);
    setSchedule({ executive: (EXECUTIVES as readonly string[]).includes(slot.executive) ? slot.executive as (typeof EXECUTIVES)[number] : EXECUTIVES[0], date: data?.today ?? "", start: slot.start, end: slot.end });
    setTab("admin");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (isLoading) return <main className="mx-auto max-w-5xl p-6">Loading Bank Portal...</main>;
  if (error || !data) return <main className="mx-auto max-w-5xl p-6"><h1 className="text-2xl font-bold">Bank Portal</h1><p className="mt-3 text-red-700">{error instanceof Error ? error.message : "Bank Portal data could not be loaded."}</p><Button className="mt-4" onClick={() => refresh()}>Retry</Button></main>;

  const tabs: { id: PortalTab; label: string }[] = [
    { id: "session", label: "My Session" },
    { id: "timeline", label: "Today's Slots" },
    { id: "issues", label: "Issues" },
    ...(data.isAdmin ? [{ id: "admin" as const, label: "Admin Controls" }] : []),
  ];

  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 px-3 py-4 pb-24 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Bank Portal</h1><p className="text-sm text-muted-foreground">Shared portal access · schedules · helpdesk</p></div>
        <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">{data.session.name} · {data.session.role}</span>
      </header>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3 sm:p-4" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Live portal status</p>
            {portalInUse ? <p className="mt-1 truncate text-sm font-bold text-slate-900">{portalInUse.executive} is using the Bank Portal</p> : <p className="mt-1 text-sm font-bold text-slate-900">Portal Free</p>}
            <p className="mt-1 text-xs text-slate-600">{portalInUse ? "Started " + portalInUse.loginTime + " · active for " + formatMinutes(Math.max(0, Math.floor((Date.now() - portalInUse.startedAt) / 60_000))) : nextSlot ? "Next slot: " + nextSlot.name + " at " + nextSlot.start : "No further slot scheduled today"}</p>
          </div>
          <span className={"shrink-0 rounded-full px-3 py-1 text-xs font-bold " + (portalInUse ? "bg-amber-200 text-amber-950" : "bg-white text-slate-700 border border-slate-200")}>{portalInUse ? "IN USE" : "AVAILABLE"}</span>
        </div>
      </section>

      <nav className="grid grid-cols-3 gap-1 rounded-xl border bg-white p-1 sm:gap-2" style={{ gridTemplateColumns: "repeat(" + tabs.length + ", minmax(0, 1fr))" }} aria-label="Bank Portal sections">
        {tabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={"min-h-11 rounded-lg px-1 py-2 text-center text-[11px] font-semibold leading-tight sm:text-sm " + (tab === item.id ? "bg-amber-300 text-slate-950 shadow-sm" : "text-slate-600 hover:bg-amber-50")}>{item.label}</button>)}
      </nav>

      {tab === "session" && <div className="space-y-4">
        <section className="rounded-2xl border bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">My live session</h2><span className={"rounded-full px-2.5 py-1 text-xs font-semibold " + (active ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-600")}>{active ? "SESSION ACTIVE" : "NOT CONNECTED"}</span></div>
          {active ? <div className="mt-4">
            <p className="font-mono text-4xl font-bold tabular-nums tracking-tight sm:text-5xl">{elapsedLabel}</p>
            <p className="mt-2 text-sm text-muted-foreground">Started {active.loginDate} at {active.loginTime} · {capMinutes}-minute session cap</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: Math.min(100, elapsed / (capMinutes * 60) * 100) + "%" }} /></div>
            {nearingTimeout && <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-950">Session is nearing its {capMinutes}-minute limit. Please finish and end the session.</p>}
            <Button className="mt-4 w-full sm:w-auto" variant="destructive" onClick={endSession} disabled={busy}>End My Session</Button>
          </div> : <div className="mt-4">
            {data.banned && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">Your Bank Portal access is suspended. Please contact Admin.</p>}
            {otherLive && <p className="mb-3 rounded-lg border bg-slate-50 p-3 text-sm text-slate-700">{otherLive.executive} is currently using the portal. You can start after their session ends.</p>}
            {!canStart && !data.banned && <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{data.currentSlotOwner ? "Current slot belongs to " + data.currentSlotOwner.name + " until " + data.currentSlotOwner.end + "." : data.slotOwner ? "Next slot belongs to " + data.slotOwner.name + " at " + data.slotOwner.start + "." : "You do not have an active slot right now."} Need urgent access?</p>}
            <Button className="w-full sm:w-auto" onClick={startSession} disabled={busy || data.banned || Boolean(otherLive) || !canStart}>Start Portal Session</Button>
          </div>}
        </section>

        {data.accessRequests.filter((r) => r.recipient === data.session.name && r.status === "Pending").map((request) => <section key={request.id} className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-bold">{request.requester} requested {request.duration} minutes of emergency access</p>
          <p className="mt-1 text-sm">{request.reason}</p>
          <p className="mt-1 text-xs text-muted-foreground">Approve only if you have finished your portal work.</p>
          <div className="mt-3 flex gap-2"><Button size="sm" onClick={() => replyAccess(request.id, "Approved")} disabled={busy}>Approve</Button><Button size="sm" variant="outline" onClick={() => replyAccess(request.id, "Rejected")} disabled={busy}>Decline</Button></div>
        </section>)}

        {!active && !canStart && !data.banned && !otherLive && data.session.role !== "Admin" && <form onSubmit={submitAccessRequest} className="rounded-2xl border bg-white p-4">
          <h3 className="font-semibold">Request emergency access</h3>
          <p className="mt-1 text-xs text-muted-foreground">The current slot owner must approve before you can start.</p>
          <div className="mt-3 flex gap-2">{(["15", "30"] as const).map((minutes) => <button key={minutes} type="button" onClick={() => setAccessDuration(minutes)} className={"rounded-lg border px-4 py-2 text-sm font-semibold " + (accessDuration === minutes ? "border-amber-400 bg-amber-100" : "bg-white")}>{minutes} min</button>)}</div>
          <Textarea className="mt-3" value={accessReason} onChange={(e) => setAccessReason(e.target.value)} placeholder="Reason (e.g. urgent customer settlement verification)" maxLength={500} required />
          <Button className="mt-3 w-full sm:w-auto" type="submit" disabled={busy || accessReason.trim().length < 3}>Send Access Request</Button>
        </form>}

        {data.accessRequests.filter((r) => r.requester === data.session.name).length > 0 && <section className="rounded-xl border bg-white p-4"><h3 className="font-semibold">My emergency requests</h3><div className="mt-2 space-y-2">{data.accessRequests.filter((r) => r.requester === data.session.name).map((r) => <div key={r.id} className="flex flex-wrap justify-between gap-2 border-b pb-2 text-sm last:border-0"><span>{r.recipient} · {r.duration} min</span><span className="font-semibold">{r.status}</span></div>)}</div></section>}
      </div>}

      {tab === "timeline" && <section className="rounded-2xl border bg-white p-4">
        <div className="flex items-center justify-between gap-2"><div><h2 className="font-semibold">Today's portal timeline</h2><p className="text-xs text-muted-foreground">{data.today} · Shared portal schedule</p></div><span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold">{data.portalTimings.length} slots</span></div>
        {data.portalTimings.length ? <div className="mt-4 space-y-3">{data.portalTimings.map((slot) => <article key={slot.id} className={"relative rounded-xl border p-3 " + (slot.executive === data.session.name ? "border-amber-300 bg-amber-50" : "bg-white")}>
          <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold">{slot.executive}{slot.executive === data.session.name ? " · You" : ""}</p><p className="mt-1 text-sm tabular-nums text-slate-600">{slot.start} – {slot.end}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{slot.status}</span></div>
          <div className="mt-3 h-1.5 rounded-full bg-slate-100"><div className={"h-1.5 rounded-full " + (slot.executive === data.session.name ? "bg-amber-400" : "bg-slate-400")} style={{ width: "100%" }} /></div>
        </article>)}</div> : <p className="mt-4 text-sm text-muted-foreground">No slots have been allocated for today.</p>}
      </section>}

      {tab === "issues" && <div className="space-y-4">
        <section className="rounded-2xl border bg-white p-4">
          <h2 className="font-semibold">Report an issue</h2>
          <form onSubmit={submitComplaint} className="mt-3 grid gap-3">
            <select className="h-11 rounded-md border bg-white px-3 text-sm" value={issueType} onChange={(e) => setIssueType(e.target.value)}><option>Login / Access</option><option>Portal not working</option><option>OTP / Verification</option><option>Technical error</option><option>Payment / Account issue</option><option>Other</option></select>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the issue..." maxLength={2000} required />
            <Button type="submit" className="w-full sm:w-fit" disabled={busy || description.trim().length < 3}>Submit Issue</Button>
          </form>
        </section>
        <section className="rounded-2xl border bg-white p-4">
          <h2 className="font-semibold">{data.isAdmin ? "All reported issues" : "My reported issues"}</h2>
          {data.complaints.length ? <div className="mt-3 space-y-3">{data.complaints.map((c) => <article key={c.id} className="rounded-lg border p-3"><div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{data.isAdmin ? c.executive + " · " + c.type : c.type}</strong><span className="font-semibold">{c.status}</span></div><p className="mt-2 whitespace-pre-wrap text-sm">{c.description}</p>{c.remark && <p className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-600">Admin: {c.remark}</p>}{data.isAdmin && c.status !== "Resolved" && <div className="mt-2"><Input value={remarks[c.id] ?? ""} onChange={(e) => setRemarks((old) => ({ ...old, [c.id]: e.target.value }))} placeholder="Resolution / Admin remark" /><Button className="mt-2" size="sm" onClick={() => resolveComplaint(c.id)} disabled={busy}>Mark Resolved</Button></div>}</article>)}</div> : <p className="mt-3 text-sm text-muted-foreground">No issues recorded.</p>}
        </section>
      </div>}

      {tab === "admin" && data.isAdmin && <div className="space-y-4">
        <section className="rounded-2xl border border-amber-300 bg-amber-50/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">Schedule allocator</h2><span className="text-xs text-muted-foreground">Admin only · Google Sheets</span></div>
          <form onSubmit={submitSchedule} className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-slate-600">Executive<select className="h-11 rounded-md border bg-white px-3 text-sm font-normal text-slate-900" value={schedule.executive} onChange={(e) => setSchedule((old) => ({ ...old, executive: e.target.value as (typeof EXECUTIVES)[number] }))}>{EXECUTIVES.map((name) => <option key={name}>{name}</option>)}</select></label>
            <label className="grid gap-1 text-xs font-semibold text-slate-600">Date<Input type="date" value={schedule.date} onChange={(e) => setSchedule((old) => ({ ...old, date: e.target.value }))} required /></label>
            <label className="grid gap-1 text-xs font-semibold text-slate-600">Start time<Input type="time" value={schedule.start} onChange={(e) => setSchedule((old) => ({ ...old, start: e.target.value }))} required /></label>
            <label className="grid gap-1 text-xs font-semibold text-slate-600">End time<Input type="time" value={schedule.end} onChange={(e) => setSchedule((old) => ({ ...old, end: e.target.value }))} required /></label>
            <div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="button" size="sm" variant="outline" onClick={() => setSchedule((old) => ({ ...old, start: "10:00", end: "11:30" }))}>Morning · 10:00–11:30</Button><Button type="button" size="sm" variant="outline" onClick={() => setSchedule((old) => ({ ...old, start: "14:00", end: "15:30" }))}>Afternoon · 14:00–15:30</Button></div>
            <div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={busy || !schedule.date}>{scheduleEditingId ? "Save Changes" : "Allocate Slot"}</Button>{scheduleEditingId && <Button type="button" variant="outline" onClick={() => { setScheduleEditingId(""); setSchedule((old) => ({ ...old, start: "10:00", end: "11:30" })); }}>Cancel Edit</Button>}</div>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">Overlapping slots are blocked. To reallocate, edit the existing slot or cancel it with a reason.</p>
        </section>

        <section className="rounded-2xl border bg-white p-4">
          <h3 className="font-semibold">Today's allocated slots</h3>
          <div className="mt-3 space-y-3">{data.portalTimings.length ? data.portalTimings.map((slot) => <div key={slot.id} className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2 text-sm"><strong>{slot.executive} · {slot.start}–{slot.end}</strong><span className="text-xs text-muted-foreground">{slot.status}</span></div><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => editSlot(slot)}>Edit / Reallocate</Button><Input className="min-w-0 flex-1" value={cancelReasons[slot.id] ?? ""} onChange={(e) => setCancelReasons((old) => ({ ...old, [slot.id]: e.target.value }))} placeholder="Cancellation reason" /><Button size="sm" variant="destructive" onClick={() => cancelSlot(slot.id)} disabled={busy}>Cancel</Button></div></div>) : <p className="text-sm text-muted-foreground">No slots for today.</p>}</div>
        </section>

        <section className="rounded-2xl border bg-white p-4">
          <h3 className="font-semibold">Active sessions · Force close</h3>
          {data.liveSessions.length ? <div className="mt-3 space-y-3">{data.liveSessions.map((s) => <div key={s.id} className="rounded-lg border p-3"><div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{s.executive}</strong><span>{s.loginTime} · {formatMinutes(Math.max(0, Math.floor((Date.now() - s.startedAt) / 60_000)))} active</span></div><div className="mt-2 flex flex-col gap-2 sm:flex-row"><Input value={forceReasons[s.id] ?? ""} onChange={(e) => setForceReasons((old) => ({ ...old, [s.id]: e.target.value }))} placeholder="Reason for force close (required)" /><Button size="sm" variant="destructive" onClick={() => forceClose(s.id)} disabled={busy || (forceReasons[s.id] ?? "").trim().length < 3}>End Session & Free Portal</Button></div></div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">No active sessions. Portal is free.</p>}
        </section>

        <form onSubmit={issueWarning} className="rounded-2xl border bg-white p-4">
          <h3 className="font-semibold">Issue executive warning</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2"><select className="h-11 rounded-md border bg-white px-3 text-sm" value={warningName} onChange={(e) => setWarningName(e.target.value as (typeof EXECUTIVES)[number])}>{EXECUTIVES.map((name) => <option key={name}>{name}</option>)}</select><Input value={warningReason} onChange={(e) => setWarningReason(e.target.value)} placeholder="Reason for warning" required /></div>
          <Button className="mt-3" type="submit" disabled={busy || !warningReason.trim()}>Issue Warning</Button>
        </form>
      </div>}
    </main>
  );
}
