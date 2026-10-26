import {
  PORTAL_EXECUTIVES,
  type PortalExecutive,
  type ExecutiveSchedule,
  type PortalSession,
  type PortalComplaint,
  type PortalWarning,
  type PortalBan,
  type PortalAuditLog,
  type LivePortalStatus,
  type SessionReason,
  type SessionType,
  type SessionStatus,
  type ComplaintStatus,
  DEFAULT_SCHEDULES,
  TEMPORARY_ACCESS_SECONDS,
  ANKITA_BATCH_WINDOW,
  STANDARD_WARNING_TEXT,
} from "./portal-types";
import { APP_TIME_ZONE } from "./executives";
import {
  PORTAL_TABS,
  portalEnsureSheet,
  portalSheetsAppend,
  portalSheetsGet,
  portalSheetsUpdate,
  getBankPortalSpreadsheetConfig,
  setBankPortalSpreadsheetId,
  createDedicatedBankPortalSpreadsheet,
} from "./bank-portal-sheets.server";

const TAB_SESSIONS = PORTAL_TABS.SESSIONS;
const TAB_SCHEDULES = PORTAL_TABS.SCHEDULES;
const TAB_COMPLAINTS = PORTAL_TABS.COMPLAINTS;
const TAB_WARNINGS = PORTAL_TABS.WARNINGS;
const TAB_BANS = PORTAL_TABS.BANS;
const TAB_AUDIT = PORTAL_TABS.AUDIT;

// Server In-Memory State for fast live status, locking, and synchronization
let inMemoryActiveSession: PortalSession | null = null;
let inMemorySchedules: ExecutiveSchedule[] = [...DEFAULT_SCHEDULES];
let inMemoryComplaints: PortalComplaint[] = [];
const inMemoryWarnings: PortalWarning[] = [];
let inMemoryBans: PortalBan[] = [];
const inMemoryAudit: PortalAuditLog[] = [];
let isInitialized = false;

// Concurrency mutex lock to prevent concurrent session start races
let sessionLock = false;

export function getNowInIST(): {
  hours: number;
  minutes: number;
  timeStr: string;
  isoString: string;
  epochMs: number;
} {
  const now = new Date();
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = timeFormatter.formatToParts(now);
  const hours = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minutes = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const timeStr = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

  return {
    hours,
    minutes,
    timeStr,
    isoString: now.toISOString(),
    epochMs: now.getTime(),
  };
}

export function isTimeInWindow(current: string, start: string, end: string): boolean {
  return current >= start && current <= end;
}

export function isBatchWindowActive(timeStr: string): boolean {
  return isTimeInWindow(timeStr, ANKITA_BATCH_WINDOW.start, ANKITA_BATCH_WINDOW.end);
}

