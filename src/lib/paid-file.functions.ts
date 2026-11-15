import { createServerFn } from "@tanstack/react-start";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireSession } from "./auth.functions";
import {
  isProtectedSource,
  normalisePaidId,
  parsePaidDate,
  type DacSource,
  type MasterRow,
} from "./paid-file-reconciliation";

const GATEWAY = "https://connector-gateway.lovable.dev";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
type Target = "monthly-master";
type DriveFile = { id: string; name: string; webViewLink?: string; modifiedTime?: string };

const changeSchema = z.object({
  row: z.number().int().positive(),
  agreementId: z.string().min(1).max(100),
  dac: z.number().finite(),
  newTotal: z.number().finite(),
  ecs: z.number().finite().optional().default(0),
  special: z.number().finite().optional().default(0),
  paymentDate: z.string().trim().max(40).optional().default(""),
  clearProvisional: z.boolean().optional().default(false),
});

const conflictFlagSchema = z.object({
  row: z.number().int().positive(),
  agreementId: z.string().min(1).max(100),
  existingDac: z.number().finite(),
  incomingDac: z.number().finite(),
  incomingEcs: z.number().finite().optional().default(0),
  incomingSpecial: z.number().finite().optional().default(0),
  source: z.string().max(40).default(""),
  reason: z.string().max(300),
});

const applySchema = z
  .object({
    target: z.literal("monthly-master"),
    // Explicit provenance mode. Defaults to the unchanged normal Paid File path.
    sourceMode: z.enum(["PAID_FILE", "MANUAL"]).optional().default("PAID_FILE"),
    fileName: z.string().trim().min(1).max(240),
    fileDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    totalDac: z.number().finite(),
    totalSfdc: z.number().finite(),
    totalOnline: z.number().finite(),
    protectedSkips: z.number().int().min(0).optional().default(0),
    unmatchedSkipped: z.number().int().min(0).optional().default(0),
    duplicatesReplaced: z.number().int().min(0).optional().default(0),
    changes: z.array(changeSchema).max(20000),
    conflictFlags: z.array(conflictFlagSchema).max(10000).optional().default([]),
  })
  .refine((v) => v.changes.length + v.conflictFlags.length > 0, {
    message: "At least one update or conflict flag is required to commit.",
  });

export type PaidFileAuditEntry = {
  row: number;
  timestamp: string;
  adminName: string;
  fileName: string;
  recordsApplied: number;
  totalDac: number;
  totalSfdc: number;
  totalOnline: number;
  fingerprint: string;
  applyStatus: string;
  completedBatches: number;
  conflictsFlagged: number;
  protectedSkips: number;
  unmatchedSkipped: number;
  previousHash: string;
  chainHash: string;
  hashVerified: boolean | null;
};

function authHeaders(key: string) {
  const token = process.env["LOVABLE_API_KEY"],
    connection = process.env[key];
  if (!token || !connection) throw new Error("Google Drive/Sheets connector is not configured.");
  return {
    Authorization: "Bearer " + token,
    "X-Connection-Api-Key": connection,
    "Content-Type": "application/json",
  };
}

async function checked<T>(url: string, key: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders(key), ...(init?.headers ?? {}) },
  });
  if (!res.ok)
    throw new Error(
      "Google connector request failed (" + res.status + "): " + (await res.text()).slice(0, 300),
    );
  return res.json() as Promise<T>;
}

const sheetsUrl = (id: string, suffix = "") =>
  GATEWAY + "/google_sheets/v4/spreadsheets/" + encodeURIComponent(id) + suffix;

function monthTitle() {
  return (
    "Mahavtaar Master Allocation " +
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      month: "long",
      year: "numeric",
    }).format(new Date())
  );
}

