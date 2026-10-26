import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { type PortalBan, type PortalAuditLog, type PortalExecutive } from "@/lib/portal-types";
import {
  getPortalReports,
  revokeBanAction,
  recoverPortalSession,
  getBankPortalSheetConfig,
  updateBankPortalSheetConfig,
  createDedicatedBankPortalSheet,
} from "@/lib/portal.functions";
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
import {
  Ban,
  CheckCircle2,
  Database,
  ExternalLink,
  FileSpreadsheet,
  PlusCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Undo2,
} from "lucide-react";

interface Props {
  currentExecutive: PortalExecutive;
  adminPassword?: string;
}

export function AdminSettingsView({ currentExecutive, adminPassword }: Props) {
  const qc = useQueryClient();
  const fetchReports = useServerFn(getPortalReports);
  const revokeBanFn = useServerFn(revokeBanAction);
  const recoverSessionFn = useServerFn(recoverPortalSession);
  const fetchSheetConfig = useServerFn(getBankPortalSheetConfig);
  const updateSheetConfigFn = useServerFn(updateBankPortalSheetConfig);
  const createSheetFn = useServerFn(createDedicatedBankPortalSheet);

  const { data, refetch, isFetching } = useQuery({
    queryKey: ["portalReports"],
    queryFn: async () => {
      const res = await fetchReports();
      return res;
    },
    staleTime: 10_000,
  });

  const { data: sheetConfig, refetch: refetchSheetConfig } = useQuery({
    queryKey: ["portalSheetConfig"],
    queryFn: async () => {
      return await fetchSheetConfig();
    },
    staleTime: 10_000,
  });

  const [spreadsheetInput, setSpreadsheetInput] = useState("");
  const [isSavingSheet, setIsSavingSheet] = useState(false);
  const [isCreatingSheet, setIsCreatingSheet] = useState(false);

  const handleSaveSpreadsheet = async () => {
    if (!spreadsheetInput.trim()) {
      toast.error("Please enter a Google Spreadsheet ID or URL.");
      return;
    }
    setIsSavingSheet(true);
    try {
      const res = await updateSheetConfigFn({
        data: {
          adminPassword: adminPassword || "Mahadev@Babaji@0003",
          spreadsheetInput: spreadsheetInput.trim(),
          adminActor: currentExecutive,
        },
      });
      toast.success(res.message);
      setSpreadsheetInput("");
      await refetchSheetConfig();
      await qc.invalidateQueries({ queryKey: ["portalReports"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update spreadsheet ID.");
    } finally {
      setIsSavingSheet(false);
    }
  };

  const handleCreateDedicatedSheet = async () => {
    if (
      !window.confirm(
        "Create/Initialize a dedicated Google Spreadsheet for Bank Portal? All portal tabs will be automatically configured.",
      )
    ) {
      return;
    }
    setIsCreatingSheet(true);
    try {
      const res = await createSheetFn({
        data: {
          adminPassword: adminPassword || "Mahadev@Babaji@0003",
          title: "Mahavtaar Bank Portal Usage & Accountability",
          adminActor: currentExecutive,
        },
      });
      toast.success(res.message);
      await refetchSheetConfig();
      await qc.invalidateQueries({ queryKey: ["portalReports"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create dedicated spreadsheet.");
    } finally {
      setIsCreatingSheet(false);
    }
  };

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

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetch();
              refetchSheetConfig();
            }}
            className="h-9 gap-1 text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Dedicated Bank Portal Google Spreadsheet Card */}
      <div className="rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50/80 via-white to-indigo-50/50 p-5 dark:border-purple-900/50 dark:from-purple-950/20 dark:via-background dark:to-indigo-950/10 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h4 className="font-bold text-base flex items-center gap-2 text-purple-950 dark:text-purple-200">
              <FileSpreadsheet className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              बैंक पोर्टल समर्पित Google स्प्रेडशीट (Dedicated Bank Portal Sheet)
            </h4>
            <p className="text-xs text-muted-foreground">
              बैंक पोर्टल का पूरा डेटा (सत्र, शेड्यूल, शिकायतें, चेतावनियां, प्रतिबंध, ऑडिट लॉग) इस
              अलग गूगल स्प्रेडशीट में सुरक्षित है।
            </p>
          </div>

          <Badge
            variant="outline"
            className="border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300 text-xs px-2.5 py-1 gap-1.5 font-medium"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            डेली कलेक्शन से 100% अलग (Isolated)
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg border bg-white/90 dark:bg-card/90 p-3 space-y-2">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="font-medium">बैंक पोर्टल स्प्रेडशीट ID:</span>
              <span className="font-mono text-[11px] text-purple-700 dark:text-purple-300 font-semibold truncate max-w-[200px]">
                {sheetConfig?.spreadsheetId || "Connecting..."}
              </span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="font-medium">डेली कलेक्शन फ़ाइल (अछूता):</span>
              <span className="font-mono text-[11px] text-emerald-700 dark:text-emerald-400">
                1AXLakW3...5uiL3dWsY5g (Safe & Untouched)
              </span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground pt-1.5 border-t">
              <span>पोर्टल टैब्स (Tabs):</span>
              <span className="text-[11px] font-medium text-foreground">
                Sessions, Schedules, Complaints, Warnings, Bans, Audit
              </span>
            </div>
          </div>

          <div className="rounded-lg border bg-white/90 dark:bg-card/90 p-3 flex flex-col justify-between gap-2.5">
            <div>
              <p className="text-muted-foreground text-[11px]">
                आप बैंक पोर्टल के लिए अपनी अलग गूगल स्प्रेडशीट का URL या ID जोड़ सकते हैं, या नई
                समर्पित शीट बना सकते हैं।
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {sheetConfig?.spreadsheetUrl && (
                <a
                  href={sheetConfig.spreadsheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-purple-600 text-white hover:bg-purple-700 text-xs font-medium transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Google Sheets में खोलें
                </a>
              )}

              <Button
                size="sm"
                variant="outline"
                onClick={handleCreateDedicatedSheet}
                disabled={isCreatingSheet}
                className="h-8 text-xs gap-1 border-purple-300 text-purple-900 hover:bg-purple-100 dark:text-purple-200"
              >
                <PlusCircle className="h-3.5 w-3.5" />
                {isCreatingSheet ? "Creating..." : "नई समर्पित शीट बनाएं"}
              </Button>
            </div>
          </div>
        </div>

        {/* Change or paste custom sheet */}
        <div className="pt-2 border-t border-purple-100 dark:border-purple-900/30 flex flex-col sm:flex-row gap-2 items-start sm:items-center">
          <div className="flex-1 w-full">
            <Input
              placeholder="नया Google Spreadsheet ID या पूरा URL पेस्ट करें (e.g. https://docs.google.com/spreadsheets/d/...)"
              value={spreadsheetInput}
              onChange={(e) => setSpreadsheetInput(e.target.value)}
              className="h-9 text-xs bg-white dark:bg-background"
            />
          </div>
          <Button
            size="sm"
            onClick={handleSaveSpreadsheet}
            disabled={isSavingSheet || !spreadsheetInput.trim()}
            className="h-9 text-xs px-4 bg-purple-700 hover:bg-purple-800 text-white shrink-0"
          >
            {isSavingSheet ? "सहेज रहे हैं..." : "स्प्रेडशीट लिंक अपडेट करें"}
          </Button>
        </div>
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