export async function initPortalStore() {
  if (isInitialized) return;

  // Initialize sheets if needed
  try {
    await portalEnsureSheet(TAB_SESSIONS, [
      "ID",
      "Executive",
      "StartedAt",
      "EndedAt",
      "DurationSeconds",
      "Reason",
      "CustomReason",
      "SessionType",
      "AuthorisedSlot",
      "Status",
      "IsOverdue",
    ]);

    await portalEnsureSheet(TAB_SCHEDULES, ["Executive", "SlotsJson", "IsAvailable", "Notes"]);

    await portalEnsureSheet(TAB_COMPLAINTS, [
      "ComplaintID",
      "Complainant",
      "ConcernedExecutive",
      "Subject",
      "Description",
      "LoanRef",
      "EvidenceUrl",
      "Status",
      "CreatedAt",
      "IsQueuedForBatch",
      "EscalatedFromQuery",
      "EscalatedAt",
      "ResolvedAt",
      "Resolver",
      "ResolutionNotes",
      "AdminDecision",
      "AdminRemarks",
      "VerifiedAt",
    ]);

    await portalEnsureSheet(TAB_WARNINGS, [
      "WarningID",
      "Executive",
      "ComplaintID",
      "Reason",
      "WarningText",
      "IssuedBy",
      "IssuedAt",
      "Acknowledged",
    ]);

    await portalEnsureSheet(TAB_BANS, [
      "BanID",
      "Executive",
      "ComplaintID",
      "Reason",
      "StartedAt",
      "ExpiresAt",
      "IssuedBy",
      "IsActive",
      "RevokedAt",
      "RevokedBy",
      "RevokeReason",
    ]);

    await portalEnsureSheet(TAB_AUDIT, ["AuditID", "Timestamp", "Action", "Actor", "Details"]);

    // Load existing bans into memory
    const banRows = await portalSheetsGet(`${TAB_BANS}!A2:K`).catch(() => []);
    if (Array.isArray(banRows) && banRows.length > 0) {
      inMemoryBans = banRows
        .filter((r) => r[0] && r[1])
        .map((r) => ({
          id: r[0]!,
          executive: r[1] as PortalExecutive,
          complaintId: r[2] ?? "",
          reason: r[3] ?? "",
          startedAt: r[4] ?? "",
          expiresAt: r[5] ?? "",
          expiresAtEpochMs: new Date(r[5] ?? "").getTime() || 0,
          issuedBy: r[6] ?? "Aman",
          isActive: r[7] === "TRUE" || r[7] === "true",
          revokedAt: r[8] || undefined,
          revokedBy: r[9] || undefined,
          revokeReason: r[10] || undefined,
        }));
    }

    // Load custom schedules if any
    const schedRows = await portalSheetsGet(`${TAB_SCHEDULES}!A2:D`).catch(() => []);
    if (Array.isArray(schedRows) && schedRows.length > 0) {
      const loaded: ExecutiveSchedule[] = [];
      for (const r of schedRows) {
        if (!r[0]) continue;
        const execName = r[0] as PortalExecutive;
        const defaultEntry = DEFAULT_SCHEDULES.find((d) => d.executive === execName);
        let slots = defaultEntry?.slots ?? [];
        try {
          const raw = (r[1] ?? "").trim();
          if (raw.startsWith("[") || raw.startsWith("{")) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
              slots = parsed;
            }
          }
        } catch {
          // ignore corrupted json, use default
        }
        loaded.push({
          executive: execName,
          slots: Array.isArray(slots) ? slots : (defaultEntry?.slots ?? []),
          isAvailable: r[2] !== "FALSE" && r[2] !== "false",
          notes: r[3] ?? "",
        });
      }
      if (loaded.length > 0) {
        inMemorySchedules = DEFAULT_SCHEDULES.map((def) => {
          const found = loaded.find((l) => l.executive === def.executive);
          if (!found || !Array.isArray(found.slots) || found.slots.length === 0) {
            return def;
          }
          return found;
        });
      }
    }

    // Load recent complaints
    const compRows = await portalSheetsGet(`${TAB_COMPLAINTS}!A2:R`).catch(() => []);
    if (Array.isArray(compRows) && compRows.length > 0) {
      inMemoryComplaints = compRows
        .filter((r) => r[0] && r[1])
        .map((r) => ({
          id: r[0]!,
          complainant: r[1] as PortalExecutive,
          concernedExecutive: r[2] as PortalExecutive,
          subject: r[3] ?? "",
          description: r[4] ?? "",
          loanRef: r[5] || undefined,
          evidenceUrl: r[6] || undefined,
          status: (r[7] ?? "Pending Verification") as ComplaintStatus,
          createdAt: r[8] ?? new Date().toISOString(),
          createdAtEpochMs: new Date(r[8] ?? "").getTime() || Date.now(),
          isQueuedForBatch: r[9] === "TRUE" || r[9] === "true",
          escalatedFromQuery: r[10] === "TRUE" || r[10] === "true",
          escalatedAt: r[11] || undefined,
          resolvedAt: r[12] || undefined,
          resolver: r[13] || undefined,
          resolutionNotes: r[14] || undefined,
          adminDecision: r[15] || undefined,
          adminRemarks: r[16] || undefined,
          verifiedAt: r[17] || undefined,
        }));
    }
  } catch (err) {
    console.warn("Portal sheets initialization notice:", err);
  }

  isInitialized = true;
}

export function cleanExpiredBans() {
  const now = Date.now();
  for (const ban of inMemoryBans) {
    if (ban.isActive && ban.expiresAtEpochMs > 0 && now >= ban.expiresAtEpochMs) {
      ban.isActive = false;
    }
  }
}

export function checkActiveBan(executive: PortalExecutive): PortalBan | null {
  cleanExpiredBans();
  return inMemoryBans.find((b) => b.executive === executive && b.isActive) ?? null;
}

export function getCurrentScheduledSlot(timeStr: string): {
  executive: PortalExecutive;
  start: string;
  end: string;
  formattedSlot: string;
  isBatchWindow?: boolean;
} | null {
  // Check Ankita Batch Window first (18:30 - 19:30)
  if (isBatchWindowActive(timeStr)) {
    return {
      executive: "Ankita",
      start: ANKITA_BATCH_WINDOW.start,
      end: ANKITA_BATCH_WINDOW.end,
      formattedSlot: ANKITA_BATCH_WINDOW.label,
      isBatchWindow: true,
    };
  }

  for (const s of inMemorySchedules) {
    if (!s.isAvailable) continue;
    const slots = Array.isArray(s.slots) ? s.slots : [];
    for (const slot of slots) {
      if (isTimeInWindow(timeStr, slot.start, slot.end)) {
        return {
          executive: s.executive,
          start: slot.start,
          end: slot.end,
          formattedSlot: slot.label,
        };
      }
    }
  }
  return null;
}

