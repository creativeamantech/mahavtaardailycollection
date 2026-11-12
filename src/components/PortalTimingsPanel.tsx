import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBankPortalData } from "@/lib/bank-portal.functions";

type Props = { className?: string };

function formatElapsed(minutes: number) {
  if (minutes < 1) return "less than 1 min";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Shows actual Bank Portal session occupancy, not the executive's scheduled slot.
 * The same component is shared by Entry and Reports so both pages use one source
 * of truth and identical status semantics.
 */
export function PortalTimingsPanel({ className = "" }: Props) {
  const load = useServerFn(getBankPortalData);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["bank-portal"],
    queryFn: () => load(),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const activeSession = data?.liveSessions?.[0] ?? null;
  const startedAt = activeSession?.startedAt;
  const elapsedMinutes =
    typeof startedAt === "number" && Number.isFinite(startedAt)
      ? Math.max(0, Math.floor((clock - startedAt) / 60_000))
      : null;

  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}
      aria-live="polite"
      aria-label="Current Bank Portal usage status"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-900">Current Bank Portal Status</h2>
          <p className="text-xs text-muted-foreground">Actual session status · Live · IST</p>
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
          Portal status is temporarily unavailable. Please retry shortly.
        </p>
      ) : activeSession ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="truncate text-base font-semibold text-slate-900">
            {activeSession.executive} is using the Bank Portal
          </p>
          <p className="mt-1 text-xs text-amber-900">
            Session started at {activeSession.loginTime}
            {elapsedMinutes !== null ? ` · Active for ${formatElapsed(elapsedMinutes)}` : ""}
          </p>
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
          Portal is not currently in use.
        </p>
      )}
    </section>
  );
}
