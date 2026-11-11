import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBankPortalData } from "@/lib/bank-portal.functions";

type Props = { className?: string };

export function PortalTimingsPanel({ className = "" }: Props) {
  const load = useServerFn(getBankPortalData);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["bank-portal"],
    queryFn: () => load(),
    refetchOnWindowFocus: false,
    refetchInterval: false,
    retry: false,
  });
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  // Permanent presets are the recurring daily schedule; fall back to today's
  // allocated timings for older configurations that have no presets yet.
  const timings = data?.schedulePresets?.length ? data.schedulePresets : data?.portalTimings ?? [];
  const now = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(clock);
  const current = timings.find((slot) => now >= slot.start && now < slot.end);

  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Current Bank Portal Slot</h2>
          <p className="text-xs text-muted-foreground">Live status · India Standard Time</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${current ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
          {current ? "ACTIVE NOW" : "NO ACTIVE SLOT"}
        </span>
      </div>

      {isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading current slot…</p>
      ) : isError ? (
        <p className="mt-3 text-sm text-muted-foreground">Current slot is temporarily unavailable.</p>
      ) : current ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-slate-900">{current.executive}</p>
            <p className="text-xs text-amber-800">Executive on duty</p>
          </div>
          <p className="shrink-0 font-mono text-base font-semibold tabular-nums text-slate-900">
            {current.start} – {current.end}
          </p>
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-muted-foreground">
          Abhi koi executive slot active nahi hai.
        </p>
      )}
    </section>
  );
}
