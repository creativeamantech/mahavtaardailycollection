import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, ShieldCheck, Volume2, MessageSquareWarning } from "lucide-react";
import { toast } from "sonner";
import { EXECUTIVES } from "@/lib/executives";
import { getCurrentSession } from "@/lib/auth.functions";
import { castTeamMeterVote, getTeamMeter } from "@/lib/team-meter.functions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Category = "Loud Voice" | "Bad Words";

export function TeamMeter() {
  const [target, setTarget] = useState("");
  const [viewExecutive, setViewExecutive] = useState("");
  const [category, setCategory] = useState<Category | "">("");
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const loadMeter = useServerFn(getTeamMeter);
  const submitVote = useServerFn(castTeamMeterVote);
  const loadSession = useServerFn(getCurrentSession);

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["team-meter"],
    queryFn: () => loadMeter(),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
  const { data: session } = useQuery({
    queryKey: ["auth-session"],
    queryFn: () => loadSession(),
    staleTime: 30_000,
  });

  const selectedTotals = useMemo(
    () => data?.executiveTotals.find((item) => item.name === viewExecutive),
    [data?.executiveTotals, target],
  );

  async function vote() {
    setSaving(true);
    try {
      if (!target || !category) return;
      await submitVote({ data: { target, category } });
      toast.success(`Vote recorded for ${target} — ${category}.`);
      await queryClient.invalidateQueries({ queryKey: ["team-meter"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Vote could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-5 rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight">Daily Team Meter</h2>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">9 AM – 9 PM</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Hourly votes for today · {data?.date ?? "Loading date…"}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-amber-50 p-3 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="flex items-center gap-2 text-sm font-semibold"><Volume2 className="h-4 w-4" /> Loud Voice</div>
          <p className="mt-1 text-2xl font-bold">{selectedTotals?.loudVoice ?? "—"}</p>
          <p className="text-xs opacity-75">{viewExecutive ? "Votes for " + viewExecutive : "Select an executive below"}</p>
        </div>
        <div className="rounded-xl bg-rose-50 p-3 text-rose-950 dark:bg-rose-950/30 dark:text-rose-100">
          <div className="flex items-center gap-2 text-sm font-semibold"><MessageSquareWarning className="h-4 w-4" /> Bad Words</div>
          <p className="mt-1 text-2xl font-bold">{selectedTotals?.badWords ?? "—"}</p>
          <p className="text-xs opacity-75">Votes for {target}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Hourly meter</h3>
          <Select value={viewExecutive} onValueChange={setViewExecutive}>
            <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Select executive" /></SelectTrigger>
            <SelectContent>
              {EXECUTIVES.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {isLoading ? (
          <p className="py-5 text-center text-sm text-muted-foreground">Loading hourly meter…</p>
        ) : error ? (
          <p className="py-5 text-center text-sm text-destructive">Could not load the team meter. Please refresh.</p>
        ) : (
          <div className="divide-y">
            {!viewExecutive ? (
              <p className="py-5 text-center text-sm text-muted-foreground">Select an executive to view hourly votes.</p>
            ) : (data?.hourly ?? []).map((slot) => {
              const selectedHour = data?.hourlyByExecutive?.[viewExecutive]?.[slot.hour];
              return (
                <div key={slot.hour} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-2 text-sm">
                  <span className="font-medium">{slot.label}</span>
                  <span className="min-w-20 text-right text-amber-700 dark:text-amber-300">Voice: {selectedHour?.loudVoice ?? 0}</span>
                  <span className="min-w-20 text-right text-rose-700 dark:text-rose-300">Words: {selectedHour?.badWords ?? 0}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-4 rounded-xl border p-3">
        <h3 className="font-semibold">Cast a vote</h3>
        <p className="mt-1 text-xs text-muted-foreground">One vote per executive, category and hour. Admin can vote too.</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="h-11"><SelectValue placeholder="Select executive" /></SelectTrigger>
            <SelectContent>
              {EXECUTIVES.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={(value) => setCategory(value as Category)}>
            <SelectTrigger className="h-11"><SelectValue placeholder="Select category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Loud Voice">Loud Voice</SelectItem>
              <SelectItem value="Bad Words">Bad Words</SelectItem>
            </SelectContent>
          </Select>
          <Button type="button" className="h-11" onClick={vote} disabled={saving || !data?.canVote || !target || !category || (session?.role !== "Admin" && session?.name === target)}>
            {saving ? "Saving…" : "Vote"}
          </Button>
        </div>
        {!data?.canVote && <p className="mt-2 text-xs font-medium text-muted-foreground">Voting is closed. It is available daily from 9:00 AM to 9:00 PM.</p>}
        {session?.name === target && session.role !== "Admin" && <p className="mt-2 text-xs text-destructive">You cannot vote for yourself.</p>}
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        Voter names are hidden from executives. Only Admin can see who voted for whom.
      </div>

      {session?.role === "Admin" && (
        <details className="mt-3 rounded-xl border p-3">
          <summary className="cursor-pointer text-sm font-semibold">Admin only · Voting details</summary>
          <div className="mt-3 space-y-2">
            {(data?.adminRecords ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No votes recorded today.</p>
            ) : (
              data!.adminRecords.map((record, index) => (
                <div key={`${record.timestamp}-${index}`} className="grid grid-cols-2 gap-1 border-b pb-2 text-xs sm:grid-cols-4">
                  <span>Voter: <strong>{record.voter}</strong></span>
                  <span>Target: <strong>{record.target}</strong></span>
                  <span>{record.category}</span>
                  <span>{record.hour}:00 · {record.timestamp}</span>
                </div>
              ))
            )}
          </div>
        </details>
      )}
    </section>
  );
}
