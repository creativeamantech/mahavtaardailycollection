// Server-only helpers for Google Sheets + Drive via the Lovable connector gateway.
// Reads may use the public CSV endpoint, but every write requires a successful API operation.
// Section-aware data fetching utility: routes requests to Daily Collection vs. Bank Portal Google Sheet IDs
// and scopes all caches and local overlays by spreadsheet ID to strictly prevent data overlap.

import {
  DAILY_COLLECTION_SPREADSHEET_ID,
  getBankPortalSpreadsheetId,
  extractSpreadsheetId,
} from "./bank-portal-config.server";

export type AppSection = "daily_collection" | "bank_portal";

export { DAILY_COLLECTION_SPREADSHEET_ID };
export const SPREADSHEET_ID = DAILY_COLLECTION_SPREADSHEET_ID;
export const DRIVE_FOLDER_ID = "1iBlXqe09aG5kA_hHf3WtFILnA1RibCf7";
const GATEWAY = "https://connector-gateway.lovable.dev";

// Resolves target Google Spreadsheet ID based on the app section or custom ID/URL
export function resolveSpreadsheetId(sectionOrId?: AppSection | string, range?: string): string {
  if (sectionOrId === "daily_collection") {
    return DAILY_COLLECTION_SPREADSHEET_ID;
  }
  if (sectionOrId === "bank_portal") {
    return getBankPortalSpreadsheetId();
  }
  if (sectionOrId && sectionOrId !== "daily_collection" && sectionOrId !== "bank_portal") {
    return extractSpreadsheetId(sectionOrId);
  }
  // Auto-detect section based on range / sheet title if section was omitted:
  if (
    range &&
    (range.startsWith("Portal_") || range.includes("!Portal_") || range.startsWith("'Portal_"))
  ) {
    return getBankPortalSpreadsheetId();
  }
  return DAILY_COLLECTION_SPREADSHEET_ID;
}

function hasCredentials(connectorKey: string): boolean {
  return Boolean(process.env["LOVABLE_API_KEY"] && process.env[connectorKey]);
}

function headers(connectorKey: string) {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connKey = process.env[connectorKey];
  if (!lovableKey || !connKey) {
    throw new Error(`Missing credentials (${connectorKey}).`);
  }
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connKey,
  };
}

async function ok(res: Response, label: string) {
  if (!res.ok) {
    const body = await res.text();
    console.error(`${label} failed [${res.status}]: ${body}`);
    throw new Error(`${label} failed [${res.status}]: ${body}`);
  }
  return res.json();
}

// --- read cache + retry scoped by spreadsheet ID to prevent cross-module overlap ---
const CACHE_TTL_MS = 20_000;
// Key: `${spreadsheetId}::${range}`
const readCache = new Map<string, { at: number; rows: string[][] }>();
const inFlight = new Map<string, Promise<string[][]>>();


export function invalidateSheetsCache(sectionOrId?: AppSection | string) {
  if (!sectionOrId) {
    readCache.clear();
    return;
  }
  const targetId = resolveSpreadsheetId(sectionOrId);
  for (const key of Array.from(readCache.keys())) {
    if (key.startsWith(`${targetId}::`)) {
      readCache.delete(key);
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cell += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\r" && next === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
        i++;
      } else if (c === "\n" || c === "\r") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += c;
      }
    }
  }
  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function colToIdx(c: string): number {
  let n = 0;
  for (let i = 0; i < c.length; i++) {
    n = n * 26 + (c.charCodeAt(i) - 64);
  }
  return n - 1;
}

function parseRange(range: string) {
  const parts = range.split("!");
  const sheetTitle =
    parts.length > 1 ? (parts[0] ?? "").trim().replace(/^'|'$/g, "") : "Collections";
  const rangePart = parts.length > 1 ? (parts[1] ?? "").trim() : (parts[0] ?? "").trim();
  const match = rangePart.match(/^([A-Z]+)?(\d+)?(?::([A-Z]+)?(\d+)?)?$/i);
  let startCol = 0;
  let endCol = 26;
  let startRow = 1;
  let endRow = Infinity;

  if (match) {
    if (match[1]) startCol = colToIdx(match[1].toUpperCase());
    if (match[2]) startRow = parseInt(match[2], 10);
    if (match[3]) endCol = colToIdx(match[3].toUpperCase()) + 1;
    if (match[4]) endRow = parseInt(match[4], 10);
  }
  return { sheetTitle, startCol, endCol, startRow, endRow };
}