async function findMonthlyMaster(): Promise<DriveFile> {
  const url = new URL(GATEWAY + "/google_drive/drive/v3/files");
  url.searchParams.set(
    "q",
    "name contains '" +
      monthTitle().replace(/'/g, "\\'") +
      "' and mimeType = '" +
      SHEET_MIME +
      "' and trashed = false",
  );
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("fields", "files(id,name,webViewLink,modifiedTime,mimeType,trashed)");
  const result = await checked<{ files?: DriveFile[] }>(url.toString(), "GOOGLE_DRIVE_API_KEY");
  const candidates = (result.files ?? []).filter((file) => Boolean(file.id));
  if (!candidates.length)
    throw new Error(
      "No active current-month Master Allocation spreadsheet was found: " + monthTitle() + ".",
    );
  return candidates.sort(
    (a, b) => Date.parse(b.modifiedTime ?? "") - Date.parse(a.modifiedTime ?? ""),
  )[0]!;
}

async function resolveTarget(_target: Target) {
  const file = await findMonthlyMaster();
  const metadata = await checked<{ sheets?: { properties?: { title?: string } }[] }>(
    sheetsUrl(file.id, "?fields=sheets.properties.title"),
    "GOOGLE_SHEETS_API_KEY",
  );
  const tabs = (metadata.sheets ?? [])
    .map((sheet) => sheet.properties?.title)
    .filter((title): title is string => Boolean(title));
  const agreementAliases = [
    "Agreement ID",
    "AgreementID",
    "Agreement_Id",
    "Loan No",
    "Loan Number",
    "Account No",
    "LAN",
    "Loan ID",
  ];
  const hasAgreementHeader = async (name: string) => {
    const header = await values(file.id, "'" + name.replace(/'/g, "''") + "'!A1:ZZ1");
    return findCol(header[0] ?? [], agreementAliases) >= 0;
  };
  let tab: string | undefined;
  for (const preferred of ["Data", "Master Allocation Data"]) {
    if (tabs.includes(preferred) && (await hasAgreementHeader(preferred))) {
      tab = preferred;
      break;
    }
  }
  if (!tab) {
    for (const candidate of tabs) {
      if (await hasAgreementHeader(candidate)) {
        tab = candidate;
        break;
      }
    }
  }
  if (!tab)
    throw new Error(
      "No Master Allocation data tab found. Expected Data, Master Allocation Data, or a worksheet with an Agreement ID header.",
    );
  return {
    id: file.id,
    name: file.name,
    tab,
    url: file.webViewLink ?? "https://docs.google.com/spreadsheets/d/" + file.id,
  };
}

async function values(id: string, range: string): Promise<string[][]> {
  const result = await checked<{ values?: string[][] }>(
    sheetsUrl(id, "/values/" + encodeURIComponent(range)),
    "GOOGLE_SHEETS_API_KEY",
  );
  return result.values ?? [];
}

function normHeader(value: unknown) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[ _-]+/g, " ")
    .trim();
}

function findCol(headers: string[], aliases: string[]) {
  const set = new Set(aliases.map(normHeader));
  return headers.findIndex((h) => set.has(normHeader(h)));
}

function numeric(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const n = Number(raw.replace(/[₹,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(n) ? n : 0;
}

function optionalNumeric(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw.replace(/[₹,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(n) ? n : null;
}

function parseBool(value: unknown): boolean {
  const s = String(value ?? "")
    .trim()
    .toUpperCase();
  return s === "TRUE" || s === "YES" || s === "1" || s === "Y";
}

function parseDacSource(value: unknown): DacSource {
  const s = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (s === "MANUAL") return "MANUAL";
  if (s === "CORRECTED") return "CORRECTED";
  if (s === "PAID_FILE" || s === "PAID") return "PAID_FILE";
  if (s === "PROVISIONAL") return "PROVISIONAL";
  return "";
}

function columnLetter(index: number) {
  let result = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
  return result;
}

async function readMaster(target: Target = "monthly-master") {
  const file = await resolveTarget(target);
  const headerRows = await values(file.id, "'" + file.tab + "'!A1:ZZ1");
  if (!headerRows.length) throw new Error("The target sheet has no header row.");
  const headers = headerRows[0] ?? [];
  const cols = {
    agreement: findCol(headers, [
      "Agreement ID",
      "AgreementID",
      "Agreement_Id",
      "Loan No",
      "Loan Number",
      "Loan ID",
      "Account No",
      "LAN",
      "AGMT_NO",
      "AGMT NO",
      "CONTRACT NO",
      "PROPOSAL NO",
      "CASE ID",
      "AGREEMENTNO",
    ]),
    total: findCol(headers, ["Existing Total", "Total", "Total Amount", "Paid Total"]),
    dac: findCol(headers, ["DAC", "DAC Amount", "Collection DAC"]),
    bucket: findCol(headers, ["Bucket"]),
    city: findCol(headers, ["City"]),
    customer: findCol(headers, ["Customer", "Customer Name", "Borrower Name"]),
    executive: findCol(headers, ["Executive", "Executive Name", "Allocated To", "EX. Name"]),
    newTotal: findCol(headers, ["New Total"]),
    remaining: findCol(headers, ["Remaining", "Remaining Amount", "Remaining Balance", "Balance"]),
    ecs: findCol(headers, ["ECS Amount", "ECS"]),
    special: findCol(headers, ["Special Amount", "Special"]),
    paymentDate: findCol(headers, [
      "Payment Date",
      "Paid Date",
      "Pay Date",
      "Collection Date",
      "Last Payment Date",
    ]),
    dacSource: findCol(headers, ["DAC Source", "Source", "dac_source", "Payment Source"]),
    isCorrected: findCol(headers, ["Is Corrected", "Corrected", "is_corrected"]),
    provisionalDac: findCol(headers, ["Provisional DAC", "provisional_dac", "Provisional"]),
    dailyCollectionProvisionalDac: findCol(headers, ["Daily Collection Provisional DAC", "Daily Collection DAC"]),
    sourceType: findCol(headers, ["Source Type", "Source_Type"]),
    isConflict: findCol(headers, ["Is Conflict", "Conflict", "is_conflict"]),
    paidConflictDac: findCol(headers, ["Paid Conflict DAC", "paid_conflict_dac", "Conflict DAC"]),
    lastPaidUploadAt: findCol(headers, [
      "Last Paid Upload",
      "last_paid_upload_at",
      "Paid Updated At",
    ]),
  };

  if (cols.agreement < 0 || cols.total < 0 || cols.newTotal < 0 || cols.dac < 0)
    throw new Error(
      "Required columns missing. Agreement ID, Total, DAC and New Total must exist in " +
        file.tab +
        ".",
    );

  const selected = [
    ...new Set(
      [
        cols.agreement,
        cols.total,
        cols.dac,
        cols.newTotal,
        cols.remaining,
        cols.bucket,
        cols.city,
        cols.customer,
        cols.executive,
        cols.ecs,
        cols.special,
        cols.paymentDate,
        cols.dacSource,
        cols.isCorrected,
        cols.provisionalDac,
        cols.dailyCollectionProvisionalDac,
        cols.sourceType,
        cols.isConflict,
        cols.paidConflictDac,
      ].filter((i) => i >= 0),
    ),
  ];

  const columns = await Promise.all(
    selected.map(async (index) => ({
      index,
      rows: await values(
        file.id,
        "'" + file.tab + "'!" + columnLetter(index) + "2:" + columnLetter(index),
      ),
    })),
  );
  const byColumn = new Map(columns.map((c) => [c.index, c.rows]));
  const rowCount = Math.max(0, ...columns.map((c) => c.rows.length));
  const data: MasterRow[] = [];

  for (let i = 0; i < rowCount; i++) {
    const cell = (index: number) => (index >= 0 ? (byColumn.get(index)?.[i]?.[0] ?? "") : "");
    const agreementId = normalisePaidId(cell(cols.agreement));
    if (!agreementId) continue;
    data.push({
      row: i + 2,
      agreementId,
      existingTotal: numeric(cell(cols.total)),
      existingDac: cols.dac >= 0 ? numeric(cell(cols.dac)) : 0,
      existingNewTotal: cols.newTotal >= 0 ? numeric(cell(cols.newTotal)) : 0,
      existingRemaining: cols.remaining >= 0 ? optionalNumeric(cell(cols.remaining)) : null,
      existingEcs: cols.ecs >= 0 ? numeric(cell(cols.ecs)) : 0,
      existingSpecial: cols.special >= 0 ? numeric(cell(cols.special)) : 0,
      existingPaymentDate: cols.paymentDate >= 0 ? String(cell(cols.paymentDate) ?? "").trim() : "",
      bucket: String(cell(cols.bucket) ?? ""),
      city: String(cell(cols.city) ?? ""),
      customer: cols.customer >= 0 ? String(cell(cols.customer) ?? "") : "",
      executive: cols.executive >= 0 ? String(cell(cols.executive) ?? "") : "",
      dacSource: cols.dacSource >= 0 ? parseDacSource(cell(cols.dacSource)) : "",
      isCorrected: cols.isCorrected >= 0 ? parseBool(cell(cols.isCorrected)) : false,
      provisionalDac: cols.provisionalDac >= 0 ? optionalNumeric(cell(cols.provisionalDac)) : null,
      dailyCollectionProvisionalDac: cols.dailyCollectionProvisionalDac >= 0 ? optionalNumeric(cell(cols.dailyCollectionProvisionalDac)) : null,
      sourceType: cols.sourceType >= 0 ? String(cell(cols.sourceType) ?? "").trim() : "",
      isConflict: cols.isConflict >= 0 ? parseBool(cell(cols.isConflict)) : false,
      paidConflictDac:
        cols.paidConflictDac >= 0 ? optionalNumeric(cell(cols.paidConflictDac)) : null,
    });
  }

async function ensureDailyCollectionMetadataColumns(master: Awaited<ReturnType<typeof readMaster>>) {
  const headerRows = await values(master.file.id, "'" + master.file.tab + "'!A1:ZZ1");
  const headers = headerRows[0] ?? [];
  const ensureHeader = async (name: string, aliases: string[]) => {
    if (findCol(headers, aliases) >= 0) return;
    const index = headers.length;
    if (index >= 702) throw new Error("No free Master Allocation header column is available.");
    await checked(
      sheetsUrl(
        master.file.id,
        "/values/" + encodeURIComponent("'" + master.file.tab + "'!" + columnLetter(index) + "1") + "?valueInputOption=RAW",
      ),
      "GOOGLE_SHEETS_API_KEY",
      { method: "PUT", body: JSON.stringify({ values: [[name]] }) },
    );
    headers[index] = name;
  };
  await ensureHeader("Daily Collection Provisional DAC", ["Daily Collection Provisional DAC", "Daily Collection DAC"]);
  await ensureHeader("Source Type", ["Source Type", "Source_Type"]);
  return readMaster("monthly-master");
}

  return {
    file,
    cols,
    data,
    hasProtectionColumns:
      cols.dacSource >= 0 ||
      cols.isCorrected >= 0 ||
      cols.provisionalDac >= 0 ||
      cols.isConflict >= 0,
  };
}

export const fetchMasterMatchingData = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) => z.object({ target: z.literal("monthly-master") }).parse(v))
  .handler(async ({ data }) => {
    await requireSession("Admin");
    try {
      const master = await readMaster(data.target);
      return {
        found: true as const,
        target: data.target,
        expectedTitle: monthTitle(),
        spreadsheetName: master.file.name,
        spreadsheetUrl: master.file.url,
        tab: master.file.tab,
        hasProtectionColumns: master.hasProtectionColumns,
        rows: master.data,
      };
    } catch (error) {
      return {
        found: false as const,
        target: data.target,
        expectedTitle: monthTitle(),
        spreadsheetName: "",
        spreadsheetUrl: "",
        tab: "",
        hasProtectionColumns: false,
        rows: [] as MasterRow[],
        errorMessage:
          error instanceof Error ? error.message : "Could not load Master Allocation spreadsheet.",
      };
    }
  });

const AUDIT_HEADERS = [
  "Timestamp (IST)",
  "Admin Name",
  "File Name",
  "Records Applied",
  "Total DAC (₹)",
  "Total SFDC (₹)",
  "Total Online (₹)",
  "Batch Fingerprint",
  "Apply Status",
  "Completed Batches",
  "Conflicts Flagged",
  "Protected Skips",
  "Unmatched Skipped",
  "Previous Hash",
  "Chain Hash",
];

const CONFLICT_HEADERS = [
  "Timestamp (IST)",
  "Admin Name",
  "File Name",
  "Agreement ID",
  "Master Row",
  "Protected / Current Source",
  "Existing DAC (₹)",
  "Incoming Paid DAC (₹)",
  "Incoming ECS (₹)",
  "Incoming Special (₹)",
  "Reason",
  "Batch Fingerprint",
];

async function ensureAuditTab(id: string) {
  const meta = await checked<{ sheets?: { properties?: { title?: string } }[] }>(
    sheetsUrl(id, "?fields=sheets.properties"),
    "GOOGLE_SHEETS_API_KEY",
  );
  if (!(meta.sheets ?? []).some((s) => s.properties?.title === "Paid_File_Audit_Log")) {
    await checked(sheetsUrl(id, ":batchUpdate"), "GOOGLE_SHEETS_API_KEY", {
      method: "POST",
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: "Paid_File_Audit_Log" } } }],
      }),
    });
  }
  await checked(
    sheetsUrl(
      id,
      "/values/" + encodeURIComponent("'Paid_File_Audit_Log'!A1:O1") + "?valueInputOption=RAW",
    ),
    "GOOGLE_SHEETS_API_KEY",
    { method: "PUT", body: JSON.stringify({ values: [AUDIT_HEADERS] }) },
  );
}

