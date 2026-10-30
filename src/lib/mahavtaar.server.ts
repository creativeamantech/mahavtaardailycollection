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

export function requireGoogleSheetsWriteAccess() {
  if (!hasCredentials("GOOGLE_SHEETS_API_KEY")) {
    throw new Error("Google Sheets write connector is not configured. Verification was not saved.");
  }
}

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
      const rIdx = parseInt(rStr ?? "0", 10);
      const cIdx = parseInt(cStr ?? "0", 10);
      while (allRows.length <= rIdx) allRows.push([]);
      const rowArr = allRows[rIdx]!;
      while (rowArr.length <= cIdx) rowArr.push("");
      rowArr[cIdx] = val;
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

export async function sheetsGetCellLinks(range: string): Promise<Record<number, string>> {
  if (!hasCredentials("GOOGLE_SHEETS_API_KEY")) return {};
  try {
    const url = new URL(`${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}`);
    url.searchParams.set("includeGridData", "true");
    url.searchParams.set("ranges", range);
    url.searchParams.set(
      "fields",
      "sheets(data(startRow,startColumn,rowData(values(hyperlink,userEnteredValue,textFormatRuns,effectiveFormat(textFormat(link))))))",
    );
    const res = await fetch(url, { headers: headers("GOOGLE_SHEETS_API_KEY") });
    const json = (await ok(res, "Sheets hyperlink metadata")) as {
      sheets?: Array<{
        data?: Array<{
          startRow?: number;
          startColumn?: number;
          rowData?: Array<{
            values?: Array<{
              hyperlink?: string;
              userEnteredValue?: { formulaValue?: string };
              textFormatRuns?: Array<{ format?: { link?: { uri?: string } } }>;
              effectiveFormat?: { textFormat?: { link?: { uri?: string } } };
            }>;
          }>;
        }>;
      }>;
    };
    const links: Record<number, string> = {};
    for (const sheet of json.sheets ?? []) {
      for (const grid of sheet.data ?? []) {
        const firstRow = grid.startRow ?? 0;
        for (let index = 0; index < (grid.rowData ?? []).length; index++) {
          const cell = grid.rowData?.[index]?.values?.[0];
          if (!cell) continue;
          let href = cell.hyperlink || cell.textFormatRuns?.find((run) => run.format?.link?.uri)?.format?.link?.uri || cell.effectiveFormat?.textFormat?.link?.uri || "";
          const formula = cell.userEnteredValue?.formulaValue ?? "";
          if (!href && /^=HYPERLINK\(/i.test(formula)) {
            const match = formula.match(/^=HYPERLINK\(\s*"([^"]+)"/i);
            href = match?.[1] ?? "";
          }
          if (/^https:\/\//i.test(href)) links[firstRow + index + 1] = href;
        }
      }
    }
    return links;
  } catch (err) {
    console.warn("Could not read linked-name hyperlink metadata:", err);
    return {};
  }
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

export async function sheetsAppendStrict(range: string, values: (string | number)[][]) {
  requireGoogleSheetsWriteAccess();
  const res = await fetch(
    `${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { ...headers("GOOGLE_SHEETS_API_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    },
  );
  const result = await ok(res, "Strict Sheets append");
  invalidateSheetsCache();
  return result;
}

export async function sheetsUpdateStrict(range: string, values: (string | number)[][]) {
  requireGoogleSheetsWriteAccess();
  const res = await fetch(
    `${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { ...headers("GOOGLE_SHEETS_API_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    },
  );
  const result = await ok(res, "Strict Sheets update");
  invalidateSheetsCache();
  return result;
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
    const rowValues = values[r] ?? [];
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
    "Cashier Link Activity": 5,
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

// Downloads a Drive receipt and uses Drive's server-side image-to-Google-Docs OCR conversion.
// The temporary Google Doc is exported as plain text and deleted in a finally block.
export async function ocrDriveReceipt(fileId: string, language = "hi") {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(fileId)) throw new Error("Invalid Google Drive file ID.");
  if (!hasCredentials("GOOGLE_DRIVE_API_KEY")) {
    throw new Error("Google Drive connector credentials are not configured (GOOGLE_DRIVE_API_KEY).");
  }
  const auth = headers("GOOGLE_DRIVE_API_KEY");
  const base = GATEWAY + "/google_drive/drive/v3/files/" + encodeURIComponent(fileId);
  const metaRes = await fetch(base + "?fields=id,name,mimeType,size,trashed", { headers: auth });
  const meta = (await ok(metaRes, "Drive receipt metadata")) as {
    id: string; name?: string; mimeType?: string; size?: string; trashed?: boolean;
  };
  if (meta.trashed) throw new Error("Receipt file is in the Drive trash.");
  if (!meta.mimeType?.startsWith("image/")) throw new Error("Receipt must be an image.");
  if (Number(meta.size ?? 0) > 12 * 1024 * 1024) throw new Error("Receipt image exceeds the 12 MB OCR limit.");

  const imageRes = await fetch(base + "?alt=media", { headers: auth });
  if (!imageRes.ok) throw new Error("Could not download receipt image (" + imageRes.status + ").");
  const imageBytes = new Uint8Array(await imageRes.arrayBuffer());
  if (!imageBytes.length) throw new Error("Google Drive returned an empty receipt image.");
  if (imageBytes.length > 12 * 1024 * 1024) throw new Error("Receipt image exceeds the 12 MB OCR limit.");

  const boundary = "mahaOcr" + Math.random().toString(36).slice(2);
  const metadata = JSON.stringify({
    name: "TEMP-OCR-" + fileId + "-" + Date.now(),
    mimeType: "application/vnd.google-apps.document",
  });
  const encoder = new TextEncoder();
  const prefix = encoder.encode(
    "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + metadata + "\r\n" +
    "--" + boundary + "\r\nContent-Type: " + meta.mimeType + "\r\n\r\n",
  );
  const suffix = encoder.encode("\r\n--" + boundary + "--\r\n");
  const multipart = new Uint8Array(prefix.length + imageBytes.length + suffix.length);
  multipart.set(prefix, 0);
  multipart.set(imageBytes, prefix.length);
  multipart.set(suffix, prefix.length + imageBytes.length);

  let temporaryDocId: string | undefined;
  try {
    const convertRes = await fetch(
      GATEWAY + "/google_drive/upload/drive/v3/files?uploadType=multipart&ocrLanguage=" +
        encodeURIComponent(language) + "&fields=id,name,mimeType",
      {
        method: "POST",
        headers: { ...auth, "Content-Type": "multipart/related; boundary=" + boundary },
        body: multipart,
      },
    );
    const converted = (await ok(convertRes, "Receipt OCR conversion")) as { id?: string };
    temporaryDocId = converted.id;
    if (!temporaryDocId) throw new Error("Drive OCR conversion did not return a temporary document ID.");

    const exportRes = await fetch(
      GATEWAY + "/google_drive/drive/v3/files/" + encodeURIComponent(temporaryDocId) +
        "/export?mimeType=text%2Fplain",
      { headers: auth },
    );
    if (!exportRes.ok) throw new Error("Could not export OCR text (" + exportRes.status + ").");
    const text = (await exportRes.text()).trim();
    return { fileId, fileName: meta.name ?? "", mimeType: meta.mimeType, text, characterCount: text.length };
  } finally {
    if (temporaryDocId) {
      await fetch(GATEWAY + "/google_drive/drive/v3/files/" + encodeURIComponent(temporaryDocId), {
        method: "DELETE",
        headers: auth,
      }).catch((err) => console.warn("Temporary OCR document cleanup failed:", err));
    }
  }
}

// Creates a tab (with optional header row) when it does not exist yet.
export async function ensureSheet(title: string, header?: string[]) {
  if (hasCredentials("GOOGLE_SHEETS_API_KEY")) {
    const res = await fetch(
      `${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`,
      { headers: headers("GOOGLE_SHEETS_API_KEY") },
    );
    const json = (await ok(res, "Sheets metadata")) as {
      sheets?: { properties?: { sheetId?: number; title?: string } }[];
    };
    const found = (json.sheets ?? []).some((sheet) => sheet.properties?.title === title);
    if (!found) {
      await sheetsBatchUpdate([{ addSheet: { properties: { title } } }]);
      sheetIdCache = {};
      if (header && header.length > 0) {
        const lastColumn = header.length <= 26
          ? String.fromCharCode(64 + header.length)
          : "A" + String.fromCharCode(64 + header.length - 26);
        await sheetsUpdate(`${title}!A1:${lastColumn}1`, [header]);
      }
    }
    return getSheetId(title);
  }
  return getSheetId(title);
}
