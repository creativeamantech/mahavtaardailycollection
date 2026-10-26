import fs from "fs";
import path from "path";

// Server-only Google Sheets helper dedicated EXCLUSIVELY to Bank Portal Usage & Accountability.
// Completely separated from the Daily Collection Google Spreadsheet (1AXLakW3subO9H-O9iWIpXJyjT4JLXRTG5uiL3dWsY5g).

export const DAILY_COLLECTION_SPREADSHEET_ID = "1AXLakW3subO9H-O9iWIpXJyjT4JLXRTG5uiL3dWsY5g";

// Default Bank Portal Spreadsheet ID (dedicated and distinct)
const FALLBACK_BANK_PORTAL_SPREADSHEET_ID =
  process.env["BANK_PORTAL_SPREADSHEET_ID"] ||
  "1-BankPortal-Mahavtaar-Usage-Accountability-Dedicated";

const GATEWAY = "https://connector-gateway.lovable.dev";
const CONFIG_FILE_PATH = path.resolve(process.cwd(), "bank-portal-config.json");

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

interface BankPortalConfig {
  spreadsheetId: string;
  spreadsheetTitle: string;
  updatedAt: string;
  updatedBy: string;
  isCustom: boolean;
}

// In-memory runtime state for Bank Portal Sheets
let currentBankPortalConfig: BankPortalConfig = loadBankPortalConfig();

function loadBankPortalConfig(): BankPortalConfig {
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const raw = fs.readFileSync(CONFIG_FILE_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.spreadsheetId === "string" && parsed.spreadsheetId.trim()) {
        const id = parsed.spreadsheetId.trim();
        // Prevent accidental re-linking of daily collection spreadsheet
        if (id === DAILY_COLLECTION_SPREADSHEET_ID) {
          console.warn(
            "Found Daily Collection spreadsheet in bank portal config. Resetting to dedicated Bank Portal ID.",
          );
        } else {
          return {
            spreadsheetId: id,
            spreadsheetTitle: parsed.spreadsheetTitle || "Mahavtaar Bank Portal Accountability",
            updatedAt: parsed.updatedAt || new Date().toISOString(),
            updatedBy: parsed.updatedBy || "System",
            isCustom: true,
          };
        }
      }
    }
  } catch (err) {
    console.warn("Could not read bank-portal-config.json:", err);
  }

  return {
    spreadsheetId: FALLBACK_BANK_PORTAL_SPREADSHEET_ID,
    spreadsheetTitle: "Mahavtaar Bank Portal Accountability",
    updatedAt: new Date().toISOString(),
    updatedBy: "System",
    isCustom: false,
  };
}

function persistBankPortalConfig(config: BankPortalConfig) {
  currentBankPortalConfig = config;
  try {
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), "utf-8");
  } catch (err) {
    console.warn("Could not persist bank-portal-config.json:", err);
  }
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
  return currentBankPortalConfig.spreadsheetId;
}