async function ensureConflictsTab(id: string) {
  const meta = await checked<{ sheets?: { properties?: { title?: string } }[] }>(
    sheetsUrl(id, "?fields=sheets.properties"),
    "GOOGLE_SHEETS_API_KEY",
  );
  if (!(meta.sheets ?? []).some((s) => s.properties?.title === "Paid_File_Conflicts")) {
    await checked(sheetsUrl(id, ":batchUpdate"), "GOOGLE_SHEETS_API_KEY", {
      method: "POST",
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: "Paid_File_Conflicts" } } }],
      }),
    });
  }
  await checked(
    sheetsUrl(
      id,
      "/values/" + encodeURIComponent("'Paid_File_Conflicts'!A1:L1") + "?valueInputOption=RAW",
    ),
    "GOOGLE_SHEETS_API_KEY",
    { method: "PUT", body: JSON.stringify({ values: [CONFLICT_HEADERS] }) },
  );
}

function computeAuditChainHash(params: {
  previousHash: string;
  fingerprint: string;
  timestamp: string;
  adminName: string;
  fileName: string;
  recordsApplied: number;
  conflictsFlagged: number;
}): string {
  return createHash("sha256")
    .update(
      [
        params.previousHash,
        params.fingerprint,
        params.timestamp,
        params.adminName,
        params.fileName,
        String(params.recordsApplied),
        String(params.conflictsFlagged),
      ].join("|"),
    )
    .digest("hex");
}

