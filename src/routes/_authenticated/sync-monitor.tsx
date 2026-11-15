import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, ClipboardList, FileSpreadsheet, ShieldAlert, CheckCircle2, Clock3 } from "lucide-react";
import { toast } from "sonner";
import { getCurrentSession } from "@/lib/auth.functions";
import { getAdminCollections } from "@/lib/mahavtaar.functions";
import {
  getPaidFileAuditHistory,
  getDailyCollectionDacComparison,
  syncVerifiedDailyCollectionDac,
} from "@/lib/paid-file.functions";
import { formatAmount } from "@/lib/executives";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/sync-monitor")({
  beforeLoad: async () => {
    const session = await getCurrentSession();
    if (!session) throw redirect({ to: "/auth" });
    if (session.role !== "Admin") throw redirect({ to: "/" });
  },
  head: () => ({ meta: [{ title: "Sync Monitor — Mahavtaar Daily Collection" }] }),
  component: SyncMonitorPage,
});

type Collection = Awaited<ReturnType<typeof getAdminCollections>>[number] & { receiptDate?: string; receiptTime?: string };
type ReviewItem = Collection & { reviewReason: string };

function todayIndia() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function dateInIndia(value: unknown, fallback = "") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(parsed);
  }
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  return fallback;
}

function auditDateInIndia(value: string) {
  const dmy = String(value ?? "").match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  return dateInIndia(value);
}

function getReviewQueue(rows: Collection[]): ReviewItem[] {
  const parsed = rows.map((row) => {
    const remark = String(row.remark ?? "");
    const bbps = [...remark.matchAll(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/g)].map((m) => ({
      date: m[1] ?? "",
      time: m[2] ?? "",
    }));
    const receiptDate = String((row as Collection & { receiptDate?: string }).receiptDate ?? row.date ?? "").trim();
    const receiptTime = String((row as Collection & { receiptTime?: string }).receiptTime ?? row.time ?? "").trim();
    const events = bbps.length ? bbps : receiptDate && receiptTime && !/no time/i.test(receiptTime)
      ? [{ date: dateInIndia(receiptDate), time: receiptTime }]
      : [];
    const reasons: string[] = [];
    if (bbps.length > 1) reasons.push("One remark contains multiple BBPS timestamps");
    if (!events.length || events.some((event) => !event.date || !event.time)) reasons.push("Transaction date/time missing");
    return { row, events, reasons };
  });
  const owners = new Map<string, number[]>();
  for (const item of parsed) {
    for (const event of item.events) {
      const key = [
        String(item.row.loanId ?? "").trim(),
        Number(item.row.amount ?? 0).toFixed(2),
        event.date,
        event.time,
      ].join("|");
      const list = owners.get(key) ?? [];
      list.push(item.row.row);
      owners.set(key, list);
    }
  }
  const flagged: ReviewItem[] = [];
  for (const item of parsed) {
    const repeated = item.events.some((event) => {
      const key = [
        String(item.row.loanId ?? "").trim(),
        Number(item.row.amount ?? 0).toFixed(2),
        event.date,
        event.time,
      ].join("|");
      return (owners.get(key)?.length ?? 0) > 1;
    });
    const reasons = [...item.reasons];
    if (repeated) reasons.push("Same Loan ID, amount and transaction timestamp appears more than once");
    if (reasons.length) flagged.push({ ...item.row, reviewReason: reasons.join("; ") });
  }
  return flagged;
}

function MetricCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#e8e9eb] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-[#737b84]">{label}</p>
        <span className="grid size-9 place-items-center rounded-xl bg-[#fff6d9] text-[#80600a]">{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-black tracking-tight text-[#252525]">{value}</p>
      <p className="mt-1 text-xs text-[#737b84]">{detail}</p>
    </section>
  );
}