export function getNextScheduledSlot(timeStr: string): {
  executive: PortalExecutive;
  start: string;
  end: string;
  formattedSlot: string;
} | null {
  // Gather all future slots today
  const futureSlots: Array<{
    executive: PortalExecutive;
    start: string;
    end: string;
    formattedSlot: string;
  }> = [];

  for (const s of inMemorySchedules) {
    if (!s.isAvailable) continue;
    const slots = Array.isArray(s.slots) ? s.slots : [];
    for (const slot of slots) {
      if (slot.start > timeStr) {
        futureSlots.push({
          executive: s.executive,
          start: slot.start,
          end: slot.end,
          formattedSlot: slot.label,
        });
      }
    }
  }

  if (ANKITA_BATCH_WINDOW.start > timeStr) {
    futureSlots.push({
      executive: "Ankita",
      start: ANKITA_BATCH_WINDOW.start,
      end: ANKITA_BATCH_WINDOW.end,
      formattedSlot: ANKITA_BATCH_WINDOW.label,
    });
  }

  futureSlots.sort((a, b) => a.start.localeCompare(b.start));

  if (futureSlots.length > 0) {
    return futureSlots[0]!;
  }

  // If no future slot today, return the first slot tomorrow (e.g. Aarti 10:00 AM)
  return {
    executive: "Aarti",
    start: "10:00",
    end: "10:29",
    formattedSlot: "Tomorrow 10:00–10:29 AM",
  };
}

export function computeLivePortalStatus(): LivePortalStatus {
  const { timeStr, isoString, epochMs } = getNowInIST();
  cleanExpiredBans();

  // Check if active session is expired automatically
  if (inMemoryActiveSession) {
    const elapsed = Math.floor((epochMs - inMemoryActiveSession.startedAtEpochMs) / 1000);
    if (
      inMemoryActiveSession.sessionType === "TEMPORARY" &&
      elapsed > TEMPORARY_ACCESS_SECONDS + 30
    ) {
      // Auto-expire abandoned temporary sessions
      inMemoryActiveSession.isOverdue = true;
      inMemoryActiveSession.status = "EXPIRED";
    }
  }

  const isPortalActive = Boolean(
    inMemoryActiveSession && inMemoryActiveSession.status === "ACTIVE",
  );

  const currentScheduled = getCurrentScheduledSlot(timeStr);
  const nextScheduled = getNextScheduledSlot(timeStr);
  const isAnkitaBatchWindow = isBatchWindowActive(timeStr);

  return {
    isPortalActive,
    activeSession:
      inMemoryActiveSession && inMemoryActiveSession.status === "ACTIVE"
        ? {
            id: inMemoryActiveSession.id,
            executive: inMemoryActiveSession.executive,
            startedAt: inMemoryActiveSession.startedAt,
            startedAtEpochMs: inMemoryActiveSession.startedAtEpochMs,
            reason: inMemoryActiveSession.reason,
            sessionType: inMemoryActiveSession.sessionType,
            authorisedSlot: inMemoryActiveSession.authorisedSlot,
            maxAllowedSeconds:
              inMemoryActiveSession.sessionType === "TEMPORARY" ? TEMPORARY_ACCESS_SECONDS : null,
          }
        : null,
    currentScheduled,
    nextScheduled,
    serverTimeEpochMs: epochMs,
    serverTimeIso: isoString,
    isAnkitaBatchWindow,
  };
}