export const getPaidFileAuditHistory = createServerFn({ method: "GET" }).handler(async () => {
  await requireSession("Admin");
  try {
    const file = await findMonthlyMaster();
    const meta = await checked<{ sheets?: { properties?: { title?: string } }[] }>(
      sheetsUrl(file.id, "?fields=sheets.properties.title"),
      "GOOGLE_SHEETS_API_KEY",
    );
    const hasAudit = (meta.sheets ?? []).some((s) => s.properties?.title === "Paid_File_Audit_Log");
    if (!hasAudit) {
      return {
        found: true as const,
        spreadsheetName: file.name,
        entries: [] as PaidFileAuditEntry[],
        chainValid: true,
        verifiedCount: 0,
        brokenAtRow: null as number | null,
        totalBatches: 0,
        totalAppliedRows: 0,
        todayAppliedRows: 0,
        totalConflictsFlagged: 0,
      };
    }

    const rows = await values(file.id, "'Paid_File_Audit_Log'!A2:O");
    const entries: PaidFileAuditEntry[] = [];
    let chainValid = true;
    let verifiedCount = 0;
    let brokenAtRow: number | null = null;
    let expectedPrevHash = "GENESIS";

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] ?? [];
      if (!r.some((cell) => String(cell ?? "").trim() !== "")) continue;
      const timestamp = String(r[0] ?? "");
      const adminName = String(r[1] ?? "");
      const fileName = String(r[2] ?? "");
      const recordsApplied = numeric(r[3]);
      const totalDac = numeric(r[4]);
      const totalSfdc = numeric(r[5]);
      const totalOnline = numeric(r[6]);
      const fingerprint = String(r[7] ?? "");
      const applyStatus = String(r[8] ?? "");
      const completedBatches = numeric(r[9]);
      const conflictsFlagged = numeric(r[10]);
      const protectedSkips = numeric(r[11]);
      const unmatchedSkipped = numeric(r[12]);
      const previousHash = String(r[13] ?? "").trim();
      const chainHash = String(r[14] ?? "").trim();

      let hashVerified: boolean | null = null;
      if (previousHash && chainHash) {
        const expected = computeAuditChainHash({
          previousHash,
          fingerprint,
          timestamp,
          adminName,
          fileName,
          recordsApplied,
          conflictsFlagged,
        });
        const linksPrev = expectedPrevHash === "GENESIS" || previousHash === expectedPrevHash;
        hashVerified = expected === chainHash && linksPrev;
        if (hashVerified) {
          verifiedCount++;
        } else {
          chainValid = false;
          if (brokenAtRow === null) brokenAtRow = i + 2;
        }
        expectedPrevHash = chainHash;
      }

      entries.push({
        row: i + 2,
        timestamp,
        adminName,
        fileName,
        recordsApplied,
        totalDac,
        totalSfdc,
        totalOnline,
        fingerprint,
        applyStatus,
        completedBatches,
        conflictsFlagged,
        protectedSkips,
        unmatchedSkipped,
        previousHash,
        chainHash,
        hashVerified,
      });
    }

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const auditDate = (value: string) => {
      const match = value.match(/^(\\d{1,2})[/-](\\d{1,2})[/-](\\d{2,4})/);
      if (!match) return "";
      const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
      return year + "-" + String(match[2]).padStart(2, "0") + "-" + String(match[1]).padStart(2, "0");
    };
    const totalAppliedRows = entries.reduce((sum, entry) => sum + entry.recordsApplied, 0);
    const todayAppliedRows = entries
      .filter((entry) => auditDate(entry.timestamp) === today)
      .reduce((sum, entry) => sum + entry.recordsApplied, 0);
    const totalConflictsFlagged = entries.reduce((sum, entry) => sum + entry.conflictsFlagged, 0);
    const totalBatches = entries.length;
    return {
      found: true as const,
      spreadsheetName: file.name,
      entries: entries.slice().reverse().slice(0, 25),
      chainValid,
      verifiedCount,
      brokenAtRow,
      totalBatches,
      totalAppliedRows,
      todayAppliedRows,
      totalConflictsFlagged,
    };
  } catch {
    return {
      found: false as const,
      spreadsheetName: "",
      entries: [] as PaidFileAuditEntry[],
      chainValid: true,
      verifiedCount: 0,
      brokenAtRow: null as number | null,
      totalBatches: 0,
      totalAppliedRows: 0,
      todayAppliedRows: 0,
      totalConflictsFlagged: 0,
    };
  }
});

async function retryFetch(url: string, init: RequestInit) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      continue;
    }
    if (response.ok) return;
    const body = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 3)
      throw new Error(
        "Google Sheets batch update failed (" + response.status + "): " + body.slice(0, 300),
      );
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  throw new Error("Google Sheets retry limit exceeded.");
}

