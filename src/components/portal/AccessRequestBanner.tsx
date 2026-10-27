import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PortalExecutive, PortalAccessRequest } from "@/lib/portal-types";
import { respondToPortalAccessRequest, cancelPortalAccessRequest } from "@/lib/portal.functions";
import { useLivePortalStatus } from "@/hooks/useLivePortalStatus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, X, Clock, ShieldAlert, CheckCircle2, XCircle } from "lucide-react";

interface Props {
  currentExecutive: PortalExecutive;
}

export function AccessRequestBanner({ currentExecutive }: Props) {
  const qc = useQueryClient();
  const { status } = useLivePortalStatus();
  const requests = status?.accessRequests ?? [];

  const [responseNote, setResponseNote] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const respondFn = useServerFn(respondToPortalAccessRequest);
  const cancelFn = useServerFn(cancelPortalAccessRequest);

  // 1. Incoming Requests directed to this executive (or Admin Aman)
  const incomingRequests = requests.filter(
    (r) =>
      r.status === "PENDING" &&
      (r.scheduledExecutive === currentExecutive || currentExecutive === "Aman") &&
      r.requestor !== currentExecutive,
  );

  // 2. Outgoing Requests created by this executive
  const myPendingRequest = requests.find(
    (r) => r.requestor === currentExecutive && r.status === "PENDING",
  );

  // 3. Recently resolved request for this executive
  const myRecentResolution = requests.find(
    (r) =>
      r.requestor === currentExecutive &&
      (r.status === "APPROVED" || r.status === "REJECTED") &&
      Date.now() - r.requestedAtEpochMs < 3 * 60 * 1000,
  );

  const handleRespond = async (req: PortalAccessRequest, action: "APPROVE" | "REJECT") => {
    setIsProcessing(true);
    try {
      await respondFn({
        data: {
          requestId: req.id,
          responder: currentExecutive,
          action,
          responseNote: responseNote.trim() || undefined,
        },
      });

      if (action === "APPROVE") {
        toast.success(`Access Granted to ${req.requestor}! Session started.`);
      } else {
        toast.info(`Request from ${req.requestor} rejected.`);
      }

      setResponseNote("");
      await qc.invalidateQueries({ queryKey: ["portalLiveStatus"] });
      await qc.invalidateQueries({ queryKey: ["portalReports"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to respond to request.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = async (requestId: string) => {
    try {
      await cancelFn({
        data: {
          requestId,
          requestor: currentExecutive,
        },
      });
      toast.info("Access request cancelled.");
      await qc.invalidateQueries({ queryKey: ["portalLiveStatus"] });
    } catch {
      toast.error("Failed to cancel request.");
    }
  };

  return (
    <div className="space-y-3 my-3">
      {/* Incoming Requests Banner (Scheduled Duty Executive sees this) */}
      {incomingRequests.map((req) => (
        <div
          key={req.id}
          className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/40 p-4 shadow-md animate-pulse-subtle"
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-amber-200 dark:bg-amber-900 p-2 text-amber-800 dark:text-amber-200 shrink-0">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base text-amber-900 dark:text-amber-100">
                    📩 एक्सेस अनुरोध: {req.requestor}
                  </span>
                  <span className="rounded-full bg-amber-200 dark:bg-amber-800 px-2.5 py-0.5 text-xs font-semibold text-amber-900 dark:text-amber-100">
                    PENDING APPROVAL
                  </span>
                </div>
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  <strong>{req.requestor}</strong> आपके टाइम स्लॉट के दौरान बैंक पोर्टल एक्सेस करना
                  चाहते हैं।
                </p>
                <div className="text-xs text-amber-700 dark:text-amber-300 font-mono space-y-0.5">
                  <p>
                    उद्देश्य / Reason:{" "}
                    <strong className="font-sans">
                      {req.reason}
                      {req.customReason ? ` (${req.customReason})` : ""}
                    </strong>
                  </p>
                  <p>
                    समय / Requested:{" "}
                    {new Date(req.requestedAtEpochMs).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            </div>

            {/* Approval Controls */}
            <div className="w-full sm:w-auto space-y-2 shrink-0">
              <Input
                placeholder="Optional remark (e.g., 5 min only)"
                value={responseNote}
                onChange={(e) => setResponseNote(e.target.value)}
                className="h-8 text-xs bg-white dark:bg-slate-900"
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => handleRespond(req, "APPROVE")}
                  disabled={isProcessing}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-9 px-4 gap-1.5 flex-1"
                >
                  <Check className="h-4 w-4" />
                  अनुमति दें (Approve)
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleRespond(req, "REJECT")}
                  disabled={isProcessing}
                  className="text-xs h-9 px-3 gap-1"
                >
                  <X className="h-4 w-4" />
                  मना करें (Reject)
                </Button>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Outgoing Pending Request Banner (Requesting user sees this while waiting) */}
      {myPendingRequest && (
        <div className="rounded-xl border border-blue-300 bg-blue-50 dark:bg-blue-950/30 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-blue-200 dark:bg-blue-900 p-2 text-blue-700 dark:text-blue-300">
                <Clock className="h-5 w-5 animate-spin" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-blue-900 dark:text-blue-100">
                  ⏳ {myPendingRequest.scheduledExecutive} को अनुरोध भेजा गया है (Waiting for
                  Confirmation)
                </h4>
                <p className="text-xs text-blue-800 dark:text-blue-200 mt-0.5">
                  यह समय <strong>{myPendingRequest.scheduledExecutive}</strong> का है। जब वे अनुरोध
                  स्वीकार करेंगे, आपका पोर्टल एक्सेस स्वतः चालू हो जाएगा।
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Reason: {myPendingRequest.reason}
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => handleCancel(myPendingRequest.id)}
              className="text-xs border-blue-300 text-blue-900 hover:bg-blue-100"
            >
              अनुरोध रद्द करें (Cancel)
            </Button>
          </div>
        </div>
      )}

      {/* Recent Resolution Notification for Requestor */}
      {!myPendingRequest && myRecentResolution && (
        <div
          className={`rounded-xl border p-3.5 text-xs flex items-center justify-between gap-2 ${
            myRecentResolution.status === "APPROVED"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
              : "border-red-300 bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {myRecentResolution.status === "APPROVED" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-red-600 shrink-0" />
            )}
            <div>
              <p className="font-bold">
                {myRecentResolution.status === "APPROVED"
                  ? `✓ ${myRecentResolution.scheduledExecutive} ने आपका अनुरोध स्वीकार कर लिया!`
                  : `✕ ${myRecentResolution.scheduledExecutive} ने आपका अनुरोध अस्वीकार कर दिया।`}
              </p>
              {myRecentResolution.responseNote && (
                <p className="mt-0.5 opacity-90">Note: {myRecentResolution.responseNote}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
