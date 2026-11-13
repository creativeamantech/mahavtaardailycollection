import { createServerFn } from "@tanstack/react-start";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireSession } from "./auth.functions";
import {
  isProtectedSource,
  normalisePaidId,
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
      isConflict: cols.isConflict >= 0 ? parseBool(cell(cols.isConflict)) : false,
      paidConflictDac:
        cols.paidConflictDac >= 0 ? optionalNumeric(cell(cols.paidConflictDac)) : null,
    });
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

    return {
      found: true as const,
      spreadsheetName: file.name,
      entries: entries.reverse().slice(0, 25),
      chainValid,
      verifiedCount,
      brokenAtRow,
    };
  } catch {
    return {
      found: false as const,
      spreadsheetName: "",
      entries: [] as PaidFileAuditEntry[],
      chainValid: true,
      verifiedCount: 0,
      brokenAtRow: null as number | null,
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
    const master = await readMaster(data.target);
    const { file, cols } = master;

    const calculatedDac = data.changes.reduce((sum, change) => sum + change.dac, 0);
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
      if (change.clearProvisional && cols.provisionalDac >= 0)
        updates.push({
          range: "'" + file.tab + "'!" + colLetter(cols.provisionalDac) + change.row,
          values: [[""]],
        });
      if (cols.isConflict >= 0)
        updates.push({
          range: "'" + file.tab + "'!" + colLetter(cols.isConflict) + change.row,
          values: [[false]],
        });
      if (cols.lastPaidUploadAt >= 0)
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