export const applyPaidFileChangeSet = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) => applySchema.parse(v))
  .handler(async ({ data }) => {
    const admin = await requireSession("Admin");
    let master = await readMaster(data.target);
    master = await ensureDailyCollectionMetadataColumns(master);
    const { file, cols } = master;

    const calculatedDac = data.changes.reduce((sum, change) => {
      if (data.sourceMode !== "MANUAL") return sum + change.dac;
      const current = master.data.find(
        (row) => row.row === change.row && row.agreementId === normalisePaidId(change.agreementId),
      );
      // Manual audit totals represent the incremental DAC amount, not the resulting balance.
      return sum + (current ? change.dac - current.existingDac : 0);
    }, 0);
    if (Math.abs(calculatedDac - data.totalDac) > 0.01)
      throw new Error("Submitted DAC total does not match the validated change set.");

    // Fingerprint the normalized change set + conflict flags so duplicates cannot replay silently
    const canonicalChanges = [...data.changes]
      .map((change) => ({
        row: change.row,
        agreementId: normalisePaidId(change.agreementId),
        dac: Number(change.dac.toFixed(2)),
        newTotal: Number(change.newTotal.toFixed(2)),
        ecs: Number(change.ecs.toFixed(2)),
        special: Number(change.special.toFixed(2)),
      }))
      .sort((a, b) => a.row - b.row || a.agreementId.localeCompare(b.agreementId));

    const canonicalConflicts = [...data.conflictFlags]
      .map((c) => ({
        row: c.row,
        agreementId: normalisePaidId(c.agreementId),
        incomingDac: Number(c.incomingDac.toFixed(2)),
      }))
      .sort((a, b) => a.row - b.row || a.agreementId.localeCompare(b.agreementId));

    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          target: data.target,
          sourceMode: data.sourceMode,
          changes: canonicalChanges,
          conflictFlags: canonicalConflicts,
        }),
      )
      .digest("hex");

    await ensureAuditTab(file.id);
    const auditRows = await values(file.id, "'Paid_File_Audit_Log'!A:O");
    const duplicate = auditRows.slice(1).find((r) => String(r[7] ?? "") === fingerprint);
    if (duplicate) {
      const status = String(duplicate[8] ?? "LEGACY");
      throw new Error(
        "This exact " + data.sourceMode + " change set already has an audit entry (status: " +
          status +
          "). Do not reapply it. Check the audit log before retrying.",
      );
    }

    // Find previous chain hash from latest chained audit row
    let previousHash = "GENESIS";
    for (let i = auditRows.length - 1; i >= 1; i--) {
      const candidate = String(auditRows[i]?.[14] ?? "").trim();
      if (candidate) {
        previousHash = candidate;
        break;
      }
    }

    const masterByRow = new Map(master.data.map((r) => [r.row, r]));
    const seen = new Set<number>();
    const rowRanges: { range: string; values: (string | number | boolean)[][] }[][] = [];
    const colLetter = columnLetter;
    const timestamp = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "short",
      timeStyle: "medium",
    }).format(new Date());

    for (const change of data.changes) {
      if (seen.has(change.row))
        throw new Error("Duplicate target row in submitted change set: " + change.row);
      seen.add(change.row);
      if (change.ecs !== 0 && cols.ecs < 0)
        throw new Error("ECS Amount column is missing from " + file.tab + ".");
      if (change.special !== 0 && cols.special < 0)
        throw new Error("Special Amount column is missing from " + file.tab + ".");

      const current = masterByRow.get(change.row);
      if (!current || current.agreementId !== normalisePaidId(change.agreementId))
        throw new Error(
          "Master Sheet changed after preview. Refresh and reconcile again (row " +
            change.row +
            ").",
        );

      // Manual-review mode is Admin-only (requireSession above), additive-only,
      // and may never mutate provisional state or create Paid File conflict flags.
      if (data.sourceMode === "MANUAL") {
        if (data.conflictFlags.length > 0 || data.totalSfdc !== 0 || data.totalOnline !== 0) {
          throw new Error("Manual review mode cannot submit Paid File conflicts, SFDC, or Online totals.");
        }
        if (
          change.dac < current.existingDac ||
          change.ecs < current.existingEcs ||
          change.special < current.existingSpecial ||
          change.dac + change.ecs + change.special <=
            current.existingDac + current.existingEcs + current.existingSpecial ||
          change.clearProvisional
        ) {
          throw new Error("Manual review accepts positive additions only and cannot reduce or clear existing values.");
        }
      }

      // Server-side protection guard: never overwrite MANUAL or CORRECTED records
      if (isProtectedSource(current)) {
        throw new Error(
          `Record ${change.agreementId} (row ${change.row}) is protected (${current.dacSource || "CORRECTED"}) and cannot be overwritten by Paid File.`,
        );
      }

      const dacDelta = change.dac - current.existingDac;
      const ecsDelta = change.ecs - current.existingEcs;
      const specialDelta = change.special - current.existingSpecial;
      const netApplied = dacDelta + ecsDelta + specialDelta;
      const validDelta = Math.abs(current.existingTotal + netApplied - change.newTotal) <= 0.01;
      const validMaxTotal =
        Math.abs(
          Math.max(current.existingTotal, current.existingNewTotal) + netApplied - change.newTotal,
        ) <= 0.01;
      const validDirect = Math.abs(current.existingTotal + change.dac - change.newTotal) <= 0.01;
      if (!validDelta && !validMaxTotal && !validDirect)
        throw new Error("Invalid New Total for Agreement ID " + change.agreementId + ".");

      const updates: { range: string; values: (string | number | boolean)[][] }[] = [];
      updates.push({
        range: "'" + file.tab + "'!" + colLetter(cols.newTotal) + change.row,
        values: [[change.newTotal]],
      });
      if (cols.dac >= 0)
        updates.push({
          range: "'" + file.tab + "'!" + colLetter(cols.dac) + change.row,
          values: [[change.dac]],
        });
      if (cols.ecs >= 0 && (change.ecs !== current.existingEcs || change.ecs !== 0))
        updates.push({
          range: "'" + file.tab + "'!" + colLetter(cols.ecs) + change.row,
          values: [[change.ecs]],
        });
      if (cols.special >= 0 && (change.special !== current.existingSpecial || change.special !== 0))
        updates.push({
          range: "'" + file.tab + "'!" + colLetter(cols.special) + change.row,
          values: [[change.special]],
        });
      if (cols.paymentDate >= 0 && change.paymentDate)
        updates.push({
          range: "'" + file.tab + "'!" + colLetter(cols.paymentDate) + change.row,
          values: [[change.paymentDate]],
        });
      if (cols.dacSource >= 0)
        updates.push({
          range: "'" + file.tab + "'!" + colLetter(cols.dacSource) + change.row,
          values: [[data.sourceMode]],
        });
      let remainingDailyCollectionDac = Number(current.dailyCollectionProvisionalDac ?? 0);
      if (data.sourceMode === "PAID_FILE" && cols.dailyCollectionProvisionalDac >= 0) {
        const previouslyCombined = current.existingDac + remainingDailyCollectionDac;
        remainingDailyCollectionDac = Math.max(0, Math.round((previouslyCombined - change.dac + Number.EPSILON) * 100) / 100);
        if (Math.abs(remainingDailyCollectionDac - Number(current.dailyCollectionProvisionalDac ?? 0)) > 0.009) {
          updates.push({
            range: "'" + file.tab + "'!" + colLetter(cols.dailyCollectionProvisionalDac) + change.row,
            values: [[remainingDailyCollectionDac > 0 ? remainingDailyCollectionDac : ""]],
          });
        }
      }
      if (cols.sourceType >= 0) {
        const sources = new Set(
          String(current.sourceType ?? "")
            .split(/[,+|]/)
            .map((value) => value.trim().toUpperCase())
            .filter(Boolean),
        );
        if (data.sourceMode === "MANUAL") sources.add("MANUAL_REVIEW");
        else sources.add("PAID_FILE");
        if (remainingDailyCollectionDac > 0) sources.add("DAILY_COLLECTION");
        else sources.delete("DAILY_COLLECTION");
        updates.push({
          range: "'" + file.tab + "'!" + colLetter(cols.sourceType) + change.row,
          values: [[[...sources].join(", ")]],
        });
      }
      if (change.clearProvisional && cols.provisionalDac >= 0)
        updates.push({
          range: "'" + file.tab + "'!" + colLetter(cols.provisionalDac) + change.row,
          values: [[""]],
        });
      // Manual review must preserve conflict state and must not masquerade as a Paid File upload.
      if (data.sourceMode !== "MANUAL" && cols.isConflict >= 0)
        updates.push({
          range: "'" + file.tab + "'!" + colLetter(cols.isConflict) + change.row,
          values: [[false]],
        });
      if (data.sourceMode !== "MANUAL" && cols.lastPaidUploadAt >= 0)
        updates.push({
          range: "'" + file.tab + "'!" + colLetter(cols.lastPaidUploadAt) + change.row,
          values: [[timestamp]],
        });
      rowRanges.push(updates);
    }

    // Apply conflict flags on protected/provisional mismatch rows without overwriting confirmed values
    for (const conflict of data.conflictFlags) {
      const current = masterByRow.get(conflict.row);
      if (!current || current.agreementId !== normalisePaidId(conflict.agreementId)) {
        throw new Error(
          "Master Sheet changed after preview on conflicted row " + conflict.row + ".",
        );
      }
      const updates: { range: string; values: (string | number | boolean)[][] }[] = [];
      if (cols.isConflict >= 0) {
        updates.push({
          range: "'" + file.tab + "'!" + colLetter(cols.isConflict) + conflict.row,
          values: [[true]],
        });
      }
      if (cols.paidConflictDac >= 0) {
        updates.push({
          range: "'" + file.tab + "'!" + colLetter(cols.paidConflictDac) + conflict.row,
          values: [[conflict.incomingDac]],
        });
      }
      if (cols.lastPaidUploadAt >= 0) {
        updates.push({
          range: "'" + file.tab + "'!" + colLetter(cols.lastPaidUploadAt) + conflict.row,
          values: [[timestamp]],
        });
      }
      if (updates.length > 0) rowRanges.push(updates);
    }

    const chunks: { range: string; values: (string | number | boolean)[][] }[][] = [];
    for (let i = 0; i < rowRanges.length; i += 300) chunks.push(rowRanges.slice(i, i + 300).flat());

    const chainHash = computeAuditChainHash({
      previousHash,
      fingerprint,
      timestamp,
      adminName: admin.name,
      fileName: data.fileName,
      recordsApplied: data.changes.length,
      conflictsFlagged: data.conflictFlags.length,
    });

    // Reserve the fingerprint before the first write.
    const appendResult = await checked<{ updates?: { updatedRange?: string } }>(
      sheetsUrl(
        file.id,
        "/values/" +
          encodeURIComponent("'Paid_File_Audit_Log'!A:O") +
          ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
      ),
      "GOOGLE_SHEETS_API_KEY",
      {
        method: "POST",
        body: JSON.stringify({
          values: [
            [
              timestamp,
              admin.name,
              data.fileName,
              data.changes.length,
              data.totalDac,
              data.totalSfdc,
              data.totalOnline,
              fingerprint,
              "APPLYING",
              0,
              data.conflictFlags.length,
              data.protectedSkips,
              data.unmatchedSkipped,
              previousHash,
              chainHash,
            ],
          ],
        }),
      },
    );

    const auditRow = Number(appendResult.updates?.updatedRange?.match(/![A-Z]+(\d+):?/i)?.[1]);
    if (!Number.isInteger(auditRow) || auditRow < 2) {
      throw new Error(
        "Audit reservation was written but its row could not be confirmed. Check Paid_File_Audit_Log before retrying.",
      );
    }

    let completedBatches = 0;
    for (let i = 0; i < chunks.length; i++) {
      await retryFetch(sheetsUrl(file.id, "/values:batchUpdate"), {
        method: "POST",
        headers: authHeaders("GOOGLE_SHEETS_API_KEY"),
        body: JSON.stringify({ valueInputOption: "RAW", data: chunks[i]! }),
      });
      completedBatches++;
      await checked(
        sheetsUrl(
          file.id,
          "/values/" +
            encodeURIComponent("'Paid_File_Audit_Log'!J" + auditRow) +
            "?valueInputOption=RAW",
        ),
        "GOOGLE_SHEETS_API_KEY",
        { method: "PUT", body: JSON.stringify({ values: [[completedBatches]] }) },
      );
    }

    if (data.conflictFlags.length > 0) {
      await ensureConflictsTab(file.id);
      const conflictRows = data.conflictFlags.map((c) => [
        timestamp,
        admin.name,
        data.fileName,
        c.agreementId,
        c.row,
        c.source || "PROVISIONAL",
        c.existingDac,
        c.incomingDac,
        c.incomingEcs,
        c.incomingSpecial,
        c.reason,
        fingerprint,
      ]);
      await checked(
        sheetsUrl(
          file.id,
          "/values/" +
            encodeURIComponent("'Paid_File_Conflicts'!A:L") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
        ),
        "GOOGLE_SHEETS_API_KEY",
        { method: "POST", body: JSON.stringify({ values: conflictRows }) },
      );
    }

    await checked(
      sheetsUrl(
        file.id,
        "/values/" +
          encodeURIComponent("'Paid_File_Audit_Log'!I" + auditRow) +
          "?valueInputOption=RAW",
      ),
      "GOOGLE_SHEETS_API_KEY",
      { method: "PUT", body: JSON.stringify({ values: [["COMPLETE"]] }) },
    );

    return {
      ok: true as const,
      applied: data.changes.length,
      conflictsLogged: data.conflictFlags.length,
      batches: chunks.length,
      fingerprint,
      chainHash,
      spreadsheetName: file.name,
    };
  });