export async function startSessionOnServer(params: {
  executive: PortalExecutive;
  reason: SessionReason;
  customReason?: string | undefined;
  forceOverride?: boolean | undefined;
}): Promise<{ ok: boolean; session?: PortalSession; error?: string }> {
  await initPortalStore();

  // Concurrency guard
  if (sessionLock) {
    return { ok: false, error: "Another session operation is currently processing. Please retry." };
  }
  sessionLock = true;

  try {
    const { executive, reason, customReason, forceOverride } = params;
    const { timeStr, isoString, epochMs } = getNowInIST();

    // 1. Check if executive has an active temporary ban
    const activeBan = checkActiveBan(executive);
    if (activeBan) {
      const remainingMs = Math.max(0, activeBan.expiresAtEpochMs - epochMs);
      const remainingHours = (remainingMs / (1000 * 60 * 60)).toFixed(1);
      return {
        ok: false,
        error: `Access Denied: You have an active temporary 24-hour ban issued by Administrator (Reason: ${activeBan.reason}). Remaining: ~${remainingHours} hours. (Expiry: ${activeBan.expiresAt})`,
      };
    }

    // 2. Prevent simultaneous active session ownership
    if (inMemoryActiveSession && inMemoryActiveSession.status === "ACTIVE") {
      const elapsed = Math.floor((epochMs - inMemoryActiveSession.startedAtEpochMs) / 1000);

      // Check if current session expired (temporary > 435s)
      const isTemporaryExpired =
        inMemoryActiveSession.sessionType === "TEMPORARY" && elapsed >= TEMPORARY_ACCESS_SECONDS;

      if (isTemporaryExpired || forceOverride) {
        // Automatically close the expired previous session
        inMemoryActiveSession.status = isTemporaryExpired ? "EXPIRED" : "TERMINATED_RECOVERY";
        inMemoryActiveSession.endedAt = isoString;
        inMemoryActiveSession.endedAtEpochMs = epochMs;
        inMemoryActiveSession.durationSeconds = elapsed;
        await recordSessionToSheet(inMemoryActiveSession);
        inMemoryActiveSession = null;
      } else {
        return {
          ok: false,
          error: `Portal is currently in use by ${inMemoryActiveSession.executive} (${inMemoryActiveSession.sessionType} session, elapsed ${Math.floor(elapsed / 60)}m ${elapsed % 60}s). Simultaneous ownership is not permitted.`,
        };
      }
    }

    // 3. Determine session type and authorised slot
    const scheduled = getCurrentScheduledSlot(timeStr);
    let sessionType: SessionType = "TEMPORARY";
    let authorisedSlot = "Temporary Access (7m 15s)";

    if (scheduled && scheduled.executive === executive) {
      if (scheduled.isBatchWindow) {
        sessionType = "BATCH_HANDLING";
        authorisedSlot = ANKITA_BATCH_WINDOW.label;
      } else {
        sessionType = "SCHEDULED";
        authorisedSlot = scheduled.formattedSlot;
      }
    } else if (scheduled && scheduled.isBatchWindow && executive === "Ankita") {
      sessionType = "BATCH_HANDLING";
      authorisedSlot = ANKITA_BATCH_WINDOW.label;
    } else if (forceOverride) {
      sessionType = "EMERGENCY_OVERRIDE";
      authorisedSlot = "Admin Emergency Override";
    }

    const sessionId = `SES-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const newSession: PortalSession = {
      id: sessionId,
      executive,
      startedAt: isoString,
      startedAtEpochMs: epochMs,
      durationSeconds: 0,
      reason,
      customReason,
      sessionType,
      authorisedSlot,
      status: "ACTIVE",
    };

    inMemoryActiveSession = newSession;

    // Persist to Google Sheet
    await recordSessionToSheet(newSession);

    // Audit log
    await recordAuditLog({
      action: "SESSION_START",
      actor: executive,
      details: `Started ${sessionType} session for '${reason}' (Authorised Slot: ${authorisedSlot})`,
    });

    return { ok: true, session: newSession };
  } finally {
    sessionLock = false;
  }
}

export async function endSessionOnServer(params: {
  executive: PortalExecutive;
  sessionId?: string | undefined;
  note?: string | undefined;
}): Promise<{ ok: boolean; session?: PortalSession; error?: string }> {
  await initPortalStore();

  if (sessionLock) {
    return { ok: false, error: "Another session operation is currently processing. Please retry." };
  }
  sessionLock = true;

  try {
    const { executive, sessionId, note } = params;
    const { isoString, epochMs } = getNowInIST();

    if (!inMemoryActiveSession || inMemoryActiveSession.status !== "ACTIVE") {
      return { ok: false, error: "No active bank portal session found to end." };
    }

    // Validate that only the active user or administrator Aman can end the session
    if (inMemoryActiveSession.executive !== executive && executive !== "Aman") {
      return {
        ok: false,
        error: `Only ${inMemoryActiveSession.executive} or Administrator Aman can end this session.`,
      };
    }

    if (sessionId && inMemoryActiveSession.id !== sessionId) {
      return { ok: false, error: "Session ID does not match the active session." };
    }

    const elapsed = Math.floor((epochMs - inMemoryActiveSession.startedAtEpochMs) / 1000);
    const wasOverdue =
      inMemoryActiveSession.sessionType === "TEMPORARY" && elapsed > TEMPORARY_ACCESS_SECONDS;

    inMemoryActiveSession.endedAt = isoString;
    inMemoryActiveSession.endedAtEpochMs = epochMs;
    inMemoryActiveSession.durationSeconds = elapsed;
    inMemoryActiveSession.status = wasOverdue ? "EXPIRED" : "COMPLETED";
    inMemoryActiveSession.isOverdue = wasOverdue;

    const endedSession = { ...inMemoryActiveSession };
    inMemoryActiveSession = null;

    // Update sheet record
    await recordSessionToSheet(endedSession);

    // Audit log
    await recordAuditLog({
      action: "SESSION_LOGOUT",
      actor: executive,
      details: `Ended session ${endedSession.id} after ${Math.floor(elapsed / 60)}m ${elapsed % 60}s (${endedSession.status})${note ? ` - ${note}` : ""}`,
    });

    return { ok: true, session: endedSession };
  } finally {
    sessionLock = false;
  }
}

export async function recoverAbandonedSession(
  adminActor: string,
): Promise<{ ok: boolean; message: string }> {
  await initPortalStore();

  if (!inMemoryActiveSession || inMemoryActiveSession.status !== "ACTIVE") {
    return { ok: true, message: "No active session to recover." };
  }

  const { isoString, epochMs } = getNowInIST();
  const elapsed = Math.floor((epochMs - inMemoryActiveSession.startedAtEpochMs) / 1000);

  inMemoryActiveSession.endedAt = isoString;
  inMemoryActiveSession.endedAtEpochMs = epochMs;
  inMemoryActiveSession.durationSeconds = elapsed;
  inMemoryActiveSession.status = "TERMINATED_RECOVERY";
  inMemoryActiveSession.isOverdue = true;

  const recovered = { ...inMemoryActiveSession };
  inMemoryActiveSession = null;

  await recordSessionToSheet(recovered);
  await recordAuditLog({
    action: "SESSION_RECOVERY",
    actor: adminActor,
    details: `Recovered abandoned session from ${recovered.executive} after ${elapsed}s duration.`,
  });

  return {
    ok: true,
    message: `Recovered session from ${recovered.executive}. Portal is now free.`,
  };
}

async function recordSessionToSheet(session: PortalSession) {
  try {
    const row = [
      session.id,
      session.executive,
      session.startedAt,
      session.endedAt ?? "",
      session.durationSeconds,
      session.reason,
      session.customReason ?? "",
      session.sessionType,
      session.authorisedSlot ?? "",
      session.status,
      session.isOverdue ? "TRUE" : "FALSE",
    ];

    await portalSheetsAppend(`${TAB_SESSIONS}!A:K`, [row]);
  } catch (err) {
    console.warn("Failed to append session to Google Sheet:", err);
  }
}

export async function recordAuditLog(log: { action: string; actor: string; details: string }) {
  const auditEntry: PortalAuditLog = {
    id: `AUD-${Date.now().toString(36).toUpperCase()}`,
    timestamp: new Date().toISOString(),
    action: log.action,
    actor: log.actor,
    details: log.details,
  };
  inMemoryAudit.unshift(auditEntry);
  if (inMemoryAudit.length > 200) inMemoryAudit.pop();

  try {
    await portalSheetsAppend(`${TAB_AUDIT}!A:E`, [
      [
        auditEntry.id,
        auditEntry.timestamp,
        auditEntry.action,
        auditEntry.actor,
        auditEntry.details,
      ],
    ]);
  } catch (err) {
    console.warn("Failed to append audit log to Google Sheet:", err);
  }
}

export async function submitComplaintOrQuery(params: {
  complainant: PortalExecutive;
  concernedExecutive: PortalExecutive;
  subject: string;
  description: string;
  loanRef?: string | undefined;
  evidenceUrl?: string | undefined;
}): Promise<PortalComplaint> {
  await initPortalStore();
  const { timeStr, isoString, epochMs } = getNowInIST();

  const isBatch = isBatchWindowActive(timeStr);
  const complaintId = `CMP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

  const item: PortalComplaint = {
    id: complaintId,
    complainant: params.complainant,
    concernedExecutive: params.concernedExecutive,
    subject: params.subject.trim(),
    description: params.description.trim(),
    loanRef: params.loanRef?.trim() || undefined,
    evidenceUrl: params.evidenceUrl?.trim() || undefined,
    status: "Pending Verification",
    createdAt: isoString,
    createdAtEpochMs: epochMs,
    isQueuedForBatch: isBatch,
    escalatedFromQuery: false,
    canEscalateAtEpochMs: epochMs + 10 * 60 * 1000, // 10 minutes escalation rule
  };

  inMemoryComplaints.unshift(item);

  try {
    await portalSheetsAppend(`${TAB_COMPLAINTS}!A:R`, [
      [
        item.id,
        item.complainant,
        item.concernedExecutive,
        item.subject,
        item.description,
        item.loanRef ?? "",
        item.evidenceUrl ?? "",
        item.status,
        item.createdAt,
        item.isQueuedForBatch ? "TRUE" : "FALSE",
        "FALSE",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ],
    ]);
  } catch (err) {
    console.warn("Failed to append complaint to Google Sheet:", err);
  }

  await recordAuditLog({
    action: "QUERY_SUBMITTED",
    actor: params.complainant,
    details: `Submitted query/complaint regarding ${params.concernedExecutive}: "${params.subject}" (Batch Queued: ${isBatch})`,
  });

  return item;
}

export async function escalateQueryToComplaint(params: {
  complaintId: string;
  complainant: PortalExecutive;
  evidenceUrl?: string | undefined;
  escalationNote?: string | undefined;
}): Promise<{ ok: boolean; complaint?: PortalComplaint; error?: string }> {
  await initPortalStore();
  const { timeStr, isoString, epochMs } = getNowInIST();

  if (isBatchWindowActive(timeStr)) {
    return {
      ok: false,
      error:
        "Escalation is temporarily paused during Ankita's Batch Handling window (6:30 PM–7:30 PM IST). It will resume automatically after 7:30 PM.",
    };
  }

  const found = inMemoryComplaints.find((c) => c.id === params.complaintId);
  if (!found) {
    return { ok: false, error: "Query not found." };
  }

  // 10-minute check
  const elapsed = Math.floor((epochMs - found.createdAtEpochMs) / 1000);
  if (elapsed < 600) {
    const remainingSec = 600 - elapsed;
    return {
      ok: false,
      error: `Query must remain unresolved for at least 10 minutes before escalation. Remaining: ${Math.ceil(remainingSec / 60)} minutes.`,
    };
  }

  found.escalatedFromQuery = true;
  found.escalatedAt = isoString;
  if (params.evidenceUrl) found.evidenceUrl = params.evidenceUrl;
  if (params.escalationNote) {
    found.description += `\n[Escalated on ${isoString}]: ${params.escalationNote}`;
  }

  await recordAuditLog({
    action: "QUERY_ESCALATED",
    actor: params.complainant,
    details: `Escalated query ${found.id} to formal complaint against ${found.concernedExecutive}`,
  });

  return { ok: true, complaint: found };
}

export async function adminVerifyComplaint(params: {
  complaintId: string;
  decision: "Verified — Valid" | "Dismissed — Invalid" | "Insufficient Evidence";
  adminRemarks: string;
  adminActor: string;
}): Promise<{ ok: boolean; complaint?: PortalComplaint; error?: string }> {
  await initPortalStore();
  const { isoString } = getNowInIST();

  const found = inMemoryComplaints.find((c) => c.id === params.complaintId);
  if (!found) {
    return { ok: false, error: "Complaint record not found." };
  }

  found.status = params.decision;
  found.adminDecision = params.decision;
  found.adminRemarks = params.adminRemarks.trim();
  found.verifiedAt = isoString;
  found.resolvedAt = isoString;
  found.resolver = params.adminActor;

  await recordAuditLog({
    action: "COMPLAINT_VERIFICATION",
    actor: params.adminActor,
    details: `Set decision '${params.decision}' for complaint ${found.id} (Remarks: ${params.adminRemarks})`,
  });

  return { ok: true, complaint: found };
}

export async function adminIssueWarning(params: {
  complaintId: string;
  executive: PortalExecutive;
  reason: string;
  adminActor: string;
}): Promise<{ ok: boolean; warning?: PortalWarning; error?: string }> {
  await initPortalStore();
  const { isoString } = getNowInIST();

  const warningId = `WARN-${Date.now().toString(36).toUpperCase()}`;
  const warning: PortalWarning = {
    id: warningId,
    executive: params.executive,
    complaintId: params.complaintId,
    reason: params.reason,
    warningText: STANDARD_WARNING_TEXT,
    issuedBy: params.adminActor,
    issuedAt: isoString,
    acknowledged: false,
  };

  inMemoryWarnings.unshift(warning);

  const foundComp = inMemoryComplaints.find((c) => c.id === params.complaintId);
  if (foundComp) {
    foundComp.status = "Warning Issued";
  }

  try {
    await portalSheetsAppend(`${TAB_WARNINGS}!A:H`, [
      [
        warning.id,
        warning.executive,
        warning.complaintId,
        warning.reason,
        warning.warningText,
        warning.issuedBy,
        warning.issuedAt,
        "FALSE",
      ],
    ]);
  } catch (err) {
    console.warn("Failed to append warning to Google Sheet:", err);
  }

  await recordAuditLog({
    action: "WARNING_ISSUED",
    actor: params.adminActor,
    details: `Issued formal warning to ${params.executive} for complaint ${params.complaintId}: "${params.reason}"`,
  });

  return { ok: true, warning };
}

export async function adminImposeBan(params: {
  complaintId?: string | undefined;
  executive: PortalExecutive;
  reason: string;
  adminActor: string;
}): Promise<{ ok: boolean; ban?: PortalBan; error?: string }> {
  await initPortalStore();
  const { isoString, epochMs } = getNowInIST();

  // Exactly 24 hours ban
  const expiresAtEpochMs = epochMs + 24 * 60 * 60 * 1000;
  const expiresAt = new Date(expiresAtEpochMs).toISOString();

  const banId = `BAN-${Date.now().toString(36).toUpperCase()}`;
  const ban: PortalBan = {
    id: banId,
    executive: params.executive,
    complaintId: params.complaintId ?? "",
    reason: params.reason,
    startedAt: isoString,
    expiresAt,
    expiresAtEpochMs,
    issuedBy: params.adminActor,
    isActive: true,
  };

  inMemoryBans.unshift(ban);

  if (params.complaintId) {
    const foundComp = inMemoryComplaints.find((c) => c.id === params.complaintId);
    if (foundComp) {
      foundComp.status = "Temporary Ban Active";
    }
  }

  // If this executive is currently active, terminate their session immediately
  if (inMemoryActiveSession && inMemoryActiveSession.executive === params.executive) {
    inMemoryActiveSession.status = "TERMINATED_RECOVERY";
    inMemoryActiveSession.endedAt = isoString;
    inMemoryActiveSession.endedAtEpochMs = epochMs;
    inMemoryActiveSession.durationSeconds = Math.floor(
      (epochMs - inMemoryActiveSession.startedAtEpochMs) / 1000,
    );
    await recordSessionToSheet(inMemoryActiveSession);
    inMemoryActiveSession = null;
  }

  try {
    await portalSheetsAppend(`${TAB_BANS}!A:K`, [
      [
        ban.id,
        ban.executive,
        ban.complaintId,
        ban.reason,
        ban.startedAt,
        ban.expiresAt,
        ban.issuedBy,
        "TRUE",
        "",
        "",
        "",
      ],
    ]);
  } catch (err) {
    console.warn("Failed to append ban to Google Sheet:", err);
  }

  await recordAuditLog({
    action: "BAN_IMPOSED",
    actor: params.adminActor,
    details: `Imposed 24-hour temporary ban on ${params.executive} (Reason: ${params.reason}, Expires: ${expiresAt})`,
  });

  return { ok: true, ban };
}

export async function adminRevokeBan(params: {
  banId: string;
  revokeReason: string;
  adminActor: string;
}): Promise<{ ok: boolean; error?: string }> {
  await initPortalStore();
  const { isoString } = getNowInIST();

  const ban = inMemoryBans.find((b) => b.id === params.banId);
  if (!ban) {
    return { ok: false, error: "Ban record not found." };
  }

  ban.isActive = false;
  ban.revokedAt = isoString;
  ban.revokedBy = params.adminActor;
  ban.revokeReason = params.revokeReason;

  await recordAuditLog({
    action: "BAN_REVOKED",
    actor: params.adminActor,
    details: `Revoked 24-hour ban for ${ban.executive} (Reason: ${params.revokeReason})`,
  });

  return { ok: true };
}

export async function getPortalReportsData() {
  await initPortalStore();

  // Fetch all sessions from Sheet
  let sessions: PortalSession[] = [];
  try {
    const rows = await portalSheetsGet(`${TAB_SESSIONS}!A2:K`);
    if (Array.isArray(rows)) {
      sessions = rows
        .filter((r) => r[0] && r[1])
        .map((r) => ({
          id: r[0]!,
          executive: r[1] as PortalExecutive,
          startedAt: r[2] ?? "",
          startedAtEpochMs: new Date(r[2] ?? "").getTime() || 0,
          endedAt: r[3] || null,
          endedAtEpochMs: r[3] ? new Date(r[3]).getTime() : null,
          durationSeconds: Number(r[4] ?? 0) || 0,
          reason: (r[5] ?? "Collection follow-up") as SessionReason,
          customReason: r[6] || undefined,
          sessionType: (r[7] ?? "TEMPORARY") as SessionType,
          authorisedSlot: r[8] || undefined,
          status: (r[9] ?? "COMPLETED") as SessionStatus,
          isOverdue: r[10] === "TRUE" || r[10] === "true",
        }));
    }
  } catch (err) {
    console.warn("Failed to fetch sessions from Google Sheet:", err);
  }

  // Include current active session in memory if not already in list
  if (inMemoryActiveSession && inMemoryActiveSession.status === "ACTIVE") {
    if (!sessions.some((s) => s.id === inMemoryActiveSession!.id)) {
      sessions.unshift(inMemoryActiveSession);
    }
  }

  cleanExpiredBans();

  return {
    sessions,
    complaints: inMemoryComplaints,
    warnings: inMemoryWarnings,
    bans: inMemoryBans,
    auditLogs: inMemoryAudit,
    schedules: inMemorySchedules.map((s) => ({
      ...s,
      slots:
        Array.isArray(s.slots) && s.slots.length > 0
          ? s.slots
          : (DEFAULT_SCHEDULES.find((d) => d.executive === s.executive)?.slots ?? []),
    })),
  };
}

export async function saveSchedulesOnServer(newSchedules: ExecutiveSchedule[], adminActor: string) {
  await initPortalStore();

  // Always persist a complete, validated schedule set. Code defaults remain the
  // fallback if a schedule is missing or malformed in the admin submission.
  const normalizedSchedules: ExecutiveSchedule[] = DEFAULT_SCHEDULES.map((fallback) => {
    const submitted = newSchedules.find((schedule) => schedule?.executive === fallback.executive);
    const submittedSlots = Array.isArray(submitted?.slots) ? submitted.slots : [];
    const slotsAreValid =
      submittedSlots.length > 0 &&
      submittedSlots.every(
        (slot) =>
          slot &&
          /^\d{2}:\d{2}$/.test(slot.start) &&
          /^\d{2}:\d{2}$/.test(slot.end) &&
          slot.start < slot.end &&
          typeof slot.label === "string",
      );

    return {
      executive: fallback.executive,
      isAvailable: typeof submitted?.isAvailable === "boolean" ? submitted.isAvailable : fallback.isAvailable,
      notes: typeof submitted?.notes === "string" ? submitted.notes : fallback.notes ?? "",
      slots: slotsAreValid ? submittedSlots : fallback.slots.map((slot) => ({ ...slot })),
    };
  });

  // Do not report success or replace the active in-memory schedule until the
  // Google Sheets write succeeds; otherwise a restart could silently lose edits.
  const rows = normalizedSchedules.map((schedule) => [
    schedule.executive,
    JSON.stringify(schedule.slots),
    schedule.isAvailable ? "TRUE" : "FALSE",
    schedule.notes ?? "",
  ]);

  try {
    await portalSheetsUpdate(`${TAB_SCHEDULES}!A2:D${rows.length + 1}`, rows);
  } catch (err) {
    console.error("Failed to persist executive schedules to Google Sheet:", err);
    throw new Error("Schedules could not be saved to Google Sheets. Your previous schedule is still active; please try again.");
  }

  inMemorySchedules = normalizedSchedules;

  await recordAuditLog({
    action: "SCHEDULES_UPDATED",
    actor: adminActor,
    details: `Updated portal schedules for ${normalizedSchedules.length} executives.`,
  });

  return { ok: true };
}

export async function getBankPortalSpreadsheetDetails() {
  return getBankPortalSpreadsheetConfig();
}

export async function setBankPortalSpreadsheet(input: {
  spreadsheetInput: string;
  adminActor: string;
}) {
  const result = setBankPortalSpreadsheetId(input.spreadsheetInput, input.adminActor);
  if (result.ok) {
    await recordAuditLog({
      action: "BANK_PORTAL_SPREADSHEET_UPDATED",
      actor: input.adminActor,
      details: `Updated Bank Portal Google Spreadsheet to: ${result.spreadsheetId} (Strictly separate from Daily Collection)`,
    });
  }
  return result;
}

export async function createBankPortalDedicatedSpreadsheet(input: {
  title?: string | undefined;
  adminActor: string;
}) {
  const result = await createDedicatedBankPortalSpreadsheet(
    input.title || "Mahavtaar Bank Portal Usage & Accountability",
    input.adminActor,
  );
  if (result.ok) {
    await recordAuditLog({
      action: "BANK_PORTAL_SPREADSHEET_CREATED",
      actor: input.adminActor,
      details: `Created new dedicated Bank Portal Google Spreadsheet: ${result.spreadsheetId}`,
    });
  }
  return result;
}
