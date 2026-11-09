import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSession } from "./auth.functions";
import { SPREADSHEET_ID, DRIVE_FOLDER_ID } from "./mahavtaar.server";

const GATEWAY = "https://connector-gateway.lovable.dev";
const SETTINGS_TAB = "AppSettings";
const MASTER_KEY = "paidFileMasterSpreadsheetId";
const XLSB_MIME = "application/vnd.ms-excel.sheet.binary.macroEnabled.12";
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";

function connectorHeaders(key: string) {
  const lovable = process.env["LOVABLE_API_KEY"];
  const connection = process.env[key];
  if (!lovable || !connection) throw new Error(`Missing connector configuration: ${key}`);
  return { Authorization: `Bearer ${lovable}`, "X-Connection-Api-Key": connection };
}
async function checkedJson<T = Record<string, unknown>>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${label} failed (${response.status}): ${message.slice(0, 500)}`);
  }
  return response.json() as Promise<T>;
}
function columnName(index: number) {
  let n = index + 1, out = "";
  while (n) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}
function normalise(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[ _-]+/g, "").replace(/[^a-z0-9]/g, "");
}
function findHeader(headers: string[], aliases: string[]) {
  const wanted = new Set(aliases.map(normalise));
  return headers.findIndex((h) => wanted.has(normalise(h)));
}
function asNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const clean = String(value ?? "").replace(/[₹,\\s]/g, "").replace(/^\\((.*)\\)$/, "-$1");
  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
}
function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const clean = String(value).replace(/[₹,\\s]/g, "").replace(/^\\((.*)\\)$/, "-$1");
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}
async function getMasterId() {
  const response = await fetch(`${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}/values/${SETTINGS_TAB}!A2:B`, { headers: connectorHeaders("GOOGLE_SHEETS_API_KEY") });
  if (!response.ok) throw new Error("Could not read app settings. Check Google Sheets connector.");
  const json = await response.json() as { values?: string[][] };
  return (json.values ?? []).find((r) => (r[0] ?? "").trim() === MASTER_KEY)?.[1]?.trim() ?? "";
}
async function saveMasterId(id: string) {
  const headers = connectorHeaders("GOOGLE_SHEETS_API_KEY");
  const meta = await checkedJson<{ sheets?: Array<{ properties?: { title?: string } }> }>(await fetch(`${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`, { headers }), "App settings metadata");
  const exists = (meta["sheets"] ?? []).some((sheet) => sheet.properties?.title === SETTINGS_TAB);
  if (!exists) throw new Error("AppSettings tab is missing; cannot save master selection.");
  const response = await fetch(`${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}/values/${SETTINGS_TAB}!A2:B?majorDimension=ROWS`, { headers });
  const data = await checkedJson(response, "App settings read") as { values?: string[][] };
  const rows = data.values ?? [];
  const index = rows.findIndex((r) => (r[0] ?? "").trim() === MASTER_KEY);
  const rowNumber = index >= 0 ? index + 2 : rows.length + 2;
  const range = index >= 0 ? `${SETTINGS_TAB}!B${rowNumber}` : `${SETTINGS_TAB}!A${rowNumber}:B${rowNumber}`;
  const values = index >= 0 ? [[id]] : [[MASTER_KEY, id]];
  await checkedJson(await fetch(`${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueInputOption=RAW`, { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ values }) }), "Save master allocation");
}
async function readValues(spreadsheetId: string, range: string) {
  const response = await fetch(`${GATEWAY}/google_sheets/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`, { headers: connectorHeaders("GOOGLE_SHEETS_API_KEY") });
  const json = await checkedJson(response, "Spreadsheet read") as { values?: string[][] };
  return json.values ?? [];
}
async function getDriveFile(fileId: string): Promise<{ id: string; name?: string; mimeType?: string; trashed?: boolean; webViewLink?: string }> {
  const response = await fetch(`${GATEWAY}/google_drive/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,trashed,webViewLink`, { headers: connectorHeaders("GOOGLE_DRIVE_API_KEY") });
  return checkedJson<{ id: string; name?: string; mimeType?: string; trashed?: boolean; webViewLink?: string }>(response, "Drive file metadata");
}
async function buildPreview(masterId: string, convertedId: string) {
  const [masterRows, paidRows] = await Promise.all([
    readValues(masterId, "Data!A1:GY"),
    readValues(convertedId, "A1:AZ"),
  ]);
  if (masterRows.length < 2) throw new Error("Selected master allocation Data tab is empty.");
  if (paidRows.length < 2) throw new Error("Converted Paid File has no data rows.");
  const masterHeaders = masterRows[0] ?? [];
  const paidHeaders = paidRows[0] ?? [];
  const mAgreement = findHeader(masterHeaders, ["agreementid", "agreement id", "loan number", "loan no"]);
  const pAgreement = findHeader(paidHeaders, ["agreementid", "agreement id", "loan number", "loan no"]);
  if (mAgreement < 0 || pAgreement < 0) throw new Error("Agreement ID column was not found in both Data and Paid File tabs.");
  const col = (aliases: string[]) => findHeader(masterHeaders, aliases);
  const pcol = (aliases: string[]) => findHeader(paidHeaders, aliases);
  const mDate = col(["Date", "Payment Date"]), mDac = col(["DAC"]), mEcs = col(["ECS"]), mSpecial = col(["Special"]);
  const mTotal = col(["Total"]), mNewTotal = col(["New Total"]), mRemaining = col(["Remaining"]);
  const mSfdc = col(["SFDC"]), mOnline = col(["Online"]);
  const pDate = pcol(["Date", "Payment Date", "Paid Date"]);
  const pTotal = pcol(["Total", "Paid Amount", "Payment Amount", "New Total"]);
  const pDac = pcol(["DAC"]), pEcs = pcol(["ECS"]), pSpecial = pcol(["Special"]);
  const required = [mDate,mDac,mTotal,mNewTotal,mRemaining,pTotal];
  if (required.some((i) => i < 0)) throw new Error("Required columns missing. Data must contain Date, DAC, Total, New Total, Remaining; Paid File must contain Total/Paid Amount.");
  const masterMap = new Map<string, { row: string[]; rowNumber: number }>();
  for (let i = 1; i < masterRows.length; i++) {
    const row = masterRows[i] ?? [];
    const id = normalise(row[mAgreement]);
    if (id) masterMap.set(id, { row, rowNumber: i + 1 });
  }
  const paidById = new Map<string, string[][]>();
  for (let i = 1; i < paidRows.length; i++) {
    const row = paidRows[i] ?? [];
    const id = normalise(row[pAgreement]);
    if (!id) continue;
    const list = paidById.get(id) ?? [];
    list.push(row);
    paidById.set(id, list);
  }
  const preview: Array<{ agreementId: string; rowNumber: number; oldTotal: number; newTotal: number; remaining: number; date: string; dac: number; ecs?: number; special?: number; status: string }> = [];
  let duplicateCount = 0, unmatchedCount = 0, invalidCount = 0;
  for (const [id, rows] of paidById) {
    if (rows.length !== 1) { duplicateCount += rows.length; continue; }
    const paid = rows[0]!;
    const found = masterMap.get(id);
    if (!found) { unmatchedCount++; continue; }
    const oldTotal = asNumber(found.row[mTotal]);
    const parsedTotal = parseAmount(paid[pTotal]);
    if (parsedTotal === null) { invalidCount++; continue; }
    const newTotal = parsedTotal;
    const remaining = oldTotal - newTotal;
    const date = pDate >= 0 ? String(paid[pDate] ?? "").trim() : "";
    const dac = pDac >= 0 ? asNumber(paid[pDac]) : (mSfdc >= 0 ? asNumber(found.row[mSfdc]) : 0) + (mOnline >= 0 ? asNumber(found.row[mOnline]) : 0);
    preview.push({ agreementId: String(found.row[mAgreement] ?? id), rowNumber: found.rowNumber, oldTotal, newTotal, remaining, date, dac, ...(pEcs >= 0 ? { ecs: asNumber(paid[pEcs]) } : {}), ...(pSpecial >= 0 ? { special: asNumber(paid[pSpecial]) } : {}), status: remaining < 0 ? "Overpaid" : "Ready" });
  }
  return { preview, duplicateCount, unmatchedCount, invalidCount, paidRows: paidById.size, matchedCount: preview.length, columns: { mDate, mDac, mEcs, mSpecial, mNewTotal, mRemaining, pEcs, pSpecial } };
}

export const getPaidFileSetup = createServerFn({ method: "GET" }).handler(async () => {
  await requireSession("Admin");
  const [masterId, drive] = await Promise.all([
    getMasterId(),
    (async () => {
      const response = await fetch(`${GATEWAY}/google_drive/drive/v3/files?q=${encodeURIComponent("trashed=false and mimeType='application/vnd.google-apps.spreadsheet'")}&pageSize=100&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime,webViewLink)`, { headers: connectorHeaders("GOOGLE_DRIVE_API_KEY") });
      const json = await checkedJson(response, "Drive spreadsheet listing") as { files?: Array<{id:string;name:string;mimeType:string;modifiedTime?:string;webViewLink?:string}> };
      return (json.files ?? []).filter((f) => f["id"] !== SPREADSHEET_ID);
    })(),
  ]);
  return { masterId, files: drive };
});

export const savePaidFileMaster = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ spreadsheetId: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/) }).parse(d))
  .handler(async ({ data }) => {
    await requireSession("Admin");
    const file = await getDriveFile(data.spreadsheetId);
    if (file["trashed"] || file["mimeType"] !== GOOGLE_SHEET_MIME) throw new Error("Select an active Google spreadsheet.");
    const dataRows = await readValues(data.spreadsheetId, "Data!A1:B2");
    if (!dataRows.length || !normalise(dataRows[0]?.[0]).includes("agreement")) throw new Error("Selected spreadsheet must contain a Data tab with Agreement ID in column A.");
    await saveMasterId(data.spreadsheetId);
    return { ok: true, name: file["name"] };
  });

export const uploadPaidFile = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ fileName: z.string().min(1).max(180), base64: z.string().min(1).max(18_000_000) }).parse(d))
  .handler(async ({ data }) => {
    await requireSession("Admin");
    const masterId = await getMasterId();
    if (!masterId) throw new Error("Choose the Master Allocation spreadsheet first.");
    if (!/\.xlsb$/i.test(data.fileName)) throw new Error("Paid File must be an .xlsb workbook.");
    const base64 = data.base64.replace(/^data:[^,]+,/, "").replace(/\s/g, "");
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length < 8 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("The uploaded file is not a valid XLSB/OOXML container.");
    if (bytes.length > 12 * 1024 * 1024) throw new Error("Paid File exceeds the 12 MB limit.");
    const driveHeaders = connectorHeaders("GOOGLE_DRIVE_API_KEY");
    const originalBoundary = "paidoriginal" + crypto.randomUUID().replace(/-/g, "");
    const originalMetadata = JSON.stringify({ name: data.fileName, parents: [DRIVE_FOLDER_ID], mimeType: XLSB_MIME });
    const originalPrefix = Buffer.from(`--${originalBoundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${originalMetadata}\r\n--${originalBoundary}\r\nContent-Type: ${XLSB_MIME}\r\n\r\n`);
    const suffix = Buffer.from(`\r\n--${originalBoundary}--\r\n`);
    const originalBody = Buffer.concat([originalPrefix, bytes, suffix]);
    const originalUpload = await fetch(`${GATEWAY}/google_drive/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType`, { method: "POST", headers: { ...driveHeaders, "Content-Type": `multipart/related; boundary=${originalBoundary}` }, body: originalBody });
    const original = await checkedJson<{ id: string; name?: string; mimeType?: string }>(originalUpload, "Original XLSB upload");
    const boundary = "paidconvert" + crypto.randomUUID().replace(/-/g, "");
    const metadata = JSON.stringify({ name: data.fileName.replace(/\.xlsb$/i, "") + " (Converted)", parents: [DRIVE_FOLDER_ID], mimeType: GOOGLE_SHEET_MIME });
    const prefix = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${XLSB_MIME}\r\n\r\n`);
    const conversionSuffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([prefix, bytes, conversionSuffix]);
    const upload = await fetch(`${GATEWAY}/google_drive/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink`, { method: "POST", headers: { ...driveHeaders, "Content-Type": `multipart/related; boundary=${boundary}` }, body });
    const converted = await checkedJson<{ id: string; name?: string; mimeType?: string }>(upload, "XLSB conversion to Google Sheets");
    if (converted["mimeType"] !== GOOGLE_SHEET_MIME) throw new Error("Google Drive did not convert this XLSB workbook to a Google Sheet. Original XLSB is safely stored in Drive; no master data was changed.");
    const file = await getDriveFile(converted["id"]);
    if (file["trashed"]) throw new Error("Converted Paid File is not available in Drive.");
    const result = await buildPreview(masterId, converted["id"]);
    return { fileId: converted["id"], originalFileId: original["id"], fileName: converted.name ?? data.fileName, ...result };
  });