function SyncMonitorPage() {
  const fetchCollections = useServerFn(getAdminCollections);
  const fetchPaidAudit = useServerFn(getPaidFileAuditHistory);
  const fetchDacComparison = useServerFn(getDailyCollectionDacComparison);
  const runVerifiedSync = useServerFn(syncVerifiedDailyCollectionDac);
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const collectionsQuery = useQuery({
    queryKey: ["sync-monitor", "collections"],
    queryFn: () => fetchCollections(),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const comparisonQuery = useQuery({
    queryKey: ["sync-monitor", "daily-collection-dac"],
    queryFn: () => fetchDacComparison(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const syncMutation = useMutation({
    mutationFn: () => {
      if (!previewFingerprint) throw new Error("Create a fresh preview before confirming sync.");
      return runVerifiedSync({ data: { fingerprint: previewFingerprint } });
    },
    onSuccess: async (result) => {
      setPreviewFingerprint(null);
      toast.success(result.alreadySynced ? "Verified Daily Collection entries are already synced." : "Synced " + result.readyCount + " verified agreements; " + result.reviewCount + " rows remain in review.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sync-monitor", "daily-collection-dac"] }),
        queryClient.invalidateQueries({ queryKey: ["sync-monitor", "collections"] }),
        queryClient.invalidateQueries({ queryKey: ["sync-monitor", "paid-file-audit"] }),
      ]);
    },
    onError: (cause) => toast.error(cause instanceof Error ? cause.message : "Daily Collection sync failed."),
  });
  const auditQuery = useQuery({
    queryKey: ["sync-monitor", "paid-file-audit"],
    queryFn: () => fetchPaidAudit(),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const collections = (collectionsQuery.data ?? []) as Collection[];
  const audit = auditQuery.data;
  const today = todayIndia();

  const metrics = useMemo(() => {
    const todayRows = collections.filter((row) =>
      dateInIndia(row.createdAt, row.entryDate ?? row.date ?? "") === today,
    );
    const confirmed = todayRows.filter((row) => String(row.status ?? "").toUpperCase() === "CONFIRMED");
    const pending = todayRows.filter((row) => String(row.status ?? "").toUpperCase().includes("PENDING"));
    const previousPaidFile = todayRows.filter((row) => row.entryType === "Previous Paid File");
    const allPreviousPaidFile = collections.filter((row) => row.entryType === "Previous Paid File");
    return {
      todayCount: todayRows.length,
      todayConfirmed: confirmed.length,
      todayPending: pending.length,
      todayAmount: confirmed.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      previousPaidFileToday: previousPaidFile.length,
      previousPaidFileAll: allPreviousPaidFile.length,
      totalCollectionRows: collections.length,
    };
  }, [collections, today]);

  const reviewQueue = useMemo(() => getReviewQueue(collections), [collections]);
  const paidEntries = audit?.entries ?? [];
  const paidToday = paidEntries.filter((entry) => auditDateInIndia(entry.timestamp) === today);
  const appliedTotal = audit?.totalAppliedRows ?? paidEntries.reduce((sum, entry) => sum + Number(entry.recordsApplied || 0), 0);
  const appliedToday = audit?.todayAppliedRows ?? paidToday.reduce((sum, entry) => sum + Number(entry.recordsApplied || 0), 0);
  const paidFileConflicts = audit?.totalConflictsFlagged ?? paidEntries.reduce((sum, entry) => sum + Number(entry.conflictsFlagged || 0), 0);
  const comparison = comparisonQuery.data;
  const isLoading = collectionsQuery.isLoading || auditQuery.isLoading || comparisonQuery.isLoading;
  const isFetching = collectionsQuery.isFetching || auditQuery.isFetching;
  const error = collectionsQuery.error || auditQuery.error || comparisonQuery.error;

  async function refresh() {
    const results = await Promise.all([collectionsQuery.refetch(), auditQuery.refetch(), comparisonQuery.refetch()]);
    if (results.some((result) => result.error)) toast.error("Sync Monitor refresh failed. Please retry.");
    else toast.success("Sync Monitor refreshed.");
  }

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-5 px-3 pb-20 pt-5 sm:px-5 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Admin · Operations</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Data Sync Monitor</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Daily Collection activity, Paid File applications and review exceptions · India time
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild><Link to="/paid-file">Open Paid File</Link></Button>
          <Button variant="outline" onClick={() => setPreviewFingerprint(comparison?.fingerprint ?? null)} disabled={!comparison || syncMutation.isPending}>
            Preview sync
          </Button>
          {previewFingerprint && (
            <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending || !comparison || previewFingerprint !== comparison.fingerprint}>
              <RefreshCw className={syncMutation.isPending ? "mr-2 size-4 animate-spin" : "mr-2 size-4"} />
              {syncMutation.isPending ? "Applying confirmed sync…" : "Confirm & sync"}
            </Button>
          )}
          {previewFingerprint && (
            <Button variant="ghost" onClick={() => setPreviewFingerprint(null)} disabled={syncMutation.isPending}>
              Cancel preview
            </Button>
          )}
          <Button variant="outline" onClick={() => void refresh()} disabled={isFetching}>
            <RefreshCw className={`mr-2 size-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error instanceof Error ? error.message : "Could not load live collection or Paid File status."}
        </div>
      )}
      {isLoading ? (
        <div className="rounded-xl border bg-white p-6 text-sm text-muted-foreground">Loading live Google Sheets status…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <MetricCard label="Today's entries" value={metrics.todayCount.toLocaleString("en-IN")} detail={`${metrics.todayConfirmed} confirmed · ${metrics.todayPending} pending`} icon={<ClipboardList className="size-4" />} />
            <MetricCard label="Today's confirmed collection" value={formatAmount(metrics.todayAmount)} detail="Confirmed entries created today" icon={<CheckCircle2 className="size-4" />} />
            <MetricCard label="Previous Paid File entries" value={metrics.previousPaidFileToday.toLocaleString("en-IN")} detail={`${metrics.previousPaidFileAll} total entries in collection sheet`} icon={<FileSpreadsheet className="size-4" />} />
            <MetricCard label="Paid File rows applied" value={appliedTotal.toLocaleString("en-IN")} detail={`${appliedToday} applied in today's audit batches`} icon={<CheckCircle2 className="size-4" />} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
  
          <section className="rounded-2xl border border-[#e8e9eb] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-[#252525]">Daily Collection → Master DAC comparison</h2>
                <p className="mt-1 text-xs text-[#737b84]">
                  Verified / Corrected transactions are added to a separate Daily Collection Provisional DAC column. Existing Bank DAC, Total, New Total and Remaining are not overwritten.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Last sync: {comparison?.lastSync ?? "Not run"} · {comparison?.lastSyncStatus ?? "NOT RUN"} · {comparison?.lastSyncUpdatedRows ?? 0} Master rows updated · {formatAmount(comparison?.lastSyncProvisionalDac ?? 0)} provisional DAC · {comparison?.lastSyncReviewCount ?? 0} review rows
                </p>
              </div>
              <span className="rounded-full bg-[#fff6d9] px-3 py-1 text-xs font-bold text-[#80600a]">
                {comparison?.readyCount ?? 0} ready · {comparison?.reviewCount ?? 0} review
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div className="rounded-xl bg-[#fafafa] p-3"><p className="text-xs text-muted-foreground">Verified agreements</p><p className="mt-1 text-xl font-bold">{comparison?.readyCount ?? "—"}</p></div>
              <div className="rounded-xl bg-[#fafafa] p-3"><p className="text-xs text-muted-foreground">Verified transactions</p><p className="mt-1 text-xl font-bold">{comparison?.readyTransactions ?? "—"}</p></div>
              <div className="rounded-xl bg-[#fafafa] p-3"><p className="text-xs text-muted-foreground">Daily Collection DAC</p><p className="mt-1 text-xl font-bold">{formatAmount(comparison?.readyAmount ?? 0)}</p></div>
              <div className="rounded-xl bg-[#fafafa] p-3"><p className="text-xs text-muted-foreground">Provisional DAC to add</p><p className="mt-1 text-xl font-bold">{formatAmount(comparison?.provisionalDacToApply ?? 0)}</p></div><div className="rounded-xl bg-[#fafafa] p-3"><p className="text-xs text-muted-foreground">Needs review</p><p className="mt-1 text-xl font-bold">{comparison?.reviewCount ?? "—"}</p></div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[780px] text-left text-sm">
                <thead><tr className="border-b text-xs text-muted-foreground"><th className="px-2 py-2">Agreement ID</th><th className="px-2 py-2">Master row</th><th className="px-2 py-2">Bank DAC</th><th className="px-2 py-2">Daily Collection DAC</th><th className="px-2 py-2">Difference</th><th className="px-2 py-2">Source Type</th><th className="px-2 py-2">Status / reason</th></tr></thead>
                <tbody>{(comparison?.rows ?? []).slice(0, 25).map((row) => (
                  <tr key={row.row + "-" + row.agreementId} className="border-b last:border-0">
                    <td className="px-2 py-3 font-semibold">{row.agreementId || "—"}</td>
                    <td className="px-2 py-3 tabular-nums">{row.row}</td>
                    <td className="px-2 py-3 tabular-nums">{formatAmount(row.bankDac)}</td>
                    <td className="px-2 py-3 tabular-nums">{formatAmount(row.dailyCollectionDac)}</td>
                    <td className="px-2 py-3 tabular-nums">{formatAmount(row.difference)}</td>
                    <td className="px-2 py-3 text-xs">{row.sourceType}</td>
                    <td className="px-2 py-3 text-xs"><span className={row.status === "READY" ? "font-semibold text-amber-800" : "font-semibold text-red-700"}>{row.status}</span><span className="ml-2 text-muted-foreground">{row.reason}</span></td>
                  </tr>
                ))}</tbody>
              </table>
              {!comparison?.rows?.length && <p className="py-4 text-sm text-muted-foreground">No verified Daily Collection rows or review exceptions found.</p>}
              {(comparison?.rows?.length ?? 0) > 25 && <p className="mt-2 text-xs text-muted-foreground">Showing 25 of {comparison?.rows.length} comparison rows.</p>}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Preview is read-only. Only the separate Confirm &amp; sync action applies clean, unique, confirmed transactions. Missing timestamps, duplicate transaction keys, unverified rows and unmatched IDs stay in the Admin review queue. Previous Paid File entries are excluded.
            </p>
            {previewFingerprint && (
              <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                <strong>Sync preview ready.</strong> This confirmation will update {comparison?.readyCount ?? 0} Master Allocation rows with {formatAmount(comparison?.provisionalDacToApply ?? 0)} provisional DAC. {comparison?.reviewCount ?? 0} rows remain in review. Bank DAC, Total, New Total and Remaining are not targeted by this sync.
              </div>
            )}
          </section>
          <section className="rounded-2xl border border-[#e8e9eb] bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-bold text-[#252525]">Daily Collection status</h2>
                  <p className="mt-1 text-xs text-[#737b84]">Live read from the existing Collections sheet</p>
                </div>
                <span className="rounded-full bg-[#fff6d9] px-3 py-1 text-xs font-bold text-[#80600a]">{metrics.totalCollectionRows.toLocaleString("en-IN")} total rows</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl bg-[#fafafa] p-3"><p className="text-xs text-muted-foreground">Today</p><p className="mt-1 text-xl font-bold">{metrics.todayCount}</p></div>
                <div className="rounded-xl bg-[#fafafa] p-3"><p className="text-xs text-muted-foreground">Confirmed</p><p className="mt-1 text-xl font-bold">{metrics.todayConfirmed}</p></div>
                <div className="rounded-xl bg-[#fafafa] p-3"><p className="text-xs text-muted-foreground">Pending</p><p className="mt-1 text-xl font-bold">{metrics.todayPending}</p></div>
                <div className="rounded-xl bg-[#fafafa] p-3"><p className="text-xs text-muted-foreground">Previous Paid File today</p><p className="mt-1 text-xl font-bold">{metrics.previousPaidFileToday}</p></div>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">Counts use Created At in Asia/Kolkata; if Created At is unavailable, Entry Date is used.</p>
            </section>

            <section className="rounded-2xl border border-[#e8e9eb] bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div><h2 className="font-bold text-[#252525]">Paid File application status</h2><p className="mt-1 text-xs text-[#737b84]">Master Allocation audit log</p></div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${audit?.found ? "bg-[#fff6d9] text-[#80600a]" : "bg-red-50 text-red-700"}`}>{audit?.found ? "Connected" : "Unavailable"}</span>
              </div>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Audit batches recorded</span><strong>{audit?.totalBatches ?? paidEntries.length}</strong></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Rows applied today</span><strong>{appliedToday}</strong></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Conflicts flagged (loaded history)</span><strong>{paidFileConflicts}</strong></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Hash-chain integrity</span><strong>{audit?.chainValid ? "Valid" : `Broken at row ${audit?.brokenAtRow ?? "?"}`}</strong></div>
              </div>
              {paidEntries[0] && <p className="mt-4 rounded-xl bg-[#fafafa] p-3 text-xs text-muted-foreground">Latest file: <strong className="text-[#252525]">{paidEntries[0].fileName}</strong> · {paidEntries[0].applyStatus} · {paidEntries[0].recordsApplied} rows applied</p>}
              {!paidEntries.length && <p className="mt-4 text-xs text-muted-foreground">No Paid File audit batches are recorded for the current Master Allocation file.</p>}
            </section>
          </div>

          <section className="rounded-2xl border border-[#e8e9eb] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div><h2 className="font-bold text-[#252525]">Duplicate / transaction review queue</h2><p className="mt-1 text-xs text-[#737b84]">Checks Loan ID + Amount + BBPS transaction date + time</p></div>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800"><ShieldAlert className="size-3.5" /> {reviewQueue.length} needs review</span>
            </div>
            {reviewQueue.length ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead><tr className="border-b text-xs text-muted-foreground"><th className="px-2 py-2">Sheet row</th><th className="px-2 py-2">Loan ID</th><th className="px-2 py-2">Amount</th><th className="px-2 py-2">Payment date</th><th className="px-2 py-2">Reason</th></tr></thead>
                  <tbody>{reviewQueue.slice(0, 20).map((row) => <tr key={row.row} className="border-b last:border-0"><td className="px-2 py-3">{row.row}</td><td className="px-2 py-3 font-semibold">{row.loanId}</td><td className="px-2 py-3">{formatAmount(row.amount)}</td><td className="px-2 py-3">{row.date || "—"}</td><td className="px-2 py-3 text-xs text-amber-800">{row.reviewReason}</td></tr>)}</tbody>
                </table>
                {reviewQueue.length > 20 && <p className="mt-2 text-xs text-muted-foreground">Showing first 20 of {reviewQueue.length} flagged entries.</p>}
              </div>
            ) : <p className="mt-4 text-sm text-muted-foreground">No missing transaction timestamps or repeated transaction keys found in the current collection data.</p>}
          </section>

          <section className="rounded-2xl border border-[#e8e9eb] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-bold text-[#252525]">Recent Paid File activity</h2><p className="mt-1 text-xs text-[#737b84]">Latest 10 of {audit?.totalBatches ?? paidEntries.length} recorded batches</p></div><Link to="/paid-file" className="text-sm font-semibold text-amber-800 underline">Open reconciliation</Link></div>
            {paidEntries.length ? (
              <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="px-2 py-2">Timestamp</th><th className="px-2 py-2">File</th><th className="px-2 py-2">Admin</th><th className="px-2 py-2">Rows applied</th><th className="px-2 py-2">DAC</th><th className="px-2 py-2">Conflicts</th><th className="px-2 py-2">Status</th></tr></thead><tbody>{paidEntries.slice(0, 10).map((entry) => <tr key={entry.row} className="border-b last:border-0"><td className="px-2 py-3 whitespace-nowrap">{entry.timestamp}</td><td className="px-2 py-3">{entry.fileName}</td><td className="px-2 py-3">{entry.adminName}</td><td className="px-2 py-3 tabular-nums">{entry.recordsApplied}</td><td className="px-2 py-3 tabular-nums">{formatAmount(entry.totalDac)}</td><td className="px-2 py-3 tabular-nums">{entry.conflictsFlagged}</td><td className="px-2 py-3"><span className={`rounded-full px-2 py-1 text-[11px] font-bold ${entry.applyStatus === "COMPLETE" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"}`}>{entry.applyStatus}</span></td></tr>)}</tbody></table></div>
            ) : <p className="mt-4 text-sm text-muted-foreground">No recent Paid File activity is available.</p>}
          </section>

          <section className="rounded-2xl border border-amber-200 bg-[#fffaf0] p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-[#71520a]"><Clock3 className="size-4" /> Integration boundary</div>
            <p className="mt-2 text-sm text-[#665b3c]">This monitor reads the existing Collections and Paid File audit data every 30 seconds. Master Allocation changes require a fresh Admin preview and a separate confirmation. Sync audit events are recorded in the existing VerificationAudit tab; no new spreadsheet tab is created.</p>
          </section>
        </>
      )}
    </main>
  );
}
