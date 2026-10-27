import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Activity, CheckCircle2, Clock, History, Power, RotateCw, User, Users } from "lucide-react";
import { EXECUTIVES, type Executive } from "@/lib/executives";
import {
  formatDuration,
  getCashierLinkData,
  recordCashierLinkAction,
  type CashierLinkAction,
  type CashierLinkActivity,
} from "@/lib/cashier-link.functions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface CashierLinkPanelProps {
  selectedExecutive?: string;
  onExecutiveChange?: (exec: string) => void;
  className?: string;
  compact?: boolean;
}

export function CashierLinkPanel({
  selectedExecutive: parentExec,
  onExecutiveChange,
  className = "",
  compact = false,
}: CashierLinkPanelProps) {
  const [internalExec, setInternalExec] = useState<string>(EXECUTIVES[0]);
  const exec =
    parentExec && EXECUTIVES.includes(parentExec as Executive) ? parentExec : internalExec;

  const handleSelectExec = (val: string) => {
    setInternalExec(val);
    if (onExecutiveChange) {
      onExecutiveChange(val);
    }
  };

  const qc = useQueryClient();
  const fetchLinkData = useServerFn(getCashierLinkData);
  const recordAction = useServerFn(recordCashierLinkAction);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["cashierLinkData"],
    queryFn: async () => {
      const res = await fetchLinkData();
      return res;
    },
    refetchInterval: 15_000, // auto-refresh status every 15s
  });

  const [acting, setActing] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<string>("ALL");

  const statuses = data?.executiveStatuses;
  const currentStatus = statuses?.[exec];
  const isOnline = Boolean(currentStatus?.isOnline);

  // Live active duration ticker for currently ON executive
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (!isOnline) return;
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isOnline]);

  const liveDuration = useMemo(() => {
    if (!isOnline || !currentStatus?.onCreatedAt) return null;
    const onMs = new Date(currentStatus.onCreatedAt).getTime();
    if (Number.isNaN(onMs)) return null;
    const diffSec = Math.max(0, Math.round((nowTick - onMs) / 1000));
    return formatDuration(diffSec);
  }, [isOnline, currentStatus?.onCreatedAt, nowTick]);

  const handleAction = async (action: CashierLinkAction) => {
    if (!exec) {
      toast.error("Please select an executive first.");
      return;
    }

    if (action === "ON" && isOnline) {
      toast.warning(`Cashier Link is already ON for ${exec}.`);
      return;
    }

    if (action === "OFF" && !isOnline) {
      toast.warning(`Cashier Link is already OFF for ${exec}.`);
      return;
    }

    setActing(true);
    try {
      const res = await recordAction({
        data: {
          executive: exec as Executive,
          action,
        },
      });

      if (action === "ON") {
        toast.success(`Cashier Link turned ON for ${exec}`);
      } else {
        toast.success(
          `Cashier Link turned OFF for ${exec} (Active for ${res?.activity?.durationDisplay || "—"})`,
        );
      }

      await qc.invalidateQueries({ queryKey: ["cashierLinkData"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to record Cashier Link action.";
      toast.error(msg);
    } finally {
      setActing(false);
    }
  };

  const filteredActivities = useMemo(() => {
    const list = data?.activities ?? [];
    if (historyFilter === "ALL") return list;
    return list.filter((a) => a.executive === historyFilter);
  }, [data?.activities, historyFilter]);

  const activeCount = data?.activeCount ?? 0;

  return (
    <div
      className={`rounded-xl border bg-card text-card-foreground shadow-sm transition-all ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="text-base font-bold tracking-tight">Cashier ID Link</h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={activeCount > 0 ? "default" : "secondary"}
            className={`text-xs font-semibold ${
              activeCount > 0
                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {activeCount} {activeCount === 1 ? "Active" : "Active"}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh status"
          >
            <RotateCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Executive Selector */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Select Executive
            </Label>
            {currentStatus && (
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    isOnline ? "bg-emerald-500 animate-pulse" : "bg-slate-300"
                  }`}
                />
                <span className={isOnline ? "text-emerald-700" : "text-muted-foreground"}>
                  {isOnline ? "Link ON" : "Link OFF"}
                </span>
              </span>
            )}
          </div>

          <Select value={exec} onValueChange={handleSelectExec}>
            <SelectTrigger className="h-11 text-sm font-medium">
              <SelectValue placeholder="Select executive" />
            </SelectTrigger>
            <SelectContent>
              {EXECUTIVES.map((e) => {
                const s = statuses?.[e];
                const on = Boolean(s?.isOnline);
                return (
                  <SelectItem key={e} value={e} className="text-sm">
                    <div className="flex items-center justify-between gap-4 w-full">
                      <span>{e}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          on ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {on ? "ON" : "OFF"}
                      </span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {/* Current Selected Executive Status Card */}
        <div
          className={`rounded-lg border p-3 transition-colors ${
            isOnline
              ? "border-emerald-200 bg-emerald-50/70 text-emerald-950"
              : "border-slate-200 bg-slate-50/70 text-slate-900"
          }`}
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold">{exec}&apos;s Cashier Link Status</span>
            <span
              className={`rounded px-1.5 py-0.5 font-bold ${
                isOnline ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700"
              }`}
            >
              {isOnline ? "ACTIVE (ON)" : "INACTIVE (OFF)"}
            </span>
          </div>

          {isOnline ? (
            <div className="mt-2 space-y-1 text-xs">
              <div className="flex items-center gap-1.5 text-emerald-800">
                <Clock className="h-3.5 w-3.5" />
                <span>
                  Started: <strong>{currentStatus?.lastTime}</strong> ({currentStatus?.lastDate})
                </span>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-emerald-900 font-bold">
                <Power className="h-3.5 w-3.5 text-emerald-600" />
                <span>Running Duration: {liveDuration || "0s"}</span>
              </div>
            </div>
          ) : (
            <div className="mt-2 text-xs text-muted-foreground">
              {currentStatus?.lastAction === "OFF" && currentStatus.lastDurationDisplay ? (
                <span>
                  Last active: <strong>{currentStatus.lastDurationDisplay}</strong> (at{" "}
                  {currentStatus.lastTime})
                </span>
              ) : (
                <span>Currently offline. Tap &quot;Turn ON&quot; to begin session tracking.</span>
              )}
            </div>
          )}
        </div>

        {/* ON / OFF Action Buttons */}
        <div className="grid grid-cols-2 gap-2.5">
          <Button
            type="button"
            className="h-11 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40"
            disabled={acting || isOnline}
            onClick={() => handleAction("ON")}
          >
            <Power className="mr-1.5 h-4 w-4" />
            {isOnline ? "Already ON" : "Turn ON"}
          </Button>

          <Button
            type="button"
            variant="outline"
            className="h-11 text-sm font-bold border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-40"
            disabled={acting || !isOnline}
            onClick={() => handleAction("OFF")}
          >
            <Power className="mr-1.5 h-4 w-4" />
            {!isOnline ? "Already OFF" : "Turn OFF"}
          </Button>
        </div>

        {/* Quick Executive Status Avatars/Pills */}
        <div className="pt-1 border-t">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
            <span className="font-medium flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              All Executives
            </span>
            <span>Tap to switch</span>
          </div>

          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
            {EXECUTIVES.map((e) => {
              const on = Boolean(statuses?.[e]?.isOnline);
              const isSelected = exec === e;
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => handleSelectExec(e)}
                  className={`flex flex-col items-center justify-center rounded-lg border p-1.5 text-center transition-all ${
                    isSelected
                      ? "border-primary bg-primary/10 shadow-xs"
                      : "border-slate-200 hover:bg-muted"
                  }`}
                  title={`${e}: ${on ? "ON" : "OFF"}`}
                >
                  <span
                    className={`inline-block h-2 w-2 rounded-full mb-1 ${
                      on ? "bg-emerald-500 animate-pulse" : "bg-slate-300"
                    }`}
                  />
                  <span className="text-[11px] font-semibold truncate w-full">{e}</span>
                  <span
                    className={`text-[9px] font-bold ${
                      on ? "text-emerald-700" : "text-muted-foreground"
                    }`}
                  >
                    {on ? "ON" : "OFF"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Recent Activity History Feed */}
        <div className="pt-2 border-t space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <History className="h-3.5 w-3.5 text-muted-foreground" />
              Activity History
            </span>

            <Select value={historyFilter} onValueChange={setHistoryFilter}>
              <SelectTrigger className="h-7 w-28 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL" className="text-xs">
                  All Staff
                </SelectItem>
                {EXECUTIVES.map((e) => (
                  <SelectItem key={e} value={e} className="text-xs">
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground">
              Loading activity history...
            </div>
          ) : filteredActivities.length === 0 ? (
            <div className="rounded-lg border border-dashed py-4 text-center text-xs text-muted-foreground">
              No activity logs recorded yet.
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-lg border divide-y bg-muted/10 text-xs">
              {filteredActivities.slice(0, 30).map((act) => {
                const isOn = act.action === "ON";
                return (
                  <div
                    key={act.id}
                    className="flex items-center justify-between p-2 hover:bg-muted/30 transition-colors"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-foreground">{act.executive}</span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1 py-0 font-bold ${
                            isOn
                              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                              : "border-slate-300 bg-slate-100 text-slate-700"
                          }`}
                        >
                          {act.action}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {act.date} · {act.time}
                      </p>
                    </div>

                    <div className="text-right">
                      {!isOn && act.durationDisplay && act.durationDisplay !== "—" ? (
                        <div className="font-mono font-semibold text-slate-800 text-[11px]">
                          ⏱ {act.durationDisplay}
                        </div>
                      ) : (
                        <div className="text-[10px] text-muted-foreground">Session start</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
