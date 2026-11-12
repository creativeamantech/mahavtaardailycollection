import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBankPortalData } from "@/lib/bank-portal.functions";

type Props = { className?: string };

/**
 * Shows actual Bank Portal session occupancy, not the executive's scheduled slot.
 * The shared panel refreshes when it mounts, when the app/tab regains focus, or
 * when the network reconnects. It deliberately does not poll Google Sheets.
 */
export function PortalTimingsPanel({ className = "" }: Props) {
  const load = useServerFn(getBankPortalData);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["bank-portal"],
    queryFn: () => load(),
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: false,
    retry: false,
  });

  const activeSession = data?.liveSessions?.[0] ?? null;

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
      ) : activeSession ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="truncate text-base font-semibold text-slate-900">
            {activeSession.executive} is using the Bank Portal
          </p>
          <p className="mt-1 text-xs text-amber-900">
            Session started at {activeSession.loginTime}
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