async function fetchFromPublicSheet(
  range: string,
  spreadsheetId: string = DAILY_COLLECTION_SPREADSHEET_ID,
): Promise<string[][]> {
  const { sheetTitle, startCol, endCol, startRow, endRow } = parseRange(range);
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetTitle)}`;

  let baseRows: string[][] = [];
  try {
    const res = await fetch(url);
    if (res.ok) {
      const text = await res.text();
      baseRows = parseCsv(text);
    }
  } catch (err) {
    console.warn(`Public Google Sheets fetch failed for ${sheetTitle} on ${spreadsheetId}:`, err);
  }

  // Deep clone to apply local overlays
  const allRows: string[][] = baseRows.map((r) => [...r]);

  // Apply any locally updated cells for this specific spreadsheet
  const sheetUpdates = localUpdated.get(spreadsheetId)?.get(sheetTitle);
  if (sheetUpdates) {
    for (const [key, val] of sheetUpdates.entries()) {
      const [rStr, cStr] = key.split(",");
      const rIdx = parseInt(rStr ?? "0", 10);
      const cIdx = parseInt(cStr ?? "0", 10);
      while (allRows.length <= rIdx) allRows.push([]);
      const rowArr = allRows[rIdx]!;
      while (rowArr.length <= cIdx) rowArr.push("");
      rowArr[cIdx] = val;
    }
  }

  // Append any locally added rows for this specific spreadsheet
  const sheetAppended = localAppended.get(spreadsheetId)?.get(sheetTitle);
  if (sheetAppended) {
    for (const r of sheetAppended) {
      allRows.push([...r]);
    }
  }

  // Row 1 in sheet is index 0 in allRows. Range startRow 2 means index 1.
  const rowStartIdx = Math.max(0, startRow - 1);
  const rowEndIdx = endRow === Infinity ? undefined : endRow;

  return allRows.slice(rowStartIdx, rowEndIdx).map((r) => {
    const rowSlice = r.slice(startCol, endCol);
    // Pad to endCol - startCol if row was shorter
    const targetLen = Math.max(0, endCol - startCol);
    while (rowSlice.length < targetLen) {
      rowSlice.push("");
    }
    return rowSlice;
  });
}

async function fetchRange(range: string, spreadsheetId: string): Promise<string[][]> {
  if (hasCredentials("GOOGLE_SHEETS_API_KEY")) {
    let lastBody = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(
          `${GATEWAY}/google_sheets/v4/spreadsheets/${spreadsheetId}/values/${range}`,
          { headers: headers("GOOGLE_SHEETS_API_KEY") },
        );
        if (res.ok) {
          const json = (await res.json()) as { values?: string[][] };
          return json.values ?? [];
        }
        lastBody = await res.text();
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt === 2) {
          break;
        }
        await sleep(600 * 2 ** attempt + Math.random() * 300);
      } catch (err) {
        lastBody = String(err);
        break;
      }
    }
    console.warn(
      `Gateway fetch failed for ${range} on ${spreadsheetId} (${lastBody}). Falling back to public sheet reader.`,
    );
  }

  return fetchFromPublicSheet(range, spreadsheetId);
}

export async function sheetsGet(
  range: string,
  sectionOrId?: AppSection | string,
): Promise<string[][]> {
  const spreadsheetId = resolveSpreadsheetId(sectionOrId, range);
  const cacheKey = `${spreadsheetId}::${range}`;

  const cached = readCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;

  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const p = fetchRange(range, spreadsheetId)
    .then((rows) => {
      readCache.set(cacheKey, { at: Date.now(), rows });
      return rows;
    })
    .finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, p);
  return p;
}

export async function sheetsAppend(
  range: string,
  values: (string | number)[][],
  sectionOrId?: AppSection | string,
) {
  if (!hasCredentials("GOOGLE_SHEETS_API_KEY")) {
    throw new Error("Google Sheets write unavailable: configure LOVABLE_API_KEY and GOOGLE_SHEETS_API_KEY in server secrets.");
  }
  const spreadsheetId = resolveSpreadsheetId(sectionOrId, range);
  const res = await fetch(
    `${GATEWAY}/google_sheets/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { ...headers("GOOGLE_SHEETS_API_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    },
  );
  const result = await ok(res, "Google Sheets append");
  invalidateSheetsCache(spreadsheetId);
  return result;
}

