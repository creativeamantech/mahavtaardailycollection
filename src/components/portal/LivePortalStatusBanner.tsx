import { Link } from "@tanstack/react-router";
import { formatDuration, useLivePortalStatus } from "@/hooks/useLivePortalStatus";
import { ArrowRight, Clock, ShieldAlert, User, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Props {
  compact?: boolean;
}

export function LivePortalStatusBanner({ compact = false }: Props) {
  const {
    isPortalActive,
    activeSession,
    currentScheduled,
    nextScheduled,
    elapsedSeconds,
    remainingSeconds,
    isNearExpiry,
    isAnkitaBatchWindow,
  } = useLivePortalStatus();

  const isTemporary = activeSession?.sessionType === "TEMPORARY";
  const isScheduledMatch =
    isPortalActive && currentScheduled && activeSession?.executive === currentScheduled.executive;

  return (
    <div
      className={`relative overflow-hidden rounded-xl border transition-all ${
        isPortalActive
          ? isNearExpiry
            ? "border-red-500 bg-red-50/70 dark:bg-red-950/20"
            : "border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/20"
          : "border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/30"
      } p-4 shadow-sm`}
    >
      {/* Top Bar with Live Indicator & Title */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            {isPortalActive ? (
              <>
                <span
                  className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
                    isNearExpiry ? "bg-red-500" : "bg-emerald-500"
                  }`}
                />
                <span
                  className={`relative inline-flex h-3 w-3 rounded-full ${
                    isNearExpiry ? "bg-red-600" : "bg-emerald-600"
                  }`}
                />
              </>
            ) : (
              <span className="inline-flex h-3 w-3 rounded-full bg-slate-400" />
            )}
          </span>
          <span className="font-semibold text-sm sm:text-base">
            Bank Portal Status:{" "}
            <span
              className={
                isPortalActive
                  ? isNearExpiry
                    ? "text-red-700 font-bold"
                    : "text-emerald-700 font-bold"
                  : "text-slate-600 font-medium"
              }
            >
              {isPortalActive ? "ACTIVE" : "INACTIVE"}
            </span>
          </span>
          {isTemporary && (
            <Badge
              variant="outline"
              className="border-amber-400 bg-amber-100 text-amber-800 text-xs"
            >
              Temporary Access (7m 15s)
            </Badge>
          )}
          {isAnkitaBatchWindow && (
            <Badge
              variant="outline"
              className="border-purple-400 bg-purple-100 text-purple-800 text-xs"
            >
              Batch Handling Window
            </Badge>
          )}
        </div>

        {compact && (
          <Link
            to="/bank-portal"
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            Open Portal Module <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>

      {/* Grid of 4 Key Status Elements */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* 1. Currently Using Portal */}
        <div className="rounded-lg border bg-background/80 p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <User className="h-3.5 w-3.5 text-primary" />
            <span>Currently Using Portal</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-1">
            <p className="text-base font-bold">
              {isPortalActive && activeSession ? (
                <span className="text-primary">{activeSession.executive}</span>
              ) : (
                <span className="text-muted-foreground font-normal italic">
                  Portal Currently Inactive
                </span>
              )}
            </p>
            {isPortalActive && activeSession && (
              <span
                className={`text-[11px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                  isScheduledMatch
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                {isScheduledMatch ? "On Slot" : activeSession.sessionType}
              </span>
            )}
          </div>
          {isPortalActive && activeSession?.reason && (
            <p
              className="mt-0.5 text-xs text-muted-foreground truncate"
              title={activeSession.reason}
            >
              Reason: {activeSession.reason}
            </p>
          )}
        </div>

        {/* 2. Current Time Slot (Scheduled Executive) */}
        <div className="rounded-lg border bg-background/80 p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span>Current Scheduled Slot</span>
          </div>
          <div className="mt-1">
            {currentScheduled ? (
              <>
                <p className="text-base font-bold">
                  {currentScheduled.executive}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({currentScheduled.formattedSlot})
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Entitled Slot: {currentScheduled.start}–{currentScheduled.end}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground italic">No scheduled slot right now</p>
            )}
          </div>
        </div>

        {/* 3. Session Duration / Timer */}
        <div className="rounded-lg border bg-background/80 p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5 text-amber-600" />
            <span>Session Duration</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <p className="font-mono text-xl font-bold tracking-tight">
              {isPortalActive ? formatDuration(elapsedSeconds) : "--:--"}
            </p>
            {isPortalActive && remainingSeconds !== null && (
              <span
                className={`text-xs font-medium ${
                  isNearExpiry ? "text-red-600 font-bold animate-pulse" : "text-muted-foreground"
                }`}
              >
                ({formatDuration(remainingSeconds)} left)
              </span>
            )}
          </div>
          {isNearExpiry && (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-red-600">
              <ShieldAlert className="h-3 w-3" /> Temporary slot expiring soon!
            </p>
          )}
        </div>

        {/* 4. Next Executive & Slot */}
        <div className="rounded-lg border bg-background/80 p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
            <span>Next Executive</span>
          </div>
          <div className="mt-1">
            {nextScheduled ? (
              <>
                <p className="text-base font-bold">{nextScheduled.executive}</p>
                <p className="text-xs text-muted-foreground">
                  Upcoming: {nextScheduled.formattedSlot}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground italic">Schedule ended for today</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
