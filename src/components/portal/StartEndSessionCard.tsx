import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SESSION_REASONS, type PortalExecutive, type SessionReason } from "@/lib/portal-types";
import {
  startPortalSession,
  endPortalSession,
  recoverPortalSession,
  requestPortalAccess,
} from "@/lib/portal.functions";
import { AccessRequestBanner } from "@/components/portal/AccessRequestBanner";
import { formatDuration, useLivePortalStatus } from "@/hooks/useLivePortalStatus";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  Clock,
  LogIn,
  LogOut,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

interface Props {
  currentExecutive: PortalExecutive;
  adminPassword?: string;
}

export function StartEndSessionCard({ currentExecutive, adminPassword }: Props) {
  const qc = useQueryClient();
  const {
    isPortalActive,
    activeSession,
    currentScheduled,
    elapsedSeconds,
    remainingSeconds,
    isNearExpiry,
    isAnkitaBatchWindow,
  } = useLivePortalStatus();

  const [reason, setReason] = useState<SessionReason>("Collection follow-up");
  const [customReason, setCustomReason] = useState("");
  const [logoutNote, setLogoutNote] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);

  const startSessionFn = useServerFn(startPortalSession);
  const endSessionFn = useServerFn(endPortalSession);
  const recoverSessionFn = useServerFn(recoverPortalSession);
  const requestAccessFn = useServerFn(requestPortalAccess);

  const isCurrentUserActive = isPortalActive && activeSession?.executive === currentExecutive;
  const isSomeoneElseActive = isPortalActive && activeSession?.executive !== currentExecutive;

  const isMyScheduledSlot = currentScheduled?.executive === currentExecutive;
  const isAnotherExecutiveSlot =
    Boolean(currentScheduled) &&
    currentScheduled?.executive !== currentExecutive &&
    currentExecutive !== "Aman";

  const handleSendAccessRequest = async () => {
    if (!currentScheduled) return;
    setIsRequesting(true);
    try {
      await requestAccessFn({
        data: {
          requestor: currentExecutive,
          reason,
          customReason: reason === "Other" ? customReason : undefined,
        },
      });

      toast.success(`Access request sent to ${currentScheduled.executive}! Waiting for approval.`);
      await qc.invalidateQueries({ queryKey: ["portalLiveStatus"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send access request.");
    } finally {
      setIsRequesting(false);
    }
  };

  const handleStartSession = async () => {
    if (isAnotherExecutiveSlot) {
      await handleSendAccessRequest();
      return;
    }

    setIsStarting(true);
    try {
      await startSessionFn({
        data: {
          executive: currentExecutive,
          reason,
          customReason: reason === "Other" ? customReason : undefined,
        },
      });

      toast.success(
        `Portal Session Started for ${currentExecutive} (${
          isMyScheduledSlot ? "Scheduled Slot" : "Temporary Access 7m 15s"
        })`,
      );
      await qc.invalidateQueries({ queryKey: ["portalLiveStatus"] });
      await qc.invalidateQueries({ queryKey: ["portalReports"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start session.");
    } finally {
      setIsStarting(false);
    }
  };

  const handleEndSession = async () => {
    setIsEnding(true);
    try {
      await endSessionFn({
        data: {
          executive: currentExecutive,
          sessionId: activeSession?.id,
          note: logoutNote.trim() || undefined,
        },
      });

      toast.success(`Session ended successfully. Duration: ${formatDuration(elapsedSeconds)}`);
      setLogoutNote("");
      await qc.invalidateQueries({ queryKey: ["portalLiveStatus"] });
      await qc.invalidateQueries({ queryKey: ["portalReports"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to end session.");
    } finally {
      setIsEnding(false);
    }
  };

  const handleRecoverSession = async () => {
    if (!adminPassword && currentExecutive !== "Aman") {
      toast.error("Only administrator Aman can force recover an abandoned session.");
      return;
    }
    if (
      !window.confirm(
        `Are you sure you want to recover/terminate the abandoned session of ${activeSession?.executive}?`,
      )
    ) {
      return;
    }

    setIsRecovering(true);
    try {
      await recoverSessionFn({
        data: {
          adminPassword: adminPassword || "Mahadev@Babaji@0003",
          adminActor: currentExecutive,
        },
      });
      toast.success("Abandoned session recovered. Portal is now free.");
      await qc.invalidateQueries({ queryKey: ["portalLiveStatus"] });
      await qc.invalidateQueries({ queryKey: ["portalReports"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to recover session.");
    } finally {
      setIsRecovering(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div>
          <h3 className="font-bold text-lg">Portal Session & Access Control</h3>
          <p className="text-xs text-muted-foreground">
            Current Operator: <span className="font-semibold text-primary">{currentExecutive}</span>
            {currentExecutive === "Aman" && " (Administrator)"}
          </p>
        </div>

        {/* Current status chip */}
        <div>
          {isCurrentUserActive ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              You are currently using the portal
            </span>
          ) : isSomeoneElseActive ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              <AlertTriangle className="h-3 w-3" />
              In use by {activeSession?.executive}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              Portal is Free
            </span>
          )}
        </div>
      </div>

      {/* Access Request Banner for Incoming & Outgoing Requests */}
      <AccessRequestBanner currentExecutive={currentExecutive} />

      {/* Case 1: Current User is using the portal -> Show Live Timer & End Session */}
      {isCurrentUserActive && (
        <div className="mt-4 space-y-4">
          <div
            className={`rounded-xl border p-4 text-center ${
              isNearExpiry
                ? "border-red-400 bg-red-50/80 dark:bg-red-950/30"
                : "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20"
            }`}
          >
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Live Active Session Duration
            </p>
            <p className="mt-1 font-mono text-4xl font-extrabold tracking-tight">
              {formatDuration(elapsedSeconds)}
            </p>

            {remainingSeconds !== null && (
              <div className="mt-2">
                <span
                  className={`text-sm font-semibold ${
                    isNearExpiry ? "text-red-600 font-bold animate-pulse" : "text-amber-700"
                  }`}
                >
                  Temporary Access: {formatDuration(remainingSeconds)} remaining
                </span>
                {isNearExpiry && (
                  <p className="mt-1 text-xs text-red-600 font-medium">
                    ⚠️ Your 7 minutes and 15 seconds temporary window is about to expire! Please
                    complete your work and log out.
                  </p>
                )}
              </div>
            )}

            <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
              <span className="rounded bg-background px-2 py-1 border">
                Type: {activeSession?.sessionType}
              </span>
              <span className="rounded bg-background px-2 py-1 border">
                Reason: {activeSession?.reason}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="logout-note" className="text-xs text-muted-foreground">
              Optional Logout Remarks / Completed Work Note:
            </Label>
            <Input
              id="logout-note"
              placeholder="e.g. Completed verification for 3 loan accounts."
              value={logoutNote}
              onChange={(e) => setLogoutNote(e.target.value)}
              className="h-10"
            />
          </div>

          <Button
            onClick={handleEndSession}
            disabled={isEnding}
            variant="destructive"
            className="w-full h-12 text-base font-semibold gap-2"
          >
            <LogOut className="h-5 w-5" />
            {isEnding ? "Ending Session..." : "End Session / Logout"}
          </Button>
        </div>
      )}

      {/* Case 2: Someone else is using the portal */}
      {isSomeoneElseActive && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-semibold text-sm text-amber-900 dark:text-amber-200">
                Portal In Use by {activeSession?.executive}
              </h4>
              <p className="text-xs text-amber-800/90 dark:text-amber-300">
                Session Type: <strong>{activeSession?.sessionType}</strong> · Elapsed:{" "}
                <strong>{formatDuration(elapsedSeconds)}</strong>
                {remainingSeconds !== null && ` · Remaining: ${formatDuration(remainingSeconds)}`}
              </p>
              <p className="text-xs text-muted-foreground">Reason: {activeSession?.reason}</p>
            </div>
          </div>

          {/* Recovery option if expired or if Aman */}
          {(currentExecutive === "Aman" || isNearExpiry || elapsedSeconds > 450) && (
            <div className="mt-3 border-t border-amber-200 pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRecoverSession}
                disabled={isRecovering}
                className="text-xs border-amber-400 text-amber-900 hover:bg-amber-100"
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                {isRecovering ? "Recovering..." : "Recover Abandoned Session"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Case 3: Portal is free -> Show Start Session Form */}
      {!isPortalActive && (
        <div className="mt-4 space-y-4">
          <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-foreground">
              <Clock className="h-3.5 w-3.5 text-primary" />
              <span>
                {isMyScheduledSlot ? (
                  <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                    ✓ You are currently within your scheduled slot (
                    {currentScheduled?.formattedSlot})!
                  </span>
                ) : isAnotherExecutiveSlot ? (
                  <span className="text-amber-700 dark:text-amber-400 font-bold">
                    ⚠️ Scheduled Slot: {currentScheduled?.executive} (
                    {currentScheduled?.formattedSlot})
                  </span>
                ) : (
                  <span>
                    Temporary Access Window: <strong>7 minutes and 15 seconds</strong>
                  </span>
                )}
              </span>
            </div>
            {isAnotherExecutiveSlot ? (
              <p className="text-amber-800 dark:text-amber-200 font-medium">
                यह समय <strong>{currentScheduled?.executive}</strong> का है। बैंक पोर्टल उपयोग करने
                के लिए नीचे से <strong>{currentScheduled?.executive}</strong> को रिक्वेस्ट भेजें।
                उनके अप्रूव करने पर आपका सेशन शुरू होगा।
              </p>
            ) : !isMyScheduledSlot ? (
              <p className="text-muted-foreground">
                You are starting outside your scheduled slot. The 7m 15s timer starts when you tap
                Start Session and is enforced server-side.
              </p>
            ) : null}
            {isAnkitaBatchWindow && (
              <p className="text-purple-700 font-medium">
                🟣 6:30 PM–7:30 PM IST is reserved for Ankita's Batch Handling.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="session-reason" className="text-sm font-semibold">
              Select Session Reason <span className="text-destructive">*</span>
            </Label>
            <Select value={reason} onValueChange={(v) => setReason(v as SessionReason)}>
              <SelectTrigger id="session-reason" className="h-11">
                <SelectValue placeholder="Select purpose" />
              </SelectTrigger>
              <SelectContent>
                {SESSION_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {reason === "Other" && (
            <div className="space-y-1">
              <Label htmlFor="custom-reason" className="text-xs">
                Specify Reason
              </Label>
              <Input
                id="custom-reason"
                placeholder="Enter specific purpose"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                className="h-10"
              />
            </div>
          )}

          {isAnotherExecutiveSlot ? (
            <Button
              onClick={handleSendAccessRequest}
              disabled={isRequesting}
              className="w-full h-12 text-base font-semibold gap-2 bg-amber-600 hover:bg-amber-700 text-white"
            >
              <Send className="h-5 w-5" />
              {isRequesting
                ? "Sending Request..."
                : `${currentScheduled?.executive} से एक्सेस रिक्वेस्ट करें (Request Access)`}
            </Button>
          ) : (
            <Button
              onClick={handleStartSession}
              disabled={isStarting}
              className="w-full h-12 text-base font-semibold gap-2"
            >
              <LogIn className="h-5 w-5" />
              {isStarting ? "Starting Session..." : `Start Session as ${currentExecutive}`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