export async function sheetsUpdate(
  range: string,
  values: (string | number)[][],
  sectionOrId?: AppSection | string,
) {
  if (!hasCredentials("GOOGLE_SHEETS_API_KEY")) {
    throw new Error("Google Sheets write unavailable: configure LOVABLE_API_KEY and GOOGLE_SHEETS_API_KEY in server secrets.");
  }
  const spreadsheetId = resolveSpreadsheetId(sectionOrId, range);
  const res = await fetch(
    `${GATEWAY}/google_sheets/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { ...headers("GOOGLE_SHEETS_API_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    },
  );
  const result = await ok(res, "Google Sheets update");
  invalidateSheetsCache(spreadsheetId);
  return result;
}

export async function getSheetId(
  title: string,
  sectionOrId?: AppSection | string,
): Promise<number> {
  const spreadsheetId = resolveSpreadsheetId(sectionOrId, title);
  const cachedForSheet = sheetIdCache.get(spreadsheetId);
  if (cachedForSheet && typeof cachedForSheet[title] === "number") return cachedForSheet[title]!;

  if (!hasCredentials("GOOGLE_SHEETS_API_KEY")) {
    throw new Error("Google Sheets metadata unavailable: configure server credentials.");
  }
  const res = await fetch(
    `${GATEWAY}/google_sheets/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
    { headers: headers("GOOGLE_SHEETS_API_KEY") },
  );
  const json = (await ok(res, "Google Sheets metadata")) as {
    sheets?: { properties?: { sheetId?: number; title?: string } }[];
  };
  const newCache: Record<string, number> = {};
  for (const sheet of json.sheets ?? []) {
    const props = sheet.properties;
    if (props && typeof props.sheetId === "number" && props.title) newCache[props.title] = props.sheetId;
  }
  sheetIdCache.set(spreadsheetId, newCache);
  const id = newCache[title];
  if (typeof id !== "number") throw new Error(`Sheet tab "${title}" not found in spreadsheet ${spreadsheetId}.`);
  return id;
}

export async function sheetsBatchUpdate(requests: unknown[], sectionOrId?: AppSection | string) {
  if (!hasCredentials("GOOGLE_SHEETS_API_KEY")) {
    throw new Error("Google Sheets write unavailable: configure LOVABLE_API_KEY and GOOGLE_SHEETS_API_KEY in server secrets.");
  }
  const spreadsheetId = resolveSpreadsheetId(sectionOrId);
  const res = await fetch(
    `${GATEWAY}/google_sheets/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: "POST",
      headers: { ...headers("GOOGLE_SHEETS_API_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    },
  );
  const result = await ok(res, "Google Sheets batch update");
  invalidateSheetsCache(spreadsheetId);
  sheetIdCache.delete(spreadsheetId);
  return result;
}

export async function driveUpload(name: string, mimeType: string, base64: string) {
  if (hasCredentials("GOOGLE_DRIVE_API_KEY")) {
    try {
      const boundary = "mahavtaarboundary" + Math.random().toString(36).slice(2);
      const metadata = JSON.stringify({ name, parents: [DRIVE_FOLDER_ID] });
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64}\r\n` +
        `--${boundary}--`;

      const res = await fetch(
        `${GATEWAY}/google_drive/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink`,
        {
          method: "POST",
          headers: {
            ...headers("GOOGLE_DRIVE_API_KEY"),
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body,
        },
      );
      const file = (await ok(res, "Drive upload")) as { id: string; webViewLink?: string };

      await fetch(`${GATEWAY}/google_drive/drive/v3/files/${file.id}/permissions`, {
        method: "POST",
        headers: { ...headers("GOOGLE_DRIVE_API_KEY"), "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      }).catch((e) => console.error("Drive share failed", e));

      return file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`;
    } catch (err) {
      console.warn("Google Drive upload via gateway failed, using data URI fallback:", err);
    }
  }

  // Return base64 data URI when drive upload credentials are not available
  return `data:${mimeType};base64,${base64}`;
}

// Creates a tab (with optional header row) when it does not exist yet.
export async function ensureSheet(
  title: string,
  header?: string[],
  sectionOrId?: AppSection | string,
) {
  const spreadsheetId = resolveSpreadsheetId(sectionOrId, title);
  try {
    return await getSheetId(title, spreadsheetId);
  } catch {
    if (hasCredentials("GOOGLE_SHEETS_API_KEY")) {
      await sheetsBatchUpdate([{ addSheet: { properties: { title } } }], spreadsheetId);
      sheetIdCache.delete(spreadsheetId);
      if (header && header.length > 0) {
        await sheetsUpdate(
          `${title}!A1:${String.fromCharCode(64 + header.length)}1`,
          [header],
          spreadsheetId,
        );
      }
      return getSheetId(title, spreadsheetId);
    }
    throw new Error("Cannot create a Google Sheets tab without server credentials.");
  }
}
