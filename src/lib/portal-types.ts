export const PORTAL_EXECUTIVES = [
  "Aman",
  "Aarti",
  "Bharti",
  "Pooja",
  "Vinita",
  "Ankita",
  "Sunanda",
  "Julie",
] as const;

export type PortalExecutive = (typeof PORTAL_EXECUTIVES)[number];

export const SESSION_REASONS = [
  "Collection follow-up",
  "Payment verification",
  "Customer account review",
  "Receipt or transaction verification",
  "Batch-related work",
  "Other",
] as const;

export type SessionReason = (typeof SESSION_REASONS)[number];

export type SessionType = "SCHEDULED" | "TEMPORARY" | "BATCH_HANDLING" | "EMERGENCY_OVERRIDE";

export type SessionStatus = "ACTIVE" | "COMPLETED" | "EXPIRED" | "TERMINATED_RECOVERY";

export interface TimeSlot {
  start: string; // "HH:mm" in 24h IST
  end: string; // "HH:mm" in 24h IST
  label: string; // e.g. "10:00–10:29 AM"
}

export interface ExecutiveSchedule {
  executive: PortalExecutive;
  slots: TimeSlot[];
  isAvailable: boolean;
  notes?: string;
}

export const TEMPORARY_ACCESS_SECONDS = 435; // 7 minutes and 15 seconds (58 min / 8)

export const ANKITA_BATCH_WINDOW = {
  executive: "Ankita" as PortalExecutive,
  start: "18:30",
  end: "19:30",
  label: "6:30 PM–7:30 PM IST",
};

export const STANDARD_WARNING_TEXT =
  "Your complaint has been reviewed by the administrator, and a violation of the portal usage rules has been verified. Please remain active in the designated work group and follow your assigned schedule. Repeated verified violations may result in a temporary 24-hour ban from this application's portal-access scheduling system.";

// Initial standard schedule as requested
export const DEFAULT_SCHEDULES: ExecutiveSchedule[] = [
  {
    executive: "Aarti",
    isAvailable: true,
    slots: [
      { start: "10:00", end: "10:29", label: "10:00–10:29 AM" },
      { start: "15:01", end: "15:30", label: "3:01–3:30 PM" },
    ],
  },
  {
    executive: "Bharti",
    isAvailable: true,
    slots: [
      { start: "10:29", end: "10:58", label: "10:29–10:58 AM" },
      { start: "15:30", end: "15:59", label: "3:30–3:59 PM" },
    ],
  },
  {
    executive: "Pooja",
    isAvailable: true,
    slots: [
      { start: "10:58", end: "11:27", label: "10:58–11:27 AM" },
      { start: "15:59", end: "16:28", label: "3:59–4:28 PM" },
    ],
  },
  {
    executive: "Vinita",
    isAvailable: true,
    slots: [
      { start: "11:27", end: "11:56", label: "11:27–11:56 AM" },
      { start: "16:28", end: "16:57", label: "4:28–4:57 PM" },
    ],
  },
  {
    executive: "Ankita",
    isAvailable: true,
    slots: [
      { start: "11:56", end: "12:25", label: "11:56 AM–12:25 PM" },
      { start: "16:57", end: "17:26", label: "4:57–5:26 PM" },
    ],
  },
  {
    executive: "Sunanda",
    isAvailable: true,
    slots: [
      { start: "12:25", end: "12:54", label: "12:25–12:54 PM" },
      { start: "17:26", end: "17:55", label: "5:26–5:55 PM" },
    ],
  },
  {
    executive: "Aman",
    isAvailable: true,
    slots: [
      { start: "12:54", end: "13:15", label: "12:54–1:15 PM" },
      { start: "13:45", end: "13:53", label: "1:45–1:53 PM" },
      { start: "14:22", end: "14:30", label: "2:22–2:30 PM" },
      { start: "14:40", end: "15:01", label: "2:40–3:01 PM" },
    ],
  },
  {
    executive: "Julie",
    isAvailable: true,
    slots: [
      { start: "13:53", end: "14:22", label: "1:53–2:22 PM" },
      { start: "17:55", end: "18:24", label: "5:55–6:24 PM" },
    ],
  },
];

export interface PortalSession {
  id: string;
  executive: PortalExecutive;
  startedAt: string; // ISO
  startedAtEpochMs: number;
  endedAt?: string | null;
  endedAtEpochMs?: number | null;
  durationSeconds: number;
  reason: SessionReason;
  customReason?: string | undefined;
  sessionType: SessionType;
  authorisedSlot?: string | undefined;
  status: SessionStatus;
  isOverdue?: boolean;
}

export type ComplaintStatus =
  | "Pending Verification"
  | "Verified — Valid"
  | "Dismissed — Invalid"
  | "Insufficient Evidence"
  | "Warning Issued"
  | "Temporary Ban Active"
  | "Ban Completed";

export interface PortalComplaint {
  id: string;
  complainant: PortalExecutive;
  concernedExecutive: PortalExecutive;
  subject: string;
  description: string;
  loanRef?: string | undefined;
  evidenceUrl?: string | undefined;
  status: ComplaintStatus;
  createdAt: string; // ISO
  createdAtEpochMs: number;
  isQueuedForBatch: boolean;
  escalatedFromQuery: boolean;
  canEscalateAtEpochMs?: number;
  escalatedAt?: string;
  resolvedAt?: string;
  resolver?: string;
  resolutionNotes?: string;
  adminDecision?: string;
  adminRemarks?: string;
  verifiedAt?: string;
}

export interface PortalWarning {
  id: string;
  executive: PortalExecutive;
  complaintId: string;
  reason: string;
  warningText: string;
  issuedBy: string;
  issuedAt: string;
  acknowledged: boolean;
}

export interface PortalBan {
  id: string;
  executive: PortalExecutive;
  complaintId: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
  expiresAtEpochMs: number;
  issuedBy: string;
  isActive: boolean;
  revokedAt?: string | undefined;
  revokedBy?: string | undefined;
  revokeReason?: string | undefined;
}

export interface PortalAuditLog {
  id: string;
  timestamp: string;
  action: string;
  actor: string;
  details: string;
}

export interface LivePortalStatus {
  isPortalActive: boolean;
  activeSession: {
    id: string;
    executive: PortalExecutive;
    startedAt: string;
    startedAtEpochMs: number;
    reason: string;
    sessionType: SessionType;
    authorisedSlot?: string | undefined;
    maxAllowedSeconds: number | null;
  } | null;
  currentScheduled: {
    executive: PortalExecutive;
    start: string;
    end: string;
    formattedSlot: string;
    isBatchWindow?: boolean;
  } | null;
  nextScheduled: {
    executive: PortalExecutive;
    start: string;
    end: string;
    formattedSlot: string;
  } | null;
  serverTimeEpochMs: number;
  serverTimeIso: string;
  isAnkitaBatchWindow: boolean;
}
