export const DAILY_COLLECTION_SPREADSHEET_ID = "1AXLakW3subO9H-O9iWIpXJyjT4JLXRTG5uiL3dWsY5g";

export const PORTAL_TABS = {
  SESSIONS: "Portal_Sessions",
  SCHEDULES: "Portal_Schedules",
  COMPLAINTS: "Portal_Complaints",
  WARNINGS: "Portal_Warnings",
  BANS: "Portal_Bans",
  AUDIT: "Portal_Audit",
} as const;

export const PORTAL_TAB_HEADERS: Record<string, string[]> = {
  [PORTAL_TABS.SESSIONS]: [
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
  ],
  [PORTAL_TABS.SCHEDULES]: ["Executive", "SlotsJson", "IsAvailable", "Notes"],
  [PORTAL_TABS.COMPLAINTS]: [
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
  ],
  [PORTAL_TABS.WARNINGS]: [
    "WarningID",
    "Executive",
    "ComplaintID",
    "Reason",
    "WarningText",
    "IssuedBy",
    "IssuedAt",
    "Acknowledged",
  ],
  [PORTAL_TABS.BANS]: [
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
  ],
  [PORTAL_TABS.AUDIT]: ["AuditID", "Timestamp", "Action", "Actor", "Details"],
};

export interface BankPortalConfig {
  spreadsheetId: string;
  spreadsheetTitle: string;
  updatedAt: string;
  updatedBy: string;
  isCustom: boolean;
}

// The encrypted deployment secret is the durable source of truth. Runtime config is
// only a temporary override for the current process; no filesystem persistence is used.
let currentBankPortalConfig: BankPortalConfig = {
  spreadsheetId: process.env["BANK_PORTAL_SPREADSHEET_ID"]?.trim() || "",
  spreadsheetTitle: "Mahavtaar Bank Portal Usage & Accountability",
  updatedAt: new Date().toISOString(),
  updatedBy: "Environment",
  isCustom: Boolean(process.env["BANK_PORTAL_SPREADSHEET_ID"]?.trim()),
};

export function persistBankPortalConfig(config: BankPortalConfig) {
  if (!config.spreadsheetId.trim() || config.spreadsheetId === DAILY_COLLECTION_SPREADSHEET_ID) {
    throw new Error("A valid, separate Bank Portal spreadsheet ID is required.");
  }
  currentBankPortalConfig = { ...config, spreadsheetId: config.spreadsheetId.trim() };
}

// Extract spreadsheet ID from either a raw ID or full Google Sheets URL
export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
}

export function getBankPortalSpreadsheetId(): string {
  const environmentId = process.env["BANK_PORTAL_SPREADSHEET_ID"]?.trim();
  return environmentId || currentBankPortalConfig.spreadsheetId;
}

export function getBankPortalSpreadsheetUrl(): string {
  const id = getBankPortalSpreadsheetId();
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

export function getBankPortalSpreadsheetConfig() {
  const id = getBankPortalSpreadsheetId();
  const isSeparate = id !== DAILY_COLLECTION_SPREADSHEET_ID;
  const hasApiCredentials = Boolean(
    process.env["LOVABLE_API_KEY"] && process.env["GOOGLE_SHEETS_API_KEY"],
  );

  return {
    spreadsheetId: id,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`,
    spreadsheetTitle: currentBankPortalConfig.spreadsheetTitle,
    isSeparate,
    dailyCollectionSpreadsheetId: DAILY_COLLECTION_SPREADSHEET_ID,
    tabs: Object.values(PORTAL_TABS),
    updatedAt: currentBankPortalConfig.updatedAt,
    updatedBy: currentBankPortalConfig.updatedBy,
    isCustom: currentBankPortalConfig.isCustom,
    hasApiCredentials,
  };
}

export function setBankPortalSpreadsheetId(
  input: string,
  updatedBy: string = "Aman",
): { ok: boolean; spreadsheetId: string; message: string } {
  const id = extractSpreadsheetId(input);
  if (!id) {
    return { ok: false, spreadsheetId: "", message: "Invalid Google Spreadsheet ID or URL." };
  }

  const environmentId = process.env["BANK_PORTAL_SPREADSHEET_ID"]?.trim();
  if (environmentId && id !== environmentId) {
    return {
      ok: false,
      spreadsheetId: id,
      message: "The encrypted BANK_PORTAL_SPREADSHEET_ID secret is authoritative. Update that server secret to change the Bank Portal spreadsheet.",
    };
  }

  // Strict check: Bank Portal must NEVER use the Daily Collection spreadsheet
  if (id === DAILY_COLLECTION_SPREADSHEET_ID) {
    return {
      ok: false,
      spreadsheetId: id,
      message:
        "Daily Collection spreadsheet ID cannot be used for Bank Portal! Bank Portal must use a separate dedicated Google Spreadsheet.",
    };
  }

  persistBankPortalConfig({
    spreadsheetId: id,
    spreadsheetTitle: "Mahavtaar Bank Portal Usage & Accountability",
    updatedAt: new Date().toISOString(),
    updatedBy,
    isCustom: true,
  });

  return {
    ok: true,
    spreadsheetId: id,
    message: `Bank Portal Google Spreadsheet successfully set to ${id}.`,
  };
}
