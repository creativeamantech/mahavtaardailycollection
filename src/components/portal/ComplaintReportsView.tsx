import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPortalReports } from "@/lib/portal.functions";
import { toCsv, downloadCsv } from "@/lib/export";
import {
  PORTAL_EXECUTIVES,
  type PortalComplaint,
  type PortalWarning,
  type PortalBan,
} from "@/lib/portal-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  Ban,
  Download,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

export function ComplaintReportsView() {
  const fetchReports = useServerFn(getPortalReports);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["portalReports"],
    queryFn: async () => {
      const res = await fetchReports();
      return res;
    },
    staleTime: 15_000,
  });

  const complaints: PortalComplaint[] = useMemo(() => data?.complaints ?? [], [data?.complaints]);
  const warnings: PortalWarning[] = useMemo(() => data?.warnings ?? [], [data?.warnings]);
  const bans: PortalBan[] = useMemo(() => data?.bans ?? [], [data?.bans]);

  // Filter states
  const [filterExecutive, setFilterExecutive] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");

  const filteredComplaints = useMemo(() => {
    return complaints.filter((c) => {
      if (filterExecutive !== "ALL" && c.concernedExecutive !== filterExecutive) return false;
      if (filterStatus !== "ALL" && c.status !== filterStatus) return false;
      return true;
    });
  }, [complaints, filterExecutive, filterStatus]);

  // Aggregate metrics
  const totalComplaints = complaints.length;
  const verifiedViolationsCount = complaints.filter((c) => c.status === "Verified — Valid").length;
  const warningsCount = warnings.length;
  const activeBansCount = bans.filter((b) => b.isActive).length;
  const pendingCount = complaints.filter((c) => c.status === "Pending Verification").length;

  // Average resolution time in minutes
  const resolvedWithTimestamps = complaints.filter((c) => c.resolvedAt && c.createdAt);
  const avgResolutionMinutes =
    resolvedWithTimestamps.length > 0
      ? Math.round(
          resolvedWithTimestamps.reduce((acc, c) => {
            const start = new Date(c.createdAt).getTime();
            const end = new Date(c.resolvedAt!).getTime();
            return acc + Math.max(0, (end - start) / 60000);
          }, 0) / resolvedWithTimestamps.length,
        )
      : 0;

  // CSV Export
  const exportComplaintsCsv = () => {
    const headers = [
      "Complaint ID",
      "Complainant",
      "Concerned Executive",
      "Subject",
      "Description",
      "Loan Ref",
      "Evidence URL",
      "Status",
      "Created At",
      "Escalated",
      "Resolved At",
      "Admin Resolver",
      "Admin Remarks",
    ];

    const rows = filteredComplaints.map((c) => [
      c.id,
      c.complainant,
      c.concernedExecutive,
      c.subject,
      c.description,
      c.loanRef ?? "",
      c.evidenceUrl ?? "",
      c.status,
      c.createdAt,
      c.escalatedFromQuery ? "YES" : "NO",
      c.resolvedAt ?? "",
      c.resolver ?? "",
      c.adminRemarks ?? "",
    ]);

    // toCsv neutralises formula-leading values and quotes safely.
    downloadCsv(
      `portal_complaints_report_${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(headers, rows),
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold">Complaint & Disciplinary Accountability Report</h3>
          <p className="text-xs text-muted-foreground">
            Complete permanent records of complaints, evidence, administrator verification
            decisions, formal warnings, and 24-hour bans.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="h-9 gap-1 text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Button
            onClick={exportComplaintsCsv}
            disabled={filteredComplaints.length === 0}
            size="sm"
            className="h-9 gap-1.5 text-xs font-semibold"
          >
            <Download className="h-3.5 w-3.5" /> Export Complaints CSV ({filteredComplaints.length})
          </Button>
        </div>
      </div>

      {/* Aggregate Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border bg-card p-3.5 text-center">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase">Total Entries</p>
          <p className="mt-1 text-2xl font-bold">{totalComplaints}</p>
        </div>

        <div className="rounded-xl border bg-card p-3.5 text-center">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase">
            Pending Review
          </p>
          <p className={`mt-1 text-2xl font-bold ${pendingCount > 0 ? "text-blue-600" : ""}`}>
            {pendingCount}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-3.5 text-center">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase">
            Verified Violations
          </p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">{verifiedViolationsCount}</p>
        </div>

        <div className="rounded-xl border bg-card p-3.5 text-center">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase">
            Warnings Issued
          </p>
          <p className="mt-1 text-2xl font-bold text-amber-600">{warningsCount}</p>
        </div>

        <div className="rounded-xl border bg-card p-3.5 text-center">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase">Active Bans</p>
          <p className={`mt-1 text-2xl font-bold ${activeBansCount > 0 ? "text-destructive" : ""}`}>
            {activeBansCount}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-3.5 text-center">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase">
            Avg Resolution
          </p>
          <p className="mt-1 font-mono text-xl font-bold">
            {avgResolutionMinutes > 0 ? `${avgResolutionMinutes} min` : "—"}
          </p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="rounded-xl border bg-muted/30 p-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs">Concerned Executive</Label>
          <Select value={filterExecutive} onValueChange={setFilterExecutive}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Executives</SelectItem>
              {PORTAL_EXECUTIVES.map((e, idx) => (
                <SelectItem key={`creport-exec-${e}-${idx}`} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs">Complaint Status</Label>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              <SelectItem value="Pending Verification">Pending Verification</SelectItem>
              <SelectItem value="Verified — Valid">Verified — Valid</SelectItem>
              <SelectItem value="Warning Issued">Warning Issued</SelectItem>
              <SelectItem value="Temporary Ban Active">Temporary Ban Active</SelectItem>
              <SelectItem value="Dismissed — Invalid">Dismissed — Invalid</SelectItem>
              <SelectItem value="Insufficient Evidence">Insufficient Evidence</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Complaints List Table */}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-left text-xs sm:text-sm">
          <thead className="border-b bg-muted/60 text-muted-foreground font-semibold">
            <tr>
              <th className="p-3">ID</th>
              <th className="p-3">Concerned Executive</th>
              <th className="p-3">Complainant</th>
              <th className="p-3">Subject & Remarks</th>
              <th className="p-3">Evidence</th>
              <th className="p-3 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredComplaints.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  No complaint records matching the selected filters.
                </td>
              </tr>
            ) : (
              filteredComplaints.map((c) => {
                const isVerified = c.status === "Verified — Valid";
                const isBan = c.status === "Temporary Ban Active";
                const isWarning = c.status === "Warning Issued";

                return (
                  <tr key={c.id} className="hover:bg-muted/30">
                    <td className="p-3 font-mono font-bold text-xs text-muted-foreground">
                      {c.id}
                    </td>
                    <td className="p-3 font-semibold text-primary">{c.concernedExecutive}</td>
                    <td className="p-3 text-xs">{c.complainant}</td>
                    <td className="p-3 max-w-xs">
                      <p className="font-semibold text-xs">{c.subject}</p>
                      <p className="text-[11px] text-muted-foreground line-clamp-2">
                        {c.description}
                      </p>
                      {c.adminRemarks && (
                        <p className="mt-1 text-[11px] text-purple-800 italic dark:text-purple-300">
                          Admin Remarks: "{c.adminRemarks}"
                        </p>
                      )}
                    </td>
                    <td className="p-3">
                      {c.evidenceUrl ? (
                        <a
                          href={c.evidenceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-primary underline text-xs"
                        >
                          View Screenshot <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <Badge
                        className={`text-[10px] ${
                          isBan
                            ? "bg-red-600 text-white"
                            : isWarning
                              ? "bg-amber-600 text-white"
                              : isVerified
                                ? "bg-emerald-600 text-white"
                                : "bg-slate-500 text-white"
                        }`}
                      >
                        {c.status}
                      </Badge>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
