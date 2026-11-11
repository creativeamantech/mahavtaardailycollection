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
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(clock);
  const current = timings.find((slot) => now >= slot.start && now < slot.end);

  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-900">Today’s Bank Portal Timings</h2>
          <p className="text-xs text-muted-foreground">Live schedule · India Standard Time</p>
        </div>
        {current && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">Current: {current.executive}</span>}
      </div>
      {isLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading portal timings…</p>
        : isError ? <p className="mt-3 text-sm text-muted-foreground">Portal timings are temporarily unavailable.</p>
        : timings.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No portal timings have been allocated for today.</p>
        : <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {timings.map((slot, index) => (
            <div key={slot.id || `${slot.executive}-${slot.start}-${index}`} className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-sm ${current?.id === slot.id ? "border-amber-400 bg-amber-50 ring-1 ring-amber-300" : "bg-slate-50"}`}>
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{slot.executive}</p>
                <p className="text-xs text-muted-foreground">{"slot" in slot ? (slot.slot === "SLOT_1" ? "Slot 1 · Permanent" : "Slot 2 · Permanent") : slot.status || "Scheduled"}</p>
              </div>
              <p className="shrink-0 font-mono font-semibold tabular-nums">{slot.start} – {slot.end}</p>
            </div>
          ))}
        </div>}
    </section>
  );
}
