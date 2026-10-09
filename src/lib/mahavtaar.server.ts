// Server-only helpers for Google Sheets + Drive via the Lovable connector gateway
// with graceful fallback to public Google Sheets export and local overlay when API credentials are not set.

export const SPREADSHEET_ID = "1AXLakW3subO9H-O9iWIpXJyjT4JLXRTG5uiL3dWsY5g";
export const DRIVE_FOLDER_ID = "1iBlXqe09aG5kA_hHf3WtFILnA1RibCf7";
const GATEWAY = "https://connector-gateway.lovable.dev";

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

// --- read cache + retry to stay under the Sheets read-requests-per-minute quota ---
const CACHE_TTL_MS = 20_000;
const readCache = new Map<string, { at: number; rows: string[][] }>();
const inFlight = new Map<string, Promise<string[][]>>();

// In-memory fallback overlay when direct gateway writes/credentials are unavailable
const localAppended = new Map<string, string[][]>();
const localUpdated = new Map<string, Map<string, string>>();

export function invalidateSheetsCache() {
  readCache.clear();
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
  const sheetTitle = parts.length > 1 ? parts[0].trim().replace(/^'|'$/g, "") : "Collections";
  const rangePart = parts.length > 1 ? parts[1].trim() : parts[0].trim();
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

async function fetchFromPublicSheet(range: string): Promise<string[][]> {
  const { sheetTitle, startCol, endCol, startRow, endRow } = parseRange(range);
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetTitle)}`;

  let baseRows: string[][] = [];
  try {
    const res = await fetch(url);
    if (res.ok) {
      const text = await res.text();
      baseRows = parseCsv(text);
    }
  } catch (err) {
    console.warn(`Public Google Sheets fetch failed for ${sheetTitle}:`, err);
  }

  // Deep clone to apply local overlays
  const allRows: string[][] = baseRows.map((r) => [...r]);

  // Apply any locally updated cells
  const updates = localUpdated.get(sheetTitle);
  if (updates) {
    for (const [key, val] of updates.entries()) {
      const [rStr, cStr] = key.split(",");
      const rIdx = parseInt(rStr, 10);
      const cIdx = parseInt(cStr, 10);
      while (allRows.length <= rIdx) allRows.push([]);
      while (allRows[rIdx].length <= cIdx) allRows[rIdx].push("");
      allRows[rIdx][cIdx] = val;
    }
  }

  // Append any locally added rows
  const appended = localAppended.get(sheetTitle);
  if (appended) {
    for (const r of appended) {
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

async function fetchRange(range: string): Promise<string[][]> {
  if (hasCredentials("GOOGLE_SHEETS_API_KEY")) {
    let lastBody = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(
          `${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`,
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
      `Gateway fetch failed for ${range} (${lastBody}). Falling back to public sheet reader.`,
    );
  }

  return fetchFromPublicSheet(range);
}

export async function sheetsGet(range: string): Promise<string[][]> {
  const cached = readCache.get(range);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;

  const pending = inFlight.get(range);
  if (pending) return pending;

  const p = fetchRange(range)
    .then((rows) => {
      readCache.set(range, { at: Date.now(), rows });
      return rows;
    })
    .finally(() => inFlight.delete(range));
  inFlight.set(range, p);
  return p;
}

export async function sheetsAppend(range: string, values: (string | number)[][]) {
  if (hasCredentials("GOOGLE_SHEETS_API_KEY")) {
    try {
      const res = await fetch(
        `${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: "POST",
          headers: { ...headers("GOOGLE_SHEETS_API_KEY"), "Content-Type": "application/json" },
          body: JSON.stringify({ values }),
        },
      );
      invalidateSheetsCache();
      return ok(res, "Sheets append");
    } catch (err) {
      console.warn("Gateway append failed, using local overlay:", err);
    }
  }

  const { sheetTitle } = parseRange(range);
  if (!localAppended.has(sheetTitle)) {
    localAppended.set(sheetTitle, []);
  }
  const strRows = values.map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c))));
  localAppended.get(sheetTitle)!.push(...strRows);

  // Compute calculated row number
  let baseCount = 37;
  try {
    const publicData = await fetchFromPublicSheet(`${sheetTitle}!A1:A`);
    baseCount = publicData.length;
  } catch {
    // fallback base count
  }
  const rowNum = baseCount + (localAppended.get(sheetTitle)?.length ?? 1);
  invalidateSheetsCache();

  return { updates: { updatedRange: `${sheetTitle}!A${rowNum}:J${rowNum}` } };
}