type DailyCollectionPlanRow = {
  row: number;
  agreementId: string;
  bankDac: number;
  dailyCollectionDac: number;
  difference: number;
  provisionalDac: number;
  transactionCount: number;
  status: "READY" | "REVIEW";
  reason: string;
  sourceType: string;
};

function dailyCollectionDate(value: unknown): string {
  const parsed = parsePaidDate(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(parsed) ? parsed : "";
}

function dailyCollectionTime(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw || /no\s*time|not\s*available/i.test(raw)) return "";
  const match = raw.match(/(?:^|T|\s)(\d{1,2}:\d{2})(?::(\d{2}))?/);
  if (!match) return "";
  return match[1]!.padStart(5, "0") + ":" + (match[2] ?? "00");
}

function hasVerifiedOrCorrectedMarker(validation: unknown, remark: unknown, adminRemark: unknown) {
  const marker = String(validation ?? "").trim().toUpperCase();
  if (marker.startsWith("VALID")) return true;
  const text = [remark, adminRemark].map((value) => String(value ?? "")).join(" ");
  if (/\b(?:not\s+verified|unverified|incorrect|rejected)\b/i.test(text)) return false;
  return /\b(?:verified|corrected)\b/i.test(text);
}

function buildDailyCollectionPlan(master: Awaited<ReturnType<typeof readMaster>>, collectionRows: string[][]) {
  const masterById = new Map<string, MasterRow[]>();
  for (const row of master.data) {
    const key = normalisePaidId(row.agreementId);
    if (!key) continue;
    const list = masterById.get(key) ?? [];
    list.push(row);
    masterById.set(key, list);
  }

  const candidates = collectionRows.map((row, index) => {
    const sheetRow = index + 2;
    const agreementId = normalisePaidId(row[1]);
    const amount = numeric(row[2]);
    const status = String(row[6] ?? "").trim().toUpperCase();
    const entryType = String(row[8] ?? "").trim().toUpperCase();
    const remark = String(row[16] ?? "");
    const adminRemark = String(row[18] ?? "");
    const validation = String(row[21] ?? "");
    const bbpsEvents = [...remark.matchAll(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/g)].map((match) => ({
      date: match[1] ?? "",
      time: match[2] ?? "",
    }));
    const date = bbpsEvents.length === 1
      ? dailyCollectionDate(bbpsEvents[0]!.date)
      : dailyCollectionDate(row[24] || row[3]);
    const time = bbpsEvents.length === 1
      ? dailyCollectionTime(bbpsEvents[0]!.time)
      : dailyCollectionTime(row[25] || row[4]);
    const reasons: string[] = [];

    if (status !== "CONFIRMED") return null;
    if (entryType === "PREVIOUS PAID FILE") return null;
    if (!agreementId) reasons.push("Loan / Agreement ID missing");
    if (!(amount > 0)) reasons.push("Amount is not a positive number");
    if (!hasVerifiedOrCorrectedMarker(validation, remark, adminRemark))
      reasons.push("Entry is not marked Verified / Corrected");
    if (bbpsEvents.length > 1) reasons.push("Multiple BBPS transaction timestamps in one remark");
    if (!date || !time) reasons.push("Transaction date or time missing");
    const masterMatches = masterById.get(agreementId) ?? [];
    if (masterMatches.length === 0) reasons.push("Agreement ID not found in Master Allocation");
    if (masterMatches.length > 1) reasons.push("Agreement ID matches multiple Master rows");
    if (masterMatches.length === 1 && masterMatches[0]!.isConflict) reasons.push("Master row has an unresolved Paid File conflict");
    return {
      row: sheetRow,
      agreementId,
      amount,
      date,
      time,
      reasons,
      masterRow: masterMatches.length === 1 ? masterMatches[0] : undefined,
      duplicateKey: agreementId && amount > 0 && date && time
        ? [agreementId, amount.toFixed(2), date, time].join("|")
        : "",
    };
  }).filter((row): row is NonNullable<typeof row> => row !== null);

  const duplicateOwners = new Map<string, number[]>();
  for (const item of candidates) {
    if (!item.duplicateKey) continue;
    const owners = duplicateOwners.get(item.duplicateKey) ?? [];
    owners.push(item.row);
    duplicateOwners.set(item.duplicateKey, owners);
  }

  const eligibleById = new Map<string, { amount: number; transactions: number; master: MasterRow }>();
  const review: DailyCollectionPlanRow[] = [];
  for (const item of candidates) {
    const reasons = [...item.reasons];
    if (item.duplicateKey && (duplicateOwners.get(item.duplicateKey)?.length ?? 0) > 1)
      reasons.push("Duplicate Loan ID + Amount + BBPS date/time");
    if (reasons.length || !item.masterRow) {
      const bankDac = item.masterRow?.existingDac ?? 0;
      review.push({
        row: item.row,
        agreementId: item.agreementId,
        bankDac,
        dailyCollectionDac: item.amount,
        difference: item.amount - bankDac,
        provisionalDac: 0,
        transactionCount: 1,
        status: "REVIEW",
        reason: [...new Set(reasons)].join("; ") || "Needs Admin review",
        sourceType: "DAILY_COLLECTION",
      });
      continue;
    }
    const existing = eligibleById.get(item.agreementId);
    if (existing) {
      existing.amount = Math.round((existing.amount + item.amount + Number.EPSILON) * 100) / 100;
      existing.transactions += 1;
    } else {
      eligibleById.set(item.agreementId, {
        amount: item.amount,
        transactions: 1,
        master: item.masterRow,
      });
    }
  }

  const reviewedIds = new Set(review.map((row) => row.agreementId).filter(Boolean));
  const ready = [...eligibleById.entries()].filter(([agreementId]) => !reviewedIds.has(agreementId)).map(([agreementId, item]) => ({
    row: item.master.row,
    agreementId,
    bankDac: item.master.existingDac,
    dailyCollectionDac: Math.round((item.amount + Number.EPSILON) * 100) / 100,
    difference: Math.round((item.amount - item.master.existingDac + Number.EPSILON) * 100) / 100,
    provisionalDac: Math.max(0, Math.round((item.amount - item.master.existingDac + Number.EPSILON) * 100) / 100),
    transactionCount: item.transactions,
    status: "READY" as const,
    reason: item.master.isCorrected ? "Verified / Corrected collection; bank DAC remains unchanged" : "Verified collection; bank DAC remains unchanged",
    sourceType: "DAILY_COLLECTION",
  }));

  return {
    ready,
    review,
    ambiguousIds: new Set(
      [...masterById.entries()].filter(([, rows]) => rows.length > 1).map(([id]) => id),
    ),
    reviewedIds,
    amountById: new Map(ready.map((row) => [row.agreementId, row.provisionalDac])),
  };
}

