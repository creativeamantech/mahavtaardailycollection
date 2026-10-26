import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  PORTAL_EXECUTIVES,
  type PortalComplaint,
  type PortalExecutive,
  STANDARD_WARNING_TEXT,
} from "@/lib/portal-types";
import {
  getPortalReports,
  submitPortalQuery,
  escalateQuery,
  verifyComplaintAction,
  issueWarningAction,
  imposeBanAction,
  uploadPortalEvidence,
} from "@/lib/portal.functions";
import { useLivePortalStatus } from "@/hooks/useLivePortalStatus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  AlertCircle,
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileQuestion,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  Send,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from "lucide-react";

interface Props {
  currentExecutive: PortalExecutive;
  adminPassword?: string;
}

export function ComplaintsAndQueriesSection({ currentExecutive, adminPassword }: Props) {
  const qc = useQueryClient();
  const { isAnkitaBatchWindow } = useLivePortalStatus();

  const fetchReports = useServerFn(getPortalReports);
  const submitQueryFn = useServerFn(submitPortalQuery);
  const escalateFn = useServerFn(escalateQuery);
  const verifyComplaintFn = useServerFn(verifyComplaintAction);
  const issueWarningFn = useServerFn(issueWarningAction);
  const imposeBanFn = useServerFn(imposeBanAction);
  const uploadEvidenceFn = useServerFn(uploadPortalEvidence);

  const { data, refetch } = useQuery({
    queryKey: ["portalReports"],
    queryFn: async () => {
      const res = await fetchReports();
      return res;
    },
    staleTime: 10_000,
  });

  const complaints: PortalComplaint[] = data?.complaints ?? [];

  // Form State
  const [concernedExecutive, setConcernedExecutive] = useState<PortalExecutive>("Aarti");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [loanRef, setLoanRef] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Escalate Dialog State
  const [escalatingComplaint, setEscalatingComplaint] = useState<PortalComplaint | null>(null);
  const [escalateNote, setEscalateNote] = useState("");
  const [escalateFile, setEscalateFile] = useState<File | null>(null);
  const [isEscalating, setIsEscalating] = useState(false);

  // Admin Verification Dialog State
  const [verifyingComplaint, setVerifyingComplaint] = useState<PortalComplaint | null>(null);
  const [verificationDecision, setVerificationDecision] = useState<
    "Verified — Valid" | "Dismissed — Invalid" | "Insufficient Evidence"
  >("Verified — Valid");
  const [adminRemarks, setAdminRemarks] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  // Admin Warning / Ban Action State
  const [warningComplaint, setWarningComplaint] = useState<PortalComplaint | null>(null);
  const [warningReason, setWarningReason] = useState("");
  const [isIssuingWarning, setIsIssuingWarning] = useState(false);

  const [banComplaint, setBanComplaint] = useState<PortalComplaint | null>(null);
  const [banReason, setBanReason] = useState("");
  const [isImposingBan, setIsImposingBan] = useState(false);

  const fileToBase64 = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const res = reader.result as string;
        resolve(res.includes(",") ? res.split(",")[1]! : res);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleQuerySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !description.trim()) {
      toast.error("Please provide both subject and description.");
      return;
    }

    setIsSubmitting(true);
    try {
      let evidenceUrl: string | undefined;

      if (selectedFile) {
        if (!selectedFile.type.startsWith("image/")) {
          toast.error("Only image screenshots (PNG/JPEG/WEBP) are allowed.");
          setIsSubmitting(false);
          return;
        }
        if (selectedFile.size > 8 * 1024 * 1024) {
          toast.error("Screenshot file size must be less than 8 MB.");
          setIsSubmitting(false);
          return;
        }
        const base64 = await fileToBase64(selectedFile);
        const up = await uploadEvidenceFn({
          data: {
            name: `evidence-${Date.now()}-${selectedFile.name}`,
            mimeType: selectedFile.type,
            base64,
          },
        });
        evidenceUrl = up?.link;
      }

      await submitQueryFn({
        data: {
          complainant: currentExecutive,
          concernedExecutive,
          subject: subject.trim(),
          description: description.trim(),
          loanRef: loanRef.trim() || undefined,
          evidenceUrl,
        },
      });

      toast.success(
        isAnkitaBatchWindow
          ? "Query recorded immediately and queued (Batch Window active). Normal escalation resumes after 7:30 PM."
          : "Query submitted successfully. Eligible for formal escalation after 10 minutes if unresolved.",
      );

      setSubject("");
      setDescription("");
      setLoanRef("");
      setSelectedFile(null);
      await qc.invalidateQueries({ queryKey: ["portalReports"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit query.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEscalateConfirm = async () => {
    if (!escalatingComplaint) return;
    setIsEscalating(true);
    try {
      let evidenceUrl = escalatingComplaint.evidenceUrl;
      if (escalateFile) {
        const base64 = await fileToBase64(escalateFile);
        const up = await uploadEvidenceFn({
          data: {
            name: `evidence-${Date.now()}-${escalateFile.name}`,
            mimeType: escalateFile.type,
            base64,
          },
        });
        evidenceUrl = up?.link;
      }

      await escalateFn({
        data: {
          complaintId: escalatingComplaint.id,
          complainant: currentExecutive,
          escalationNote: escalateNote.trim() || undefined,
          evidenceUrl,
        },
      });

      toast.success("Query escalated into a formal complaint with screenshot evidence!");
      setEscalatingComplaint(null);
      setEscalateNote("");
      setEscalateFile(null);
      await qc.invalidateQueries({ queryKey: ["portalReports"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to escalate query.");
    } finally {
      setIsEscalating(false);
    }
  };

  const handleVerifyConfirm = async () => {
    if (!verifyingComplaint) return;
    if (!adminRemarks.trim()) {
      toast.error("Administrator remarks are required.");
      return;
    }

    setIsVerifying(true);
    try {
      await verifyComplaintFn({
        data: {
          adminPassword: adminPassword || "Mahadev@Babaji@0003",
          complaintId: verifyingComplaint.id,
          decision: verificationDecision,
          adminRemarks: adminRemarks.trim(),
          adminActor: currentExecutive,
        },
      });

      toast.success(`Complaint verified as: ${verificationDecision}`);
      setVerifyingComplaint(null);
      setAdminRemarks("");
      await qc.invalidateQueries({ queryKey: ["portalReports"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to verify complaint.");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleIssueWarningConfirm = async () => {
    if (!warningComplaint) return;
    if (!warningReason.trim()) {
      toast.error("Please provide the specific reason for this formal warning.");
      return;
    }

    setIsIssuingWarning(true);
    try {
      await issueWarningFn({
        data: {
          adminPassword: adminPassword || "Mahadev@Babaji@0003",
          complaintId: warningComplaint.id,
          executive: warningComplaint.concernedExecutive,
          reason: warningReason.trim(),
          adminActor: currentExecutive,
        },
      });

      toast.success(`Formal warning issued to ${warningComplaint.concernedExecutive}`);
      setWarningComplaint(null);
      setWarningReason("");
      await qc.invalidateQueries({ queryKey: ["portalReports"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to issue warning.");
    } finally {
      setIsIssuingWarning(false);
    }
  };

  const handleImposeBanConfirm = async () => {
    if (!banComplaint) return;
    if (!banReason.trim()) {
      toast.error("Please specify the violation reason for the 24-hour ban.");
      return;
    }

    setIsImposingBan(true);
    try {
      await imposeBanFn({
        data: {
          adminPassword: adminPassword || "Mahadev@Babaji@0003",
          complaintId: banComplaint.id,
          executive: banComplaint.concernedExecutive,
          reason: banReason.trim(),
          adminActor: currentExecutive,
        },
      });

      toast.success(`24-hour temporary ban imposed on ${banComplaint.concernedExecutive}`);
      setBanComplaint(null);
      setBanReason("");
      await qc.invalidateQueries({ queryKey: ["portalReports"] });
      await qc.invalidateQueries({ queryKey: ["portalLiveStatus"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to impose ban.");
    } finally {
      setIsImposingBan(false);
    }
  };

  return (
    <div className="space-y-6 pt-2">
      <div>
        <h3 className="text-xl font-bold tracking-tight">Complaints & Queries</h3>
        <p className="text-xs text-muted-foreground">
          Record queries immediately. If a query remains unresolved for 10 minutes outside Batch
          Handling, it can be escalated into a formal complaint with screenshot evidence.
        </p>
      </div>

      {/* Batch Window Notification Banner */}
      {isAnkitaBatchWindow && (
        <div className="rounded-xl border border-purple-300 bg-purple-50 p-4 text-purple-900 dark:border-purple-900 dark:bg-purple-950/40 dark:text-purple-200">
          <div className="flex items-center gap-2 font-bold text-sm">
            <span className="h-2.5 w-2.5 rounded-full bg-purple-600 animate-ping" />
            Ankita's Batch Handling Window (6:30 PM–7:30 PM IST) Active
          </div>
          <p className="mt-1 text-xs text-purple-800 dark:text-purple-300">
            Queries recorded during this window are queued safely without disruptive alerts or
            forced handovers. Normal query handling and escalation will resume automatically after
            7:30 PM.
          </p>
        </div>
      )}

      {/* Query Submission Card */}
      <form
        onSubmit={handleQuerySubmit}
        className="rounded-xl border bg-card p-5 shadow-sm space-y-4"
      >
        <h4 className="font-bold text-base flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          Record New Query or Issue
        </h4>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="concerned-exec" className="text-xs font-semibold">
              Concerned Executive <span className="text-destructive">*</span>
            </Label>
            <Select
              value={concernedExecutive}
              onValueChange={(v) => setConcernedExecutive(v as PortalExecutive)}
            >
              <SelectTrigger id="concerned-exec" className="h-10">
                <SelectValue placeholder="Select concerned executive" />
              </SelectTrigger>
              <SelectContent>
                {PORTAL_EXECUTIVES.filter((e) => e !== currentExecutive).map((e, idx) => (
                  <SelectItem key={`cq-exec-${e}-${idx}`} value={e}>
                    {e} {e === "Aman" && "(Admin)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="loan-ref" className="text-xs">
              Loan ID / Reference Number (Optional)
            </Label>
            <Input
              id="loan-ref"
              placeholder="e.g. 181007835"
              value={loanRef}
              onChange={(e) => setLoanRef(e.target.value)}
              className="h-10"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="subject" className="text-xs font-semibold">
            Subject <span className="text-destructive">*</span>
          </Label>
          <Input
            id="subject"
            placeholder="e.g. Portal slot overrun / delay in handing over portal"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="h-10"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="desc" className="text-xs font-semibold">
            Description / Context <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="desc"
            placeholder="Describe what occurred, time observed, and executive response..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="text-xs sm:text-sm"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="screenshot" className="text-xs font-semibold flex items-center gap-1.5">
            <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
            Attach Evidence Screenshot (Optional, max 8 MB)
          </Label>
          <Input
            id="screenshot"
            type="file"
            accept="image/*"
            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            className="h-10 text-xs cursor-pointer"
          />
          {selectedFile && (
            <p className="text-[11px] text-muted-foreground">
              Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(0)} KB)
            </p>
          )}
        </div>

        <Button type="submit" disabled={isSubmitting} className="w-full h-11 font-semibold gap-2">
          <Send className="h-4 w-4" />
          {isSubmitting ? "Submitting..." : "Submit Query / Accountability Entry"}
        </Button>
      </form>

      {/* Complaints and Queries History Table */}
      <div className="space-y-3">
        <h4 className="font-bold text-base flex items-center justify-between">
          <span>Recent Queries & Formal Complaints ({complaints.length})</span>
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-8 text-xs">
            Refresh
          </Button>
        </h4>

        {complaints.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground text-sm">
            <CheckCircle2 className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
            No complaints or queries logged yet.
          </div>
        ) : (
          <div className="space-y-3">
            {complaints.map((item) => {
              const elapsedMins = Math.floor(
                (Date.now() - (item.createdAtEpochMs || new Date(item.createdAt).getTime())) /
                  60000,
              );
              const canEscalate =
                !item.escalatedFromQuery &&
                elapsedMins >= 10 &&
                !isAnkitaBatchWindow &&
                item.status === "Pending Verification";

              const isVerifiedValid = item.status === "Verified — Valid";
              const isWarning = item.status === "Warning Issued";
              const isBan = item.status === "Temporary Ban Active";
              const isDismissed =
                item.status === "Dismissed — Invalid" || item.status === "Insufficient Evidence";

              return (
                <div
                  key={item.id}
                  className={`rounded-xl border p-4 transition-all ${
                    isBan
                      ? "border-red-400 bg-red-50/50 dark:bg-red-950/20"
                      : isWarning
                        ? "border-amber-400 bg-amber-50/50 dark:bg-amber-950/20"
                        : isVerifiedValid
                          ? "border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20"
                          : isDismissed
                            ? "border-slate-300 bg-slate-50/50 dark:bg-slate-900/30"
                            : "border-border bg-card"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-2.5">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-muted-foreground">
                          {item.id}
                        </span>
                        <span className="font-semibold text-sm">{item.subject}</span>
                        {item.isQueuedForBatch && (
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-purple-100 text-purple-800"
                          >
                            Batch Queued
                          </Badge>
                        )}
                        {item.escalatedFromQuery && (
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-amber-100 text-amber-800"
                          >
                            Escalated Formal Complaint
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Reported by <strong>{item.complainant}</strong> regarding{" "}
                        <strong className="text-primary">{item.concernedExecutive}</strong> ·{" "}
                        {new Date(item.createdAt).toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: true,
                        })}{" "}
                        ({elapsedMins} min ago)
                        {item.loanRef && ` · Loan Ref: ${item.loanRef}`}
                      </p>
                    </div>

                    {/* Status Badge */}
                    <div>
                      <Badge
                        className={`text-xs ${
                          isBan
                            ? "bg-red-600 text-white"
                            : isWarning
                              ? "bg-amber-600 text-white"
                              : isVerifiedValid
                                ? "bg-emerald-600 text-white"
                                : isDismissed
                                  ? "bg-slate-500 text-white"
                                  : "bg-blue-600 text-white"
                        }`}
                      >
                        {item.status}
                      </Badge>
                    </div>
                  </div>

                  <p className="mt-2 text-xs sm:text-sm whitespace-pre-wrap">{item.description}</p>

                  {/* Evidence Screenshot Link */}
                  {item.evidenceUrl && (
                    <div className="mt-2.5">
                      <a
                        href={item.evidenceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline hover:text-primary/80"
                      >
                        <ImageIcon className="h-3 w-3" />
                        View Attached Screenshot Evidence ↗
                      </a>
                    </div>
                  )}

                  {/* Administrator Remarks & Decision */}
                  {item.adminRemarks && (
                    <div className="mt-3 rounded-lg border bg-background/80 p-2.5 text-xs">
                      <div className="flex items-center gap-1.5 font-bold text-purple-800 dark:text-purple-300">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Administrator Remarks ({item.resolver || "Aman"}):
                      </div>
                      <p className="mt-1 text-muted-foreground italic">"{item.adminRemarks}"</p>
                    </div>
                  )}

                  {/* Actions Bar */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
                    {/* Escalation button for complainant or any executive */}
                    <div>
                      {canEscalate ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEscalatingComplaint(item)}
                          className="text-xs h-8 border-amber-400 text-amber-900 bg-amber-50 hover:bg-amber-100"
                        >
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          Escalate to Formal Complaint (10m+ unresolved)
                        </Button>
                      ) : !item.escalatedFromQuery && item.status === "Pending Verification" ? (
                        <span className="text-[11px] text-muted-foreground">
                          ⏳ Escalation available after 10m ({Math.max(0, 10 - elapsedMins)}m
                          remaining)
                        </span>
                      ) : null}
                    </div>

                    {/* Admin Action Buttons (Aman only) */}
                    {currentExecutive === "Aman" && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setVerifyingComplaint(item);
                            setAdminRemarks(item.adminRemarks || "");
                          }}
                          className="text-xs h-8"
                        >
                          <ShieldCheck className="mr-1 h-3 w-3 text-purple-600" />
                          Verify Decision
                        </Button>

                        {item.status === "Verified — Valid" && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setWarningComplaint(item);
                                setWarningReason(
                                  `Violation verified under complaint ${item.id} regarding schedule non-compliance.`,
                                );
                              }}
                              className="text-xs h-8 border-amber-500 text-amber-900 hover:bg-amber-50"
                            >
                              <AlertCircle className="mr-1 h-3 w-3 text-amber-600" />
                              Issue Warning
                            </Button>

                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setBanComplaint(item);
                                setBanReason(
                                  `Verified violation of portal usage rules (Complaint ID: ${item.id}).`,
                                );
                              }}
                              className="text-xs h-8 border-red-500 text-red-900 hover:bg-red-50"
                            >
                              <Ban className="mr-1 h-3 w-3 text-red-600" />
                              Impose 24-Hour Ban
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Escalate Dialog */}
      <Dialog
        open={Boolean(escalatingComplaint)}
        onOpenChange={(open) => !open && setEscalatingComplaint(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
              Escalate to Formal Complaint
            </DialogTitle>
            <DialogDescription>
              This query has been unresolved for over 10 minutes. Escalate to Administrator Aman for
              formal review and evidence verification.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-2 text-xs">
            <p>
              Complaint ID: <strong>{escalatingComplaint?.id}</strong> regarding{" "}
              <strong>{escalatingComplaint?.concernedExecutive}</strong>
            </p>

            <div className="space-y-1">
              <Label className="text-xs">Additional Escalation Details</Label>
              <Textarea
                placeholder="Explain why issue was not resolved in 10 minutes..."
                value={escalateNote}
                onChange={(e) => setEscalateNote(e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Attach Evidence Screenshot</Label>
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => setEscalateFile(e.target.files?.[0] || null)}
                className="h-9 cursor-pointer"
              />
            </div>
          </div>

          <DialogFooter className="mt-4 gap-2">
            <Button variant="outline" onClick={() => setEscalatingComplaint(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleEscalateConfirm}
              disabled={isEscalating}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {isEscalating ? "Escalating..." : "Confirm Formal Escalation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin Verification Dialog */}
      <Dialog
        open={Boolean(verifyingComplaint)}
        onOpenChange={(open) => !open && setVerifyingComplaint(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-purple-600" />
              Administrator Verification & Remarks
            </DialogTitle>
            <DialogDescription>
              Review evidence carefully. Only verified valid complaints count toward accountability
              and disciplinary actions.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2 text-xs">
            <div className="rounded-lg border p-3 bg-muted/40 space-y-1">
              <p>
                <strong>Complaint ID:</strong> {verifyingComplaint?.id}
              </p>
              <p>
                <strong>Complainant:</strong> {verifyingComplaint?.complainant}
              </p>
              <p>
                <strong>Concerned Executive:</strong> {verifyingComplaint?.concernedExecutive}
              </p>
              <p>
                <strong>Subject:</strong> {verifyingComplaint?.subject}
              </p>
              {verifyingComplaint?.evidenceUrl && (
                <p>
                  <a
                    href={verifyingComplaint.evidenceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline font-bold"
                  >
                    View Screenshot Evidence ↗
                  </a>
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Verification Decision</Label>
              <Select
                value={verificationDecision}
                onValueChange={(v) =>
                  setVerificationDecision(
                    v as "Verified — Valid" | "Dismissed — Invalid" | "Insufficient Evidence",
                  )
                }
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Verified — Valid">
                    Verified — Valid (Confirmed Violation)
                  </SelectItem>
                  <SelectItem value="Dismissed — Invalid">Dismissed — Invalid</SelectItem>
                  <SelectItem value="Insufficient Evidence">Insufficient Evidence</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Administrator Remarks *</Label>
              <Textarea
                placeholder="State reason for decision, findings from evidence review..."
                value={adminRemarks}
                onChange={(e) => setAdminRemarks(e.target.value)}
                rows={3}
                required
              />
            </div>
          </div>

          <DialogFooter className="mt-4 gap-2">
            <Button variant="outline" onClick={() => setVerifyingComplaint(null)}>
              Cancel
            </Button>
            <Button onClick={handleVerifyConfirm} disabled={isVerifying}>
              {isVerifying ? "Saving..." : "Save Verification Decision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin Issue Warning Dialog */}
      <Dialog
        open={Boolean(warningComplaint)}
        onOpenChange={(open) => !open && setWarningComplaint(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertCircle className="h-5 w-5" />
              Issue Formal Disciplinary Warning
            </DialogTitle>
            <DialogDescription>
              This formal warning will be logged to {warningComplaint?.concernedExecutive}'s record
              and permanently linked to complaint {warningComplaint?.id}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Violation Reason *</Label>
              <Input
                placeholder="e.g. Repeated failure to vacate bank portal on scheduled slot time."
                value={warningReason}
                onChange={(e) => setWarningReason(e.target.value)}
                className="h-10"
              />
            </div>

            <div className="rounded-lg border bg-amber-50/80 p-3 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 space-y-1">
              <p className="font-bold">Standard Mandatory Warning Text to be Issued:</p>
              <p className="italic">"{STANDARD_WARNING_TEXT}"</p>
            </div>
          </div>

          <DialogFooter className="mt-4 gap-2">
            <Button variant="outline" onClick={() => setWarningComplaint(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleIssueWarningConfirm}
              disabled={isIssuingWarning}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {isIssuingWarning ? "Issuing..." : "Confirm & Issue Formal Warning"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin 24-Hour Ban Dialog */}
      <Dialog open={Boolean(banComplaint)} onOpenChange={(open) => !open && setBanComplaint(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Ban className="h-5 w-5" />
              Impose Temporary 24-Hour Portal Ban
            </DialogTitle>
            <DialogDescription>
              Block {banComplaint?.concernedExecutive} from starting portal sessions through this
              scheduling application for exactly 24 hours. Eligibility restores automatically after
              24 hours.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2 text-xs">
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              <p className="font-bold">Notice & Confirmation:</p>
              <p className="mt-1">
                - Executive: <strong>{banComplaint?.concernedExecutive}</strong>
              </p>
              <p>
                - Duration: <strong>Exactly 24 Hours</strong> from imposition
              </p>
              <p>- Active session (if any) will be terminated immediately.</p>
              <p>- Previous records and warnings remain permanently preserved.</p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Recorded Ban Reason *</Label>
              <Textarea
                placeholder="Explain the verified repeated violation leading to this 24-hour ban..."
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                rows={2}
                required
              />
            </div>
          </div>

          <DialogFooter className="mt-4 gap-2">
            <Button variant="outline" onClick={() => setBanComplaint(null)}>
              Cancel
            </Button>
            <Button onClick={handleImposeBanConfirm} disabled={isImposingBan} variant="destructive">
              {isImposingBan ? "Imposing..." : "Confirm 24-Hour Ban"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