export const previewPaidFile = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ fileId: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/) }).parse(d))
  .handler(async ({ data }) => {
    await requireSession("Admin");
    const masterId = await getMasterId();
    if (!masterId) throw new Error("Master Allocation is not configured.");
    const file = await getDriveFile(data.fileId);
    if (file["trashed"] || file["mimeType"] !== GOOGLE_SHEET_MIME) throw new Error("Paid File conversion is unavailable.");
    return { fileName: file["name"], ...await buildPreview(masterId, data.fileId) };
  });

export const applyPaidFile = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ fileId: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/), confirm: z.literal(true) }).parse(d))
  .handler(async ({ data }) => {
    await requireSession("Admin");
    const masterId = await getMasterId();
    if (!masterId) throw new Error("Master Allocation is not configured.");
    const file = await getDriveFile(data.fileId);
    if (file["trashed"] || file["mimeType"] !== GOOGLE_SHEET_MIME) throw new Error("Paid File conversion is unavailable.");
    const { preview, duplicateCount, unmatchedCount, invalidCount, columns } = await buildPreview(masterId, data.fileId);
    if (duplicateCount || invalidCount) throw new Error("Write-back blocked: resolve duplicate Agreement IDs and invalid amounts first.");
    if (!preview.length) throw new Error("No valid matched payments to apply.");
    const writes: Array<{ range: string; values: (string | number)[][] }> = [];
    for (const item of preview) {
      const row = item.rowNumber;
      if (item.date) writes.push({ range: `Data!${columnName(columns.mDate)}${row}`, values: [[item.date]] });
      writes.push({ range: `Data!${columnName(columns.mDac)}${row}`, values: [[item.dac]] });
      writes.push({ range: `Data!${columnName(columns.mNewTotal)}${row}`, values: [[item.newTotal]] });
      writes.push({ range: `Data!${columnName(columns.mRemaining)}${row}`, values: [[item.remaining]] });
      if (columns.mEcs >= 0 && item.ecs !== undefined) writes.push({ range: `Data!${columnName(columns.mEcs)}${row}`, values: [[item.ecs]] });
      if (columns.mSpecial >= 0 && item.special !== undefined) writes.push({ range: `Data!${columnName(columns.mSpecial)}${row}`, values: [[item.special]] });
    }
    const apiHeaders = connectorHeaders("GOOGLE_SHEETS_API_KEY");
    const updateResponse = await fetch(`${GATEWAY}/google_sheets/v4/spreadsheets/${masterId}/values:batchUpdate`, { method: "POST", headers: { ...apiHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: writes }) });
    await checkedJson(updateResponse, "Paid File master update");
    const auditHeaders = ["Applied At", "Paid File ID", "Paid File Name", "Matched Rows", "Unmatched Rows", "Duplicate Rows", "Invalid Rows", "Applied By"];
    const meta = await checkedJson<{ sheets?: Array<{ properties?: { title?: string } }> }>(await fetch(`${GATEWAY}/google_sheets/v4/spreadsheets/${masterId}?fields=sheets.properties`, { headers: apiHeaders }), "Master metadata");
    const auditExists = (meta["sheets"] ?? []).some((sheet) => sheet.properties?.title === "Paid File Audit");
    if (!auditExists) await checkedJson(await fetch(`${GATEWAY}/google_sheets/v4/spreadsheets/${masterId}:batchUpdate`, { method: "POST", headers: { ...apiHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ requests: [{ addSheet: { properties: { title: "Paid File Audit" } } }] }) }), "Create Paid File Audit");
    const audit = await fetch(`${GATEWAY}/google_sheets/v4/spreadsheets/${masterId}/values/${encodeURIComponent("'Paid File Audit'!A1:H")}?valueInputOption=RAW`, { headers: apiHeaders });
    const auditJson = await checkedJson(audit, "Audit read") as { values?: string[][] };
    if (!(auditJson.values ?? []).length) await checkedJson(await fetch(`${GATEWAY}/google_sheets/v4/spreadsheets/${masterId}/values/${encodeURIComponent("'Paid File Audit'!A1:H1")}?valueInputOption=RAW`, { method: "PUT", headers: { ...apiHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ values: [auditHeaders] }) }), "Audit headers");
    const nextRow = (auditJson.values?.length ?? 1) + 1;
    await checkedJson(await fetch(`${GATEWAY}/google_sheets/v4/spreadsheets/${masterId}/values/${encodeURIComponent("'Paid File Audit'!A" + nextRow + ":H" + nextRow)}?valueInputOption=RAW`, { method: "PUT", headers: { ...apiHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ values: [[new Date().toISOString(), data.fileId, String(file["name"] ?? ""), preview.length, unmatchedCount, duplicateCount, invalidCount, (await requireSession("Admin"))["name"]]] }) }), "Paid File audit write");
    return { ok: true, applied: preview.length, unmatchedCount, duplicateCount, invalidCount };
  });