const DAILY_COLLECTION_AUDIT_TAB = "Daily_Collection_Sync_Audit";
const DAILY_COLLECTION_AUDIT_HEADERS = [
  "Timestamp (IST)",
  "Admin",
  "Fingerprint",
  "Verified Transactions",
  "Master Rows Updated",
  "Provisional DAC Applied (₹)",
  "Review Rows",
  "Cleared Provisional Rows",
  "Status",
];

async function ensureDailyCollectionAuditTab(id: string) {
  const meta = await checked<{ sheets?: { properties?: { title?: string } }[] }>(
    sheetsUrl(id, "?fields=sheets.properties"),
    "GOOGLE_SHEETS_API_KEY",
  );
  if (!(meta.sheets ?? []).some((sheet) => sheet.properties?.title === DAILY_COLLECTION_AUDIT_TAB)) {
    await checked(sheetsUrl(id, ":batchUpdate"), "GOOGLE_SHEETS_API_KEY", {
      method: "POST",
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: DAILY_COLLECTION_AUDIT_TAB } } }],
      }),
    });
  }
  await checked(
    sheetsUrl(
      id,
      "/values/" + encodeURIComponent("'" + DAILY_COLLECTION_AUDIT_TAB + "'!A1:I1") + "?valueInputOption=RAW",
    ),
    "GOOGLE_SHEETS_API_KEY",
    { method: "PUT", body: JSON.stringify({ values: [DAILY_COLLECTION_AUDIT_HEADERS] }) },
  );
}

export const getDailyCollectionDacComparison = createServerFn({ method: "GET" }).handler(async () => {
  await requireSession("Admin");
  const [master, collectionRows] = await Promise.all([
    readMaster("monthly-master"),
    (async () => {
      const { sheetsGetFresh } = await import("./mahavtaar.server");
      return sheetsGetFresh("Collections!A2:AA");
    })(),
  ]);
  const plan = buildDailyCollectionPlan(master, collectionRows);
  const currentDailyTotal = master.data.reduce(
    (sum, row) => sum + Number(row.dailyCollectionProvisionalDac ?? 0),
    0,
  );
  return {
    masterName: master.file.name,
    masterUrl: master.file.url,
    readyCount: plan.ready.length,
    readyTransactions: plan.ready.reduce((sum, row) => sum + row.transactionCount, 0),
    reviewCount: plan.review.length,
    readyAmount: plan.ready.reduce((sum, row) => sum + row.dailyCollectionDac, 0),
    currentDailyTotal,
    rows: [...plan.ready, ...plan.review]
      .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))
      .slice(0, 200),
    lastSync: null as string | null,
  };
});