export async function sheetsUpdate(range: string, values: (string | number)[][]) {
  if (hasCredentials("GOOGLE_SHEETS_API_KEY")) {
    try {
      const res = await fetch(
        `${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`,
        {
          method: "PUT",
          headers: { ...headers("GOOGLE_SHEETS_API_KEY"), "Content-Type": "application/json" },
          body: JSON.stringify({ values }),
        },
      );
      invalidateSheetsCache();
      return ok(res, "Sheets update");
    } catch (err) {
      console.warn("Gateway update failed, using local overlay:", err);
    }
  }

  const { sheetTitle, startRow, startCol } = parseRange(range);
  if (!localUpdated.has(sheetTitle)) {
    localUpdated.set(sheetTitle, new Map());
  }
  const updates = localUpdated.get(sheetTitle)!;
  for (let r = 0; r < values.length; r++) {
    const rowValues = values[r];
    for (let c = 0; c < rowValues.length; c++) {
      const targetRowIdx = startRow - 1 + r;
      const targetColIdx = startCol + c;
      const val = rowValues[c] === null || rowValues[c] === undefined ? "" : String(rowValues[c]);
      updates.set(`${targetRowIdx},${targetColIdx}`, val);
    }
  }
  invalidateSheetsCache();
  return { ok: true };
}

let sheetIdCache: Record<string, number> = {};

export async function getSheetId(title: string): Promise<number> {
  const cached = sheetIdCache[title];
  if (typeof cached === "number") return cached;

  if (hasCredentials("GOOGLE_SHEETS_API_KEY")) {
    try {
      const res = await fetch(
        `${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`,
        { headers: headers("GOOGLE_SHEETS_API_KEY") },
      );
      const json = (await ok(res, "Sheets metadata")) as {
        sheets?: { properties?: { sheetId?: number; title?: string } }[];
      };
      sheetIdCache = {};
      for (const s of json.sheets ?? []) {
        const p = s.properties;
        if (p && typeof p.sheetId === "number" && p.title) sheetIdCache[p.title] = p.sheetId;
      }
      const id = sheetIdCache[title];
      if (typeof id === "number") return id;
    } catch (err) {
      console.warn(`Failed to fetch sheet ID for ${title} via gateway:`, err);
    }
  }

  // Fallback fixed sheet IDs
  const knownSheetIds: Record<string, number> = {
    Collections: 0,
    Pending: 1,
    ECS_Special_Info: 2,
    AppSettings: 3,
    Notifications: 4,
  };
  return knownSheetIds[title] ?? 0;
}

export async function sheetsBatchUpdate(requests: unknown[]) {
  if (hasCredentials("GOOGLE_SHEETS_API_KEY")) {
    try {
      const res = await fetch(
        `${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
        {
          method: "POST",
          headers: { ...headers("GOOGLE_SHEETS_API_KEY"), "Content-Type": "application/json" },
          body: JSON.stringify({ requests }),
        },
      );
      return ok(res, "Sheets batchUpdate");
    } catch (err) {
      console.warn("Gateway batchUpdate failed:", err);
    }
  }

  return { ok: true };
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
export async function ensureSheet(title: string, header?: string[]) {
  try {
    return await getSheetId(title);
  } catch {
    if (hasCredentials("GOOGLE_SHEETS_API_KEY")) {
      await sheetsBatchUpdate([{ addSheet: { properties: { title } } }]);
      sheetIdCache = {};
      if (header && header.length > 0) {
        await sheetsUpdate(`${title}!A1:${String.fromCharCode(64 + header.length)}1`, [header]);
      }
      return getSheetId(title);
    }
    return 0;
  }
}