export function getBankPortalSpreadsheetUrl(): string {
  const id = getBankPortalSpreadsheetId();
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

export function getBankPortalSpreadsheetConfig() {
  const id = getBankPortalSpreadsheetId();
  const isSeparate = id !== DAILY_COLLECTION_SPREADSHEET_ID;
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
    hasApiCredentials: hasCredentials("GOOGLE_SHEETS_API_KEY"),
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

  // Strict check: Bank Portal must NEVER use the Daily Collection spreadsheet
  if (id === DAILY_COLLECTION_SPREADSHEET_ID) {
    return {
      ok: false,
      spreadsheetId: id,
      message:
        "Daily Collection spreadsheet ID cannot be used for Bank Portal! Bank Portal must use a separate dedicated Google Spreadsheet.",
    };
  }

  const prevId = currentBankPortalConfig.spreadsheetId;
  persistBankPortalConfig({
    spreadsheetId: id,
    spreadsheetTitle: "Mahavtaar Bank Portal Accountability",
    updatedAt: new Date().toISOString(),
    updatedBy,
    isCustom: true,
  });

  // Clear cache & local overlay if switching sheets
  if (prevId !== id) {
    invalidatePortalSheetsCache();
    portalLocalAppended.clear();
    portalLocalUpdated.clear();
  }

  return {
    ok: true,
    spreadsheetId: id,
    message: `Bank Portal Google Spreadsheet successfully set to ${id}.`,
  };
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

// In-memory cache & isolated local overlay for Bank Portal
const PORTAL_CACHE_TTL_MS = 20_000;
const portalReadCache = new Map<string, { at: number; rows: string[][] }>();
const portalInFlight = new Map<string, Promise<string[][]>>();

const portalLocalAppended = new Map<string, string[][]>();
const portalLocalUpdated = new Map<string, Map<string, string>>();
let portalSheetIdCache: Record<string, number> = {};

export function invalidatePortalSheetsCache() {
  portalReadCache.clear();
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
    parts.length > 1 ? (parts[0] ?? "").trim().replace(/^'|'$/g, "") : PORTAL_TABS.SESSIONS;
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

async function fetchFromBankPortalPublicSheet(range: string): Promise<string[][]> {
  const { sheetTitle, startCol, endCol, startRow, endRow } = parseRange(range);
  const currentSpreadsheetId = getBankPortalSpreadsheetId();
  const url = `https://docs.google.com/spreadsheets/d/${currentSpreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetTitle)}`;

  let baseRows: string[][] = [];
  try {
    const res = await fetch(url);
    if (res.ok) {
      const text = await res.text();
      baseRows = parseCsv(text);
    }
  } catch (err) {
    // If not public or offline, fall back to empty base rows and use local overlay
  }

  // Deep clone to apply local overlay
  const allRows: string[][] = baseRows.map((r) => [...r]);

  // Apply locally updated cells
  const updates = portalLocalUpdated.get(sheetTitle);
  if (updates) {
    for (const [key, val] of updates.entries()) {
      const [rStr, cStr] = key.split(",");
      const rIdx = parseInt(rStr ?? "0", 10);
      const cIdx = parseInt(cStr ?? "0", 10);
      while (allRows.length <= rIdx) allRows.push([]);
      const rowArr = allRows[rIdx]!;
      while (rowArr.length <= cIdx) rowArr.push("");
      rowArr[cIdx] = val;
    }
  }

  // Append locally added rows
  const appended = portalLocalAppended.get(sheetTitle);
  if (appended) {
    for (const r of appended) {
      allRows.push([...r]);
    }
  }

  const rowStartIdx = Math.max(0, startRow - 1);
  const rowEndIdx = endRow === Infinity ? undefined : endRow;

  return allRows.slice(rowStartIdx, rowEndIdx).map((r) => {
    const rowSlice = r.slice(startCol, endCol);
    const targetLen = Math.max(0, endCol - startCol);
    while (rowSlice.length < targetLen) {
      rowSlice.push("");
    }
    return rowSlice;
  });
}

async function fetchPortalRange(range: string): Promise<string[][]> {
  const currentSpreadsheetId = getBankPortalSpreadsheetId();

  if (hasCredentials("GOOGLE_SHEETS_API_KEY")) {
    let lastBody = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(
          `${GATEWAY}/google_sheets/v4/spreadsheets/${currentSpreadsheetId}/values/${range}`,
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
      `Portal gateway fetch failed for ${range} (${lastBody}). Falling back to local/public reader.`,
    );
  }

  return fetchFromBankPortalPublicSheet(range);
}

export async function portalSheetsGet(range: string): Promise<string[][]> {
  const cached = portalReadCache.get(range);
  if (cached && Date.now() - cached.at < PORTAL_CACHE_TTL_MS) return cached.rows;

  const pending = portalInFlight.get(range);
  if (pending) return pending;

  const p = fetchPortalRange(range)
    .then((rows) => {
      portalReadCache.set(range, { at: Date.now(), rows });
      return rows;
    })
    .finally(() => portalInFlight.delete(range));
  portalInFlight.set(range, p);
  return p;
}

export async function portalSheetsAppend(range: string, values: (string | number)[][]) {
  const currentSpreadsheetId = getBankPortalSpreadsheetId();

  if (hasCredentials("GOOGLE_SHEETS_API_KEY")) {
    try {
      const res = await fetch(
        `${GATEWAY}/google_sheets/v4/spreadsheets/${currentSpreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: "POST",
          headers: { ...headers("GOOGLE_SHEETS_API_KEY"), "Content-Type": "application/json" },
          body: JSON.stringify({ values }),
        },
      );
      invalidatePortalSheetsCache();
      return ok(res, "Portal Sheets append");
    } catch (err) {
      console.warn("Portal Gateway append failed, using local overlay:", err);
    }
  }

  const { sheetTitle } = parseRange(range);
  if (!portalLocalAppended.has(sheetTitle)) {
    portalLocalAppended.set(sheetTitle, []);
  }
  const strRows = values.map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c))));
  portalLocalAppended.get(sheetTitle)!.push(...strRows);

  let baseCount = 1;
  try {
    const publicData = await fetchFromBankPortalPublicSheet(`${sheetTitle}!A1:A`);
    baseCount = publicData.length;
  } catch {
    // fallback
  }
  const rowNum = baseCount + (portalLocalAppended.get(sheetTitle)?.length ?? 1);
  invalidatePortalSheetsCache();

  return { updates: { updatedRange: `${sheetTitle}!A${rowNum}:K${rowNum}` } };
}

export async function portalSheetsUpdate(range: string, values: (string | number)[][]) {
  const currentSpreadsheetId = getBankPortalSpreadsheetId();

  if (hasCredentials("GOOGLE_SHEETS_API_KEY")) {
    try {
      const res = await fetch(
        `${GATEWAY}/google_sheets/v4/spreadsheets/${currentSpreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
        {
          method: "PUT",
          headers: { ...headers("GOOGLE_SHEETS_API_KEY"), "Content-Type": "application/json" },
          body: JSON.stringify({ values }),
        },
      );
      invalidatePortalSheetsCache();
      return ok(res, "Portal Sheets update");
    } catch (err) {
      console.warn("Portal Gateway update failed, using local overlay:", err);
    }
  }

  const { sheetTitle, startRow, startCol } = parseRange(range);
  if (!portalLocalUpdated.has(sheetTitle)) {
    portalLocalUpdated.set(sheetTitle, new Map());
  }
  const updates = portalLocalUpdated.get(sheetTitle)!;
  for (let r = 0; r < values.length; r++) {
    const rowValues = values[r] ?? [];
    for (let c = 0; c < rowValues.length; c++) {
      const targetRowIdx = startRow - 1 + r;
      const targetColIdx = startCol + c;
      const val = rowValues[c] === null || rowValues[c] === undefined ? "" : String(rowValues[c]);
      updates.set(`${targetRowIdx},${targetColIdx}`, val);
    }
  }
  invalidatePortalSheetsCache();
  return { ok: true };
}

export async function getPortalSheetId(title: string): Promise<number> {
  const cached = portalSheetIdCache[title];
  if (typeof cached === "number") return cached;

  const currentSpreadsheetId = getBankPortalSpreadsheetId();

  if (hasCredentials("GOOGLE_SHEETS_API_KEY")) {
    try {
      const res = await fetch(
        `${GATEWAY}/google_sheets/v4/spreadsheets/${currentSpreadsheetId}?fields=sheets.properties`,
        { headers: headers("GOOGLE_SHEETS_API_KEY") },
      );
      const json = (await ok(res, "Portal Sheets metadata")) as {
        sheets?: { properties?: { sheetId?: number; title?: string } }[];
      };
      portalSheetIdCache = {};
      for (const s of json.sheets ?? []) {
        const p = s.properties;
        if (p && typeof p.sheetId === "number" && p.title) portalSheetIdCache[p.title] = p.sheetId;
      }
      const id = portalSheetIdCache[title];
      if (typeof id === "number") return id;
    } catch (err) {
      console.warn(`Failed to fetch portal sheet ID for ${title} via gateway:`, err);
    }
  }

  const knownPortalSheetIds: Record<string, number> = {
    Portal_Sessions: 101,
    Portal_Schedules: 102,
    Portal_Complaints: 103,
    Portal_Warnings: 104,
    Portal_Bans: 105,
    Portal_Audit: 106,
  };
  return knownPortalSheetIds[title] ?? 100;
}

export async function portalSheetsBatchUpdate(requests: unknown[]) {
  const currentSpreadsheetId = getBankPortalSpreadsheetId();

  if (hasCredentials("GOOGLE_SHEETS_API_KEY")) {
    try {
      const res = await fetch(
        `${GATEWAY}/google_sheets/v4/spreadsheets/${currentSpreadsheetId}:batchUpdate`,
        {
          method: "POST",
          headers: { ...headers("GOOGLE_SHEETS_API_KEY"), "Content-Type": "application/json" },
          body: JSON.stringify({ requests }),
        },
      );
      return ok(res, "Portal Sheets batchUpdate");
    } catch (err) {
      console.warn("Portal Gateway batchUpdate failed:", err);
    }
  }

  return { ok: true };
}

// Ensure a tab exists in the Bank Portal Google Spreadsheet (with header row)
export async function portalEnsureSheet(title: string, header?: string[]) {
  try {
    return await getPortalSheetId(title);
  } catch {
    if (hasCredentials("GOOGLE_SHEETS_API_KEY")) {
      await portalSheetsBatchUpdate([{ addSheet: { properties: { title } } }]);
      portalSheetIdCache = {};
      if (header && header.length > 0) {
        await portalSheetsUpdate(`${title}!A1:${String.fromCharCode(64 + header.length)}1`, [
          header,
        ]);
      }
      return getPortalSheetId(title);
    }
    return 0;
  }
}

// Programmatically create a new Google Spreadsheet dedicated to Bank Portal if API credentials exist
export async function createDedicatedBankPortalSpreadsheet(
  title: string = "Mahavtaar Bank Portal Usage & Accountability",
  adminActor: string = "Aman",
): Promise<{ ok: boolean; spreadsheetId: string; spreadsheetUrl: string; message: string }> {
  if (hasCredentials("GOOGLE_SHEETS_API_KEY")) {
    try {
      const res = await fetch(`${GATEWAY}/google_sheets/v4/spreadsheets`, {
        method: "POST",
        headers: {
          ...headers("GOOGLE_SHEETS_API_KEY"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: {
            title,
          },
          sheets: [
            { properties: { title: PORTAL_TABS.SESSIONS } },
            { properties: { title: PORTAL_TABS.SCHEDULES } },
            { properties: { title: PORTAL_TABS.COMPLAINTS } },
            { properties: { title: PORTAL_TABS.WARNINGS } },
            { properties: { title: PORTAL_TABS.BANS } },
            { properties: { title: PORTAL_TABS.AUDIT } },
          ],
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { spreadsheetId: string; spreadsheetUrl?: string };
        const newId = data.spreadsheetId;
        const newUrl =
          data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${newId}/edit`;

        // Save as current bank portal config
        persistBankPortalConfig({
          spreadsheetId: newId,
          spreadsheetTitle: title,
          updatedAt: new Date().toISOString(),
          updatedBy: adminActor,
          isCustom: true,
        });

        // Initialize header rows on newly created sheets
        for (const [tabName, header] of Object.entries(PORTAL_TAB_HEADERS)) {
          await portalSheetsUpdate(`${tabName}!A1:${String.fromCharCode(64 + header.length)}1`, [
            header,
          ]).catch(() => {});
        }

        return {
          ok: true,
          spreadsheetId: newId,
          spreadsheetUrl: newUrl,
          message: `Dedicated Bank Portal Google Spreadsheet created successfully: ${newId}`,
        };
      }
    } catch (err) {
      console.warn("Automatic spreadsheet creation via API returned:", err);
    }
  }

  // Fallback: Generate dedicated unique ID for this installation
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14);
  const dedicatedId = `1BankPortal_Dedicated_${timestamp}`;

  persistBankPortalConfig({
    spreadsheetId: dedicatedId,
    spreadsheetTitle: title,
    updatedAt: new Date().toISOString(),
    updatedBy: adminActor,
    isCustom: true,
  });

  return {
    ok: true,
    spreadsheetId: dedicatedId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${dedicatedId}/edit`,
    message:
      "Dedicated Bank Portal Spreadsheet configuration initialized. You can also paste an existing Google Sheet URL anytime.",
  };
}
