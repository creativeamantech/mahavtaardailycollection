import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPortalReports } from "@/lib/portal.functions";
import { toCsv, downloadCsv } from "@/lib/export";
import {
  PORTAL_EXECUTIVES,
  type PortalExecutive,
  type PortalSession,
  type SessionType,
} from "@/lib/portal-types";
import { formatDuration } from "@/hooks/useLivePortalStatus";
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
import { Download, Filter, RefreshCw } from "lucide-react";

export function UsageReportsView() {
  const fetchReports = useServerFn(getPortalReports);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["portalReports"],
    queryFn: async () => {
      const res = await fetchReports();
      return res;
    },
    staleTime: 15_000,
  });

  const sessions: PortalSession[] = useMemo(() => data?.sessions ?? [], [data?.sessions]);

  // Filters
  const [filterExecutive, setFilterExecutive] = useState<string>("ALL");
  const [filterType, setFilterType] = useState<string>("ALL");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (filterExecutive !== "ALL" && s.executive !== filterExecutive) return false;
      if (filterType !== "ALL" && s.sessionType !== filterType) return false;
      if (startDate && s.startedAt.slice(0, 10) < startDate) return false;
      if (endDate && s.startedAt.slice(0, 10) > endDate) return false;
      return true;
    });
  }, [sessions, filterExecutive, filterType, startDate, endDate]);

  // Aggregate stats
  const totalLogins = filtered.length;
  const totalDurationSeconds = filtered.reduce((acc, s) => acc + (s.durationSeconds || 0), 0);
  const avgDurationSeconds = totalLogins > 0 ? Math.round(totalDurationSeconds / totalLogins) : 0;

  const scheduledCount = filtered.filter((s) => s.sessionType === "SCHEDULED").length;
  const temporaryCount = filtered.filter((s) => s.sessionType === "TEMPORARY").length;
  const expiredCount = filtered.filter((s) => s.status === "EXPIRED" || s.isOverdue).length;

  const complianceRate =
    totalLogins > 0 ? Math.round(((totalLogins - expiredCount) / totalLogins) * 100) : 100;

  // CSV Export
  const exportCsv = () => {
    const headers = [
      "Session ID",
      "Executive",
      "Started At",
      "Ended At",
      "Duration (Minutes)",
      "Duration (Formatted)",
      "Reason",
      "Session Type",
      "Authorised Slot",
      "Status",
      "Overdue/Expired",
    ];

    const rows = filtered.map((s) => [
      s.id,
      s.executive,
      s.startedAt,
      s.endedAt ?? "",
      (s.durationSeconds / 60).toFixed(2),
      formatDuration(s.durationSeconds),
      s.reason + (s.customReason ? ` - ${s.customReason}` : ""),
      s.sessionType,
      s.authorisedSlot ?? "",
      s.status,
      s.isOverdue || s.status === "EXPIRED" ? "YES" : "NO",
    ]);

    // toCsv neutralises formula-leading values and quotes safely.
    downloadCsv(
      `portal_usage_report_${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(headers, rows),
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold">Portal Usage & Compliance Report</h3>
          <p className="text-xs text-muted-foreground">
            Track declared sessions, login frequency, duration, temporary access compliance, and
            expired sessions.
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
            onClick={exportCsv}
            disabled={filtered.length === 0}
            size="sm"
            className="h-9 gap-1.5 text-xs font-semibold"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV ({filtered.length})
          </Button>
        </div>
      </div>

      {/* Aggregate Statistics Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border bg-card p-3.5 text-center">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase">Total Logins</p>
          <p className="mt-1 text-2xl font-bold">{totalLogins}</p>
        </div>

        <div className="rounded-xl border bg-card p-3.5 text-center">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase">Total Usage</p>
          <p className="mt-1 font-mono text-xl font-bold">
            {(totalDurationSeconds / 3600).toFixed(1)} hrs
          </p>
        </div>

        <div className="rounded-xl border bg-card p-3.5 text-center">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase">Avg Duration</p>
          <p className="mt-1 font-mono text-xl font-bold">{formatDuration(avgDurationSeconds)}</p>
        </div>

        <div className="rounded-xl border bg-card p-3.5 text-center">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase">Compliance</p>
          <p
            className={`mt-1 text-2xl font-bold ${
              complianceRate >= 90
                ? "text-emerald-600"
                : complianceRate >= 75
                  ? "text-amber-600"
                  : "text-red-600"
            }`}
          >
            {complianceRate}%
          </p>
        </div>

        <div className="rounded-xl border bg-card p-3.5 text-center">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase">
            Scheduled / Temp
          </p>
          <p className="mt-1 text-lg font-bold">
            {scheduledCount}{" "}
            <span className="text-xs font-normal text-muted-foreground">/ {temporaryCount}</span>
          </p>
        </div>

        <div className="rounded-xl border bg-card p-3.5 text-center">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase">
            Expired Sessions
          </p>
          <p className={`mt-1 text-2xl font-bold ${expiredCount > 0 ? "text-destructive" : ""}`}>
            {expiredCount}
          </p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="rounded-xl border bg-muted/30 p-3.5 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <Label className="text-xs">Filter by Executive</Label>
          <Select value={filterExecutive} onValueChange={setFilterExecutive}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Executives</SelectItem>
              {PORTAL_EXECUTIVES.map((e, idx) => (
                <SelectItem key={`usage-exec-${e}-${idx}`} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs">Filter by Type</Label>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Session Types</SelectItem>
              <SelectItem value="SCHEDULED">Scheduled</SelectItem>
              <SelectItem value="TEMPORARY">Temporary</SelectItem>
              <SelectItem value="BATCH_HANDLING">Batch Handling</SelectItem>
              <SelectItem value="EMERGENCY_OVERRIDE">Emergency Override</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs">From Date</Label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-9 text-xs"
          />
        </div>

        <div>
          <Label className="text-xs">To Date</Label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-9 text-xs"
          />
        </div>
      </div>

      {/* Sessions History Table */}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-left text-xs sm:text-sm">
          <thead className="border-b bg-muted/60 text-muted-foreground font-semibold">
            <tr>
              <th className="p-3">Session ID</th>
              <th className="p-3">Executive</th>
              <th className="p-3">Date & Time</th>
              <th className="p-3">Duration</th>
              <th className="p-3">Type</th>
              <th className="p-3">Purpose / Reason</th>
              <th className="p-3 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  No session records matching the selected filters.
                </td>
              </tr>
            ) : (
              filtered.map((s) => {
                const isOver = s.isOverdue || s.status === "EXPIRED";

                return (
                  <tr key={s.id} className="hover:bg-muted/30">
                    <td className="p-3 font-mono font-bold text-xs text-muted-foreground">
                      {s.id}
                    </td>
                    <td className="p-3 font-semibold">{s.executive}</td>
                    <td className="p-3 text-xs">
                      {new Date(s.startedAt).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}{" "}
                      ·{" "}
                      {new Date(s.startedAt).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: true,
                      })}
                    </td>
                    <td className="p-3 font-mono font-bold">{formatDuration(s.durationSeconds)}</td>
                    <td className="p-3">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          s.sessionType === "SCHEDULED"
                            ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                            : s.sessionType === "BATCH_HANDLING"
                              ? "bg-purple-50 text-purple-800 border-purple-300"
                              : "bg-amber-50 text-amber-800 border-amber-300"
                        }`}
                      >
                        {s.sessionType}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {s.reason}
                      {s.customReason && ` (${s.customReason})`}
                    </td>
                    <td className="p-3 text-right">
                      <span
                        className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${
                          s.status === "ACTIVE"
                            ? "bg-blue-100 text-blue-800 animate-pulse"
                            : isOver
                              ? "bg-red-100 text-red-800 font-bold"
                              : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
                        }`}
                      >
                        {isOver ? "EXPIRED" : s.status}
                      </span>
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
