import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { type PortalBan, type PortalAuditLog, type PortalExecutive } from "@/lib/portal-types";
import { getPortalReports, revokeBanAction, recoverPortalSession } from "@/lib/portal.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Ban, CheckCircle2, RefreshCw, ShieldAlert, ShieldCheck, Undo2 } from "lucide-react";

interface Props {
  currentExecutive: PortalExecutive;
  adminPassword?: string;
}

export function AdminSettingsView({ currentExecutive, adminPassword }: Props) {
  const qc = useQueryClient();
  const fetchReports = useServerFn(getPortalReports);
  const revokeBanFn = useServerFn(revokeBanAction);
  const recoverSessionFn = useServerFn(recoverPortalSession);

  const { data, refetch, isFetching } = useQuery({
    queryKey: ["portalReports"],
    queryFn: async () => {
      const res = await fetchReports();
      return res;
    },
    staleTime: 10_000,
  });

  const bans: PortalBan[] = data?.bans ?? [];
  const auditLogs: PortalAuditLog[] = data?.auditLogs ?? [];

  const activeBans = bans.filter((b) => b.isActive);

  // Revoke Dialog State
  const [revokingBan, setRevokingBan] = useState<PortalBan | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [isRevoking, setIsRevoking] = useState(false);

  const [isRecovering, setIsRecovering] = useState(false);

  const handleRevokeConfirm = async () => {
    if (!revokingBan) return;
    if (!revokeReason.trim()) {
      toast.error("Please enter the reason for revoking the ban.");
      return;
    }

    setIsRevoking(true);
    try {
      await revokeBanFn({
        data: {
          adminPassword: adminPassword || "Mahadev@Babaji@0003",
          banId: revokingBan.id,
          revokeReason: revokeReason.trim(),
          adminActor: currentExecutive,
        },
      });

      toast.success(`Ban revoked for ${revokingBan.executive}. Access restored.`);
      setRevokingBan(null);
      setRevokeReason("");
      await qc.invalidateQueries({ queryKey: ["portalReports"] });
      await qc.invalidateQueries({ queryKey: ["portalLiveStatus"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke ban.");
    } finally {
      setIsRevoking(false);
    }
  };

  const handleForceEmergencyRecovery = async () => {
    if (
      !window.confirm(
        "Perform emergency portal session recovery? Any active session will be closed immediately.",
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
      toast.success("Emergency recovery executed. Portal state reset.");
      await qc.invalidateQueries({ queryKey: ["portalLiveStatus"] });
      await qc.invalidateQueries({ queryKey: ["portalReports"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to recover portal session.");
    } finally {
      setIsRecovering(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-purple-600" />
            Administrator Controls & Disciplinary Management
          </h3>
          <p className="text-xs text-muted-foreground">
            Strict administrator tools for Aman to manage temporary 24-hour bans, session overrides,
            and review live audit records.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={() => refetch()} className="h-9 gap-1 text-xs">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* Active Bans Section */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-base flex items-center gap-2">
            <Ban className="h-4 w-4 text-destructive" />
            Active 24-Hour Temporary Bans ({activeBans.length})
          </h4>
        </div>

        {activeBans.length === 0 ? (
          <div className="rounded-lg border bg-muted/20 p-6 text-center text-muted-foreground text-xs">
            <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-600 mb-1" />
            No active temporary bans. All executives are eligible to use the portal in accordance
            with their schedules.
          </div>
        ) : (
          <div className="space-y-3">
            {activeBans.map((ban) => {
              const remainingMs = Math.max(0, ban.expiresAtEpochMs - Date.now());
              const remainingHrs = (remainingMs / 3600000).toFixed(1);

              return (
                <div
                  key={ban.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50/70 p-4 dark:border-red-900 dark:bg-red-950/20"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-red-900 dark:text-red-200">
                        {ban.executive}
                      </span>
                      <Badge variant="destructive" className="text-[10px]">
                        24-Hour Ban Active
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground">({ban.id})</span>
                    </div>
                    <p className="text-xs text-red-800 dark:text-red-300">
                      Reason: <strong>{ban.reason}</strong>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Started: {new Date(ban.startedAt).toLocaleString("en-IN")} · Expires:{" "}
                      {new Date(ban.expiresAt).toLocaleString("en-IN")} (~{remainingHrs}h left)
                    </p>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRevokingBan(ban);
                      setRevokeReason("");
                    }}
                    className="border-red-400 text-red-800 hover:bg-red-100 text-xs h-8 gap-1"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    Revoke Ban Early
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Emergency Session Recovery */}
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <h4 className="font-bold text-base flex items-center gap-2 text-amber-800 dark:text-amber-300">
          <ShieldAlert className="h-4 w-4" />
          Emergency Session Recovery
        </h4>
        <p className="text-xs text-muted-foreground">
          If an executive started a session and left their browser open, or if network connectivity
          was interrupted, the administrator can forcibly recover the portal session to restore
          availability.
        </p>
        <Button
          onClick={handleForceEmergencyRecovery}
          disabled={isRecovering}
          variant="outline"
          size="sm"
          className="border-amber-400 text-amber-900 hover:bg-amber-100 text-xs h-9"
        >
          {isRecovering ? "Resetting..." : "Execute Emergency Session Recovery"}
        </Button>
      </div>

      {/* Audit Log */}
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <h4 className="font-bold text-base">Administrative Action Audit Log</h4>
        <p className="text-xs text-muted-foreground">
          Permanent log of all session starts, logouts, formal warnings, 24-hour bans, and schedule
          revisions.
        </p>

        <div className="max-h-72 overflow-y-auto rounded-lg border divide-y divide-border text-xs bg-muted/10 font-mono">
          {auditLogs.length === 0 ? (
            <p className="p-4 text-center text-muted-foreground">No audit entries recorded yet.</p>
          ) : (
            auditLogs.map((log) => (
              <div
                key={log.id}
                className="p-2.5 flex flex-wrap items-baseline justify-between gap-2 hover:bg-muted/30"
              >
                <div>
                  <span className="font-bold text-purple-700 dark:text-purple-300 mr-2">
                    [{log.action}]
                  </span>
                  <span className="text-muted-foreground mr-1">by {log.actor}:</span>
                  <span>{log.details}</span>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: true,
                  })}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Revoke Ban Modal */}
      <Dialog open={Boolean(revokingBan)} onOpenChange={(open) => !open && setRevokingBan(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 className="h-5 w-5 text-emerald-600" />
              Revoke Temporary 24-Hour Ban
            </DialogTitle>
            <DialogDescription>
              Restore {revokingBan?.executive}'s portal scheduling eligibility before the 24-hour
              period expires. An audit log will be created.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-2 text-xs">
            <p>
              Executive: <strong>{revokingBan?.executive}</strong> (Ban ID: {revokingBan?.id})
            </p>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Reason for Early Revocation *</Label>
              <Input
                placeholder="e.g. Executive acknowledged violation in work group and agreed to compliance."
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                className="h-10"
                required
              />
            </div>
          </div>

          <DialogFooter className="mt-4 gap-2">
            <Button variant="outline" onClick={() => setRevokingBan(null)}>
              Cancel
            </Button>
            <Button onClick={handleRevokeConfirm} disabled={isRevoking}>
              {isRevoking ? "Revoking..." : "Confirm Revocation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