export const syncVerifiedDailyCollectionDac = createServerFn({ method: "POST" }).handler(async () => {
  const admin = await requireSession("Admin");
  let master = await readMaster("monthly-master");
  master = await ensureDailyCollectionMetadataColumns(master);
  const { sheetsGetFresh, invalidateSheetsCache } = await import("./mahavtaar.server");
  const collectionRows = await sheetsGetFresh("Collections!A2:AA");
  const plan = buildDailyCollectionPlan(master, collectionRows);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      ready: plan.ready.map((row) => [row.row, row.agreementId, row.dailyCollectionDac, row.provisionalDac, row.transactionCount]),
      review: plan.review.map((row) => [row.row, row.agreementId, row.reason]),
      existing: master.data.map((row) => [row.row, row.dailyCollectionProvisionalDac ?? 0]),
    }))
    .digest("hex");

  await ensureDailyCollectionAuditTab(master.file.id);
  const auditRows = await values(master.file.id, "'" + DAILY_COLLECTION_AUDIT_TAB + "'!A2:I");
  const previous = auditRows.find((row) => String(row[2] ?? "") === fingerprint && String(row[8] ?? "") === "COMPLETE");
  if (previous) {
    return {
      ok: true as const,
      alreadySynced: true as const,
      updatedRows: 0,
      readyCount: plan.ready.length,
      reviewCount: plan.review.length,
      totalDailyCollectionDac: plan.ready.reduce((sum, row) => sum + row.dailyCollectionDac, 0),
    provisionalDacToApply: plan.ready.reduce((sum, row) => sum + row.provisionalDac, 0),
    };
  }

  const timestamp = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date());
  const amountById = plan.amountById;
  const updates: { range: string; values: (string | number | boolean)[][] }[] = [];
  let clearedRows = 0;
  for (const row of master.data) {
    const agreementId = normalisePaidId(row.agreementId);
    if (!agreementId || plan.ambiguousIds.has(agreementId) || plan.reviewedIds.has(agreementId)) continue;
    const target = amountById.get(agreementId) ?? 0;
    const current = Number(row.dailyCollectionProvisionalDac ?? 0);
    const nextValue = target > 0 ? target : "";
    if (Math.abs(current - target) > 0.009) {
      updates.push({
        range: "'" + master.file.tab + "'!" + columnLetter(master.cols.dailyCollectionProvisionalDac) + row.row,
        values: [[nextValue]],
      });
      if (target === 0 && current > 0) clearedRows++;
    }
    const sources = new Set(
      String(row.sourceType ?? "")
        .split(/[,+|]/)
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean),
    );
    sources.delete("DAILY_COLLECTION");
    if (target > 0) sources.add("DAILY_COLLECTION");
    if (row.dacSource === "PAID_FILE") sources.add("PAID_FILE");
    if (row.dacSource === "MANUAL" || row.dacSource === "CORRECTED") sources.add("MANUAL_REVIEW");
    const sourceValue = [...sources].join(", ");
    if (master.cols.sourceType >= 0 && sourceValue !== String(row.sourceType ?? "")) {
      updates.push({
        range: "'" + master.file.tab + "'!" + columnLetter(master.cols.sourceType) + row.row,
        values: [[sourceValue]],
      });
    }
  }

  const updatedMasterRows = new Set(updates.map((update) => Number(update.range.match(/!([A-Z]+)(\\d+)$/)?.[2])).filter(Number.isFinite)).size;
  const auditAppend = await checked<{ updates?: { updatedRange?: string } }>(
    sheetsUrl(
      master.file.id,
      "/values/" + encodeURIComponent("'" + DAILY_COLLECTION_AUDIT_TAB + "'!A:I") +
        ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
    ),
    "GOOGLE_SHEETS_API_KEY",
    {
      method: "POST",
      body: JSON.stringify({
        values: [[
          timestamp,
          admin.name,
          fingerprint,
          plan.ready.reduce((sum, row) => sum + row.transactionCount, 0),
          updatedMasterRows,
          plan.ready.reduce((sum, row) => sum + row.provisionalDac, 0),
          plan.review.length,
          clearedRows,
          "APPLYING",
        ]],
      }),
    },
  );
  const auditRow = Number(auditAppend.updates?.updatedRange?.match(/![A-Z]+(\d+):?/i)?.[1]);
  if (!Number.isInteger(auditRow) || auditRow < 2)
    throw new Error("Daily Collection sync audit was reserved but its row could not be confirmed.");

  try {
    const chunks: typeof updates[] = [];
    for (let i = 0; i < updates.length; i += 300) chunks.push(updates.slice(i, i + 300));
    for (const chunk of chunks) {
      await retryFetch(sheetsUrl(master.file.id, "/values:batchUpdate"), {
        method: "POST",
        headers: authHeaders("GOOGLE_SHEETS_API_KEY"),
        body: JSON.stringify({ valueInputOption: "RAW", data: chunk }),
      });
    }
    await checked(
      sheetsUrl(
        master.file.id,
        "/values/" + encodeURIComponent("'" + DAILY_COLLECTION_AUDIT_TAB + "'!I" + auditRow) + "?valueInputOption=RAW",
      ),
      "GOOGLE_SHEETS_API_KEY",
      { method: "PUT", body: JSON.stringify({ values: [["COMPLETE"]] }) },
    );
  } catch (error) {
    await checked(
      sheetsUrl(
        master.file.id,
        "/values/" + encodeURIComponent("'" + DAILY_COLLECTION_AUDIT_TAB + "'!I" + auditRow) + "?valueInputOption=RAW",
      ),
      "GOOGLE_SHEETS_API_KEY",
      { method: "PUT", body: JSON.stringify({ values: [["FAILED - CHECK MASTER BEFORE RETRY"]] }) },
    ).catch(() => undefined);
    throw error;
  }
  invalidateSheetsCache();
  return {
    ok: true as const,
    alreadySynced: false as const,
    updatedRows: updatedMasterRows,
    readyCount: plan.ready.length,
    reviewCount: plan.review.length,
    totalDailyCollectionDac: plan.ready.reduce((sum, row) => sum + row.dailyCollectionDac, 0),
    provisionalDacToApply: plan.ready.reduce((sum, row) => sum + row.provisionalDac, 0),
    clearedRows,
  };
});
