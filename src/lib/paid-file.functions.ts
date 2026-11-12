import { createServerFn } from "@tanstack/react-start";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireSession } from "./auth.functions";
import { SPREADSHEET_ID } from "./mahavtaar.server";

const GATEWAY = "https://connector-gateway.lovable.dev";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
type Target = "monthly-master" | "daily-collections";
type DriveFile = { id: string; name: string; webViewLink?: string };
type MasterRow = { row: number; agreementId: string; existingTotal: number; existingDac: number; bucket: string; city: string; customer?: string; executive?: string };
const changeSchema = z.object({
  row: z.number().int().positive(),
  agreementId: z.string().min(1).max(100),
  dac: z.number().finite(),
  newTotal: z.number().finite(),
  ecs: z.number().finite().optional().default(0),
  special: z.number().finite().optional().default(0),
});
const applySchema = z.object({
  target: z.enum(["monthly-master", "daily-collections"]),
  fileName: z.string().trim().min(1).max(240),
  fileDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalDac: z.number().finite(),
  totalSfdc: z.number().finite(),
  totalOnline: z.number().finite(),
  changes: z.array(changeSchema).min(1).max(20000),
});
function authHeaders(key: string) {
  const token = process.env["LOVABLE_API_KEY"], connection = process.env[key];
  if (!token || !connection) throw new Error("Google Drive/Sheets connector is not configured.");
  return { Authorization: "Bearer " + token, "X-Connection-Api-Key": connection, "Content-Type": "application/json" };
}
async function checked<T>(url: string, key: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...authHeaders(key), ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error("Google connector request failed (" + res.status + "): " + (await res.text()).slice(0, 300));
  return res.json() as Promise<T>;
}
const sheetsUrl = (id: string, suffix = "") => GATEWAY + "/google_sheets/v4/spreadsheets/" + encodeURIComponent(id) + suffix;
function monthTitle() {
  return "Mahavtaar Master Allocation " + new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", month: "long", year: "numeric" }).format(new Date());
}
async function findMonthlyMaster(): Promise<DriveFile> {
  const url = new URL(GATEWAY + "/google_drive/drive/v3/files");
  url.searchParams.set("q", "name = '" + monthTitle().replace(/'/g, "\\'") + "' and mimeType = '" + SHEET_MIME + "' and trashed = false");
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("fields", "files(id,name,webViewLink)");
  const result = await checked<{ files?: DriveFile[] }>(url.toString(), "GOOGLE_DRIVE_API_KEY");
  if ((result.files ?? []).length !== 1) throw new Error("Expected exactly one current-month Master Allocation file. Found " + (result.files ?? []).length + ".");
  return result.files![0]!;
}
async function resolveTarget(target: Target) {
  if (target === "daily-collections") return { id: SPREADSHEET_ID, name: "Main Daily Collection", tab: "Collections", url: "https://docs.google.com/spreadsheets/d/" + SPREADSHEET_ID };
  const file = await findMonthlyMaster();
  return { id: file.id, name: file.name, tab: "Master Allocation Data", url: file.webViewLink ?? "https://docs.google.com/spreadsheets/d/" + file.id };
}
async function values(id: string, range: string): Promise<string[][]> {
  const result = await checked<{ values?: string[][] }>(sheetsUrl(id, "/values/" + encodeURIComponent(range)), "GOOGLE_SHEETS_API_KEY");
  return result.values ?? [];
}
function normHeader(value: unknown) { return String(value ?? "").toUpperCase().replace(/[ _-]+/g, " ").trim(); }
function findCol(headers: string[], aliases: string[]) {
  const set = new Set(aliases.map(normHeader));
  return headers.findIndex(h => set.has(normHeader(h)));
}
function numeric(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const n = Number(raw.replace(/[₹,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(n) ? n : 0;
}
function normaliseId(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/^['"\x60‘’]+|['"\x60‘’]+$/g, "").replace(/\s+/g, "").toUpperCase();
}
function columnLetter(index: number) {
  let result = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
  return result;
}
async function readMaster(target: Target) {
  const file = await resolveTarget(target);
  const headerRows = await values(file.id, "'" + file.tab + "'!A1:ZZ1");
  if (!headerRows.length) throw new Error("The target sheet has no header row.");
  const headers = headerRows[0] ?? [];
  const cols = {
    agreement: findCol(headers, ["Agreement ID", "AgreementID", "Agreement_Id", "Loan No", "Loan Number", "Account No"]),
    total: findCol(headers, ["Existing Total", "Total", "Total Amount", "Paid Total"]),
    dac: findCol(headers, ["DAC", "DAC Amount", "Collection DAC"]),
    bucket: findCol(headers, ["Bucket"]), city: findCol(headers, ["City"]),
    customer: findCol(headers, ["Customer", "Customer Name", "Borrower Name"]),
    executive: findCol(headers, ["Executive", "Executive Name", "Allocated To"]),
    newTotal: findCol(headers, ["New Total"]), ecs: findCol(headers, ["ECS Amount", "ECS"]),
    special: findCol(headers, ["Special Amount", "Special"]),
  };
  if (cols.agreement < 0 || cols.total < 0 || cols.newTotal < 0 || cols.dac < 0) throw new Error("Required columns missing. Agreement ID, Total, DAC and New Total must exist in " + file.tab + ".");
  const selected = [...new Set([cols.agreement, cols.total, cols.dac, cols.bucket, cols.city, cols.customer, cols.executive].filter(i => i >= 0))];
  const columns = await Promise.all(selected.map(async index => ({ index, rows: await values(file.id, "'" + file.tab + "'!" + columnLetter(index) + "2:" + columnLetter(index)) })));
  const byColumn = new Map(columns.map(c => [c.index, c.rows]));
  const rowCount = Math.max(0, ...columns.map(c => c.rows.length));
  const data: MasterRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    const cell = (index: number) => byColumn.get(index)?.[i]?.[0] ?? "";
    const agreementId = normaliseId(cell(cols.agreement));
    if (!agreementId) continue;
    data.push({ row: i + 2, agreementId, existingTotal: numeric(cell(cols.total)), existingDac: cols.dac >= 0 ? numeric(cell(cols.dac)) : 0, bucket: String(cell(cols.bucket) ?? ""), city: String(cell(cols.city) ?? ""), customer: cols.customer >= 0 ? String(cell(cols.customer) ?? "") : "", executive: cols.executive >= 0 ? String(cell(cols.executive) ?? "") : "" });
  }
  return { file, cols, data };
}
export const fetchMasterMatchingData = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) => z.object({ target: z.enum(["monthly-master", "daily-collections"]) }).parse(v))
  .handler(async ({ data }) => {
    await requireSession("Admin");
    const master = await readMaster(data.target);
    return { target: data.target, spreadsheetName: master.file.name, spreadsheetUrl: master.file.url, tab: master.file.tab, rows: master.data };
  });

async function ensureAuditTab(id: string) {
  const meta = await checked<{ sheets?: { properties?: { title?: string } }[] }>(sheetsUrl(id, "?fields=sheets.properties"), "GOOGLE_SHEETS_API_KEY");
  if (!(meta.sheets ?? []).some(s => s.properties?.title === "Paid_File_Audit_Log")) {
    await checked(sheetsUrl(id, ":batchUpdate"), "GOOGLE_SHEETS_API_KEY", { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: "Paid_File_Audit_Log" } } }] }) });
  }
  const headers = ["Timestamp (IST)", "Admin Name", "File Name", "Records Applied", "Total DAC (₹)", "Total SFDC (₹)", "Total Online (₹)", "Batch Fingerprint", "Apply Status", "Completed Batches"];
  await checked(sheetsUrl(id, "/values/" + encodeURIComponent("'Paid_File_Audit_Log'!A1:J1") + "?valueInputOption=RAW"), "GOOGLE_SHEETS_API_KEY", { method: "PUT", body: JSON.stringify({ values: [headers] }) });
}
async function retryFetch(url: string, init: RequestInit) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
      continue;
    }
    if (response.ok) return;
    const body = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 3) throw new Error("Google Sheets batch update failed (" + response.status + "): " + body.slice(0, 300));
    await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
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
    if (Math.abs(calculatedDac - data.totalDac) > 0.01) throw new Error("Submitted DAC total does not match the validated change set.");
    // Fingerprint the normalized change set, not the filename/date alone. This prevents
    // renamed copies and same-name files with different contents from sharing an identity.
    const canonicalChanges = [...data.changes]
      .map(change => ({
        row: change.row,
        agreementId: normaliseId(change.agreementId),
        dac: Number(change.dac.toFixed(2)),
        newTotal: Number(change.newTotal.toFixed(2)),
        ecs: Number(change.ecs.toFixed(2)),
        special: Number(change.special.toFixed(2)),
      }))
      .sort((a, b) => a.row - b.row || a.agreementId.localeCompare(b.agreementId));
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ target: data.target, changes: canonicalChanges }))
      .digest("hex");
    await ensureAuditTab(file.id);
    const auditRows = await values(file.id, "'Paid_File_Audit_Log'!A:J");
    const duplicate = auditRows.slice(1).find(r => String(r[7] ?? "") === fingerprint);
    if (duplicate) {
      const status = String(duplicate[8] ?? "LEGACY");
      throw new Error("This exact Paid File change set already has an audit entry (status: " + status + "). Do not reapply it. Check the audit log before retrying.");
    }
    const masterByRow = new Map(master.data.map(r => [r.row, r]));
    const seen = new Set<number>();
    const rowRanges: { range: string; values: (string | number)[][] }[][] = [];
    const colLetter = (n: number) => { let s = ""; for (let x = n + 1; x; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + (x - 1) % 26) + s; return s; };
    for (const change of data.changes) {
      if (seen.has(change.row)) throw new Error("Duplicate target row in submitted change set: " + change.row);
      seen.add(change.row);
      if (change.ecs !== 0 && cols.ecs < 0) throw new Error("ECS Amount column is missing from " + file.tab + ".");
      if (change.special !== 0 && cols.special < 0) throw new Error("Special Amount column is missing from " + file.tab + ".");
      const current = masterByRow.get(change.row);
      if (!current || current.agreementId !== normaliseId(change.agreementId)) throw new Error("Master Sheet changed after preview. Refresh and reconcile again (row " + change.row + ").");
      if (Math.abs((current.existingTotal + change.dac) - change.newTotal) > 0.01) throw new Error("Invalid New Total for Agreement ID " + change.agreementId + ".");
      const updates: { range: string; values: (string | number)[][] }[] = [];
      updates.push({ range: "'" + file.tab + "'!" + colLetter(cols.newTotal) + change.row, values: [[change.newTotal]] });
      if (cols.dac >= 0) updates.push({ range: "'" + file.tab + "'!" + colLetter(cols.dac) + change.row, values: [[change.dac]] });
      if (change.ecs && cols.ecs >= 0) updates.push({ range: "'" + file.tab + "'!" + colLetter(cols.ecs) + change.row, values: [[change.ecs]] });
      if (change.special && cols.special >= 0) updates.push({ range: "'" + file.tab + "'!" + colLetter(cols.special) + change.row, values: [[change.special]] });
      rowRanges.push(updates);
    }
    const chunks: { range: string; values: (string | number)[][] }[][] = [];
    for (let i = 0; i < rowRanges.length; i += 300) chunks.push(rowRanges.slice(i, i + 300).flat());
    const timestamp = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "medium" }).format(new Date());
    // Reserve the fingerprint before the first write. If a later batch fails, the
    // APPLYING row remains as a recovery warning and blocks an unsafe blind replay.
    const appendResult = await checked<{ updates?: { updatedRange?: string } }>(
      sheetsUrl(file.id, "/values/" + encodeURIComponent("'Paid_File_Audit_Log'!A:J") + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS"),
      "GOOGLE_SHEETS_API_KEY",
      { method: "POST", body: JSON.stringify({ values: [[timestamp, admin.name, data.fileName, data.changes.length, data.totalDac, data.totalSfdc, data.totalOnline, fingerprint, "APPLYING", 0]] }) },
    );
    const auditRow = Number(appendResult.updates?.updatedRange?.match(/![A-Z]+(\d+):?/i)?.[1]);
    if (!Number.isInteger(auditRow) || auditRow < 2) {
      throw new Error("Audit reservation was written but its row could not be confirmed. Check Paid_File_Audit_Log before retrying.");
    }
    let completedBatches = 0;
    for (let i = 0; i < chunks.length; i++) {
      await retryFetch(sheetsUrl(file.id, "/values:batchUpdate"), { method: "POST", headers: authHeaders("GOOGLE_SHEETS_API_KEY"), body: JSON.stringify({ valueInputOption: "RAW", data: chunks[i]! }) });
      completedBatches++;
      await checked(
        sheetsUrl(file.id, "/values/" + encodeURIComponent("'Paid_File_Audit_Log'!J" + auditRow) + "?valueInputOption=RAW"),
        "GOOGLE_SHEETS_API_KEY",
        { method: "PUT", body: JSON.stringify({ values: [[completedBatches]] }) },
      );
    }
    await checked(
      sheetsUrl(file.id, "/values/" + encodeURIComponent("'Paid_File_Audit_Log'!I" + auditRow) + "?valueInputOption=RAW"),
      "GOOGLE_SHEETS_API_KEY",
      { method: "PUT", body: JSON.stringify({ values: [["COMPLETE"]] }) },
    );
    return { ok: true as const, applied: data.changes.length, batches: chunks.length, fingerprint, spreadsheetName: file.name };
  });
