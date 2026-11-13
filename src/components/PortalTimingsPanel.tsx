import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  endBankPortalSession,
  getBankPortalData,
  startBankPortalSession,
} from "@/lib/bank-portal.functions";

type Props = { className?: string };

/**
 * Shows actual Bank Portal session occupancy, the currently scheduled slot,
 * and the existing Start / End session actions. It deliberately does not poll.
 */
export function PortalTimingsPanel({ className = "" }: Props) {
  const queryClient = useQueryClient();
  const load = useServerFn(getBankPortalData);
  const start = useServerFn(startBankPortalSession);
  const end = useServerFn(endBankPortalSession);
  const [busy, setBusy] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["bank-portal"],
    queryFn: () => load(),
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: false,
    retry: false,
  });

  const activeSession =
    data?.latestPortalSession?.status?.trim().toLowerCase() === "active"
      ? data.latestPortalSession
      : null;
  const ownActiveSession = data?.activeSession ?? null;
  const portalOccupied = Boolean(data?.liveSessions?.length);
  const otherExecutive = data?.liveSessions?.find(
    (session) => session.executive !== data.session.name,
  );

  // Keep the previously displayed "whose time is currently running" detail.
  // This scheduled slot is intentionally separate from actual portal occupancy.
  const currentTimeIST = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  const currentSlot =
    data?.schedulePresets?.find(
      (slot) => slot.start <= currentTimeIST && currentTimeIST < slot.end,
    ) ?? null;

  // Refresh exactly at permanent executive slot boundaries (start/end), not by polling.
  // The special Ankita batch window is included as well.
  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;

    const scheduleNextBoundaryRefresh = () => {
      if (cancelled) return;
      const boundaries = new Set<string>(["18:30", "19:30"]);
      for (const slot of data?.schedulePresets ?? []) {
        if (slot.start) boundaries.add(slot.start);
        if (slot.end) boundaries.add(slot.end);
      }

      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).formatToParts(new Date());
      const getPart = (type: string) =>
        Number(parts.find((part) => part.type === type)?.value ?? 0);
      const nowMinutes = getPart("hour") * 60 + getPart("minute") + getPart("second") / 60;
      const nextDelta = [...boundaries].reduce((nearest, value) => {
        const match = value.match(/^(\\d{1,2}):(\\d{2})$/);
        if (!match) return nearest;
        const target = Number(match[1]) * 60 + Number(match[2]);
        let delta = target - nowMinutes;
        if (delta <= 0) delta += 24 * 60;
        return Math.min(nearest, delta);
      }, 24 * 60);

      const delay = Math.max(250, Math.ceil(nextDelta * 60_000));
      timer = window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ["bank-portal"] });
        scheduleNextBoundaryRefresh();
      }, delay);
    };

    scheduleNextBoundaryRefresh();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [queryClient, data?.schedulePresets]);

  async function handleStart() {
    setBusy(true);
    try {
      await start();
      toast.success("Bank Portal session started.");
      await queryClient.invalidateQueries({ queryKey: ["bank-portal"] });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start the Bank Portal session.",
      );
      await queryClient.invalidateQueries({ queryKey: ["bank-portal"] });
    } finally {
      setBusy(false);
    }
  }

  async function handleEnd() {
    if (!ownActiveSession) return;
    if (!window.confirm("End your Bank Portal session?")) return;
    setBusy(true);
    try {
      await end({ data: { sessionId: ownActiveSession.id } });
      toast.success("Bank Portal session ended.");
      await queryClient.invalidateQueries({ queryKey: ["bank-portal"] });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not end the Bank Portal session.",
      );
      await queryClient.invalidateQueries({ queryKey: ["bank-portal"] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}
      aria-live="polite"
      aria-label="Current Bank Portal usage status"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-900">Current Bank Portal Status</h2>
          <p className="text-xs text-muted-foreground">Actual session status · IST</p>
        </div>
        {!isLoading && !isError && (
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
              activeSession
                ? "bg-amber-100 text-amber-900"
                : "border border-slate-200 bg-slate-50 text-slate-700"
            }`}
          >
            {activeSession ? "IN USE" : "FREE"}
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="mt-3 rounded-lg border bg-slate-50 px-4 py-3 text-sm text-muted-foreground">
          Loading portal status…
        </p>
      ) : isError || !data ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Portal status is temporarily unavailable. Reopen the page or try again.
        </p>
      ) : (
        <>
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Currently running time
            </p>
            {currentSlot ? (
              <>
                <p className="mt-1 truncate text-base font-semibold text-slate-900">
                  {currentSlot.executive}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  Scheduled slot: {currentSlot.start} – {currentSlot.end} IST
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm font-medium text-slate-700">
                No executive time slot is currently running.
              </p>
            )}
          </div>

          {activeSession ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="truncate text-base font-semibold text-slate-900">
                {activeSession.executive} is using the Bank Portal
              </p>
              <p className="mt-1 text-xs text-amber-900">
                Session started at {activeSession.loginDate} {activeSession.loginTime} IST
              </p>
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
              Portal is not currently in use.
            </p>
          )}

          <div className="mt-3">
            {ownActiveSession ? (
              <button
                type="button"
                onClick={handleEnd}
                disabled={busy}
                className="min-h-11 w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Please wait…" : "End Session"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                disabled={busy || portalOccupied}
                className="min-h-11 w-full rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy
                  ? "Please wait…"
                  : portalOccupied
                    ? (otherExecutive?.executive ?? "Portal") + " is using the portal"
                    : "Start Session"}
              </button>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Session access rules and eligibility are checked by the existing Bank Portal workflow.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
