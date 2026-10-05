// Server-side helpers for Mahavtaar Daily Collection.
// Connected to the Google Drive / Google Sheets file via the connector gateway.
// Zero mock data.

export const SPREADSHEET_ID = "1AXLakW3subO9H-O9iWIpXJyjT4JLXRTG5uiL3dWsY5g";
export const DRIVE_FOLDER_ID = "1iBlXqe09aG5kA_hHf3WtFILnA1RibCf7";
const GATEWAY = "https://connector-gateway.lovable.dev";

export function isGatewayConfigured(): boolean {
  return Boolean(process.env["LOVABLE_API_KEY"] && process.env["GOOGLE_SHEETS_API_KEY"]);
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

export function invalidateSheetsCache() {
  readCache.clear();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchRange(range: string): Promise<string[][]> {
  const url = `${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`;
  const maxAttempts = 4;
  let delay = 600;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, {
      headers: headers("GOOGLE_SHEETS_API_KEY"),
    });

    if (res.status === 429) {
      if (attempt === maxAttempts) {
        throw new Error(
          `Sheets rate limit reached (429) after ${maxAttempts} attempts for ${range}`,
        );
      }
      await sleep(delay);
      delay *= 2;
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Sheets get failed [${res.status}] for ${range}: ${body}`);
    }

    const data = (await res.json()) as { values?: string[][] };
    return data.values ?? [];
  }

  return [];
}

// Clean in-memory store initialized with table schemas only (zero mock data)
const store: Record<string, string[][]> = {
  Collections: [
    [
      "Executive",
      "Loan ID",
      "Amount",
      "Date",
      "Time",
      "Created At",
      "Status",
      "Entry Date",
      "Entry Type",
      "Settlement",
      "Bucket",
      "City",
      "EMI Amount",
      "POS",
      "Foreclosure",
      "Receipt Links",
      "Remark",
    ],
  ],
  Pending: [
    [
      "Executive",
      "Loan Number",
      "Amount",
      "Photo Links",
      "Status",
      "Created At",
      "ID",
      "Settlement",
    ],
  ],
  ECS_Special_Info: [
    [
      "ID",
      "Executive",
      "Loan ID",
      "Amount",
      "Payment Type",
      "Payment Date",
      "Entry Date",
      "Entry Time",
      "Status",
      "Remark",
      "Created At",
      "Updated At",
    ],
  ],
  AppSettings: [
    ["Key", "Value"],
    ["entry", "ON"],
    ["report", "ON"],
    ["loans", "ON"],
    ["pending", "ON"],
    ["ecs", "ON"],
    ["remarks", "ON"],
  ],
  Notifications: [["Notification", "Image URL", "Status", "Created At", "ID"]],
};

function parseColLetter(colStr: string): number {
  let num = 0;
  for (let i = 0; i < colStr.length; i++) {
    num = num * 26 + (colStr.charCodeAt(i) - 64);
  }
  return num - 1;
}

function parseA1Range(range: string): {
  sheetName: string;
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
} {
  const [sheetName = "Collections", cellRange = ""] = range.split("!");
  const parts = cellRange.split(":");
  const first = parts[0] || "A1";
  const second = parts[1] || first;

  const matchFirst = first.match(/^([A-Za-z]+)?(\d+)?$/);
  const matchSecond = second.match(/^([A-Za-z]+)?(\d+)?$/);

  const startColStr = matchFirst?.[1] || "A";
  const startRowStr = matchFirst?.[2];
  const endColStr = matchSecond?.[1] || startColStr;
  const endRowStr = matchSecond?.[2];

  const startCol = parseColLetter(startColStr.toUpperCase());
  const endCol = parseColLetter(endColStr.toUpperCase());
  const startRow = startRowStr ? parseInt(startRowStr, 10) : 1;
  const endRow = endRowStr ? parseInt(endRowStr, 10) : Infinity;

  return { sheetName, startCol, startRow, endCol, endRow };
}

function getOrCreateSheet(name: string): string[][] {
  if (!store[name]) {
    store[name] = [];
  }
  return store[name]!;
}

export async function sheetsGet(range: string): Promise<string[][]> {
  if (isGatewayConfigured()) {
    const cached = readCache.get(range);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.rows;
    }

    const existing = inFlight.get(range);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      try {
        const rows = await fetchRange(range);
        readCache.set(range, { at: Date.now(), rows });
        return rows;
      } finally {
        inFlight.delete(range);
      }
    })();

    inFlight.set(range, promise);
    return promise;
  }

  // Self-contained store (zero mock data)
  const { sheetName, startCol, startRow, endCol, endRow } = parseA1Range(range);
  const sheet = store[sheetName] ?? [];
  const result: string[][] = [];
  const maxRow = Math.min(sheet.length, endRow === Infinity ? sheet.length : endRow);
  for (let r = startRow - 1; r < maxRow; r++) {
    const row = sheet[r] || [];
    const sliced: string[] = [];
    for (let c = startCol; c <= endCol; c++) {
      sliced.push(row[c] ?? "");
    }
    result.push(sliced);
  }
  return result;
}

export async function sheetsAppend(range: string, values: (string | number)[][]) {
  invalidateSheetsCache();

  if (isGatewayConfigured()) {
    const url = `${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...headers("GOOGLE_SHEETS_API_KEY"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values }),
    });
    return ok(res, `sheetsAppend(${range})`);
  }

  const { sheetName } = parseA1Range(range);
  const sheet = getOrCreateSheet(sheetName);
  const startRowNum = sheet.length + 1;
  for (const row of values) {
    sheet.push(row.map((v) => String(v ?? "")));
  }
  const endRowNum = sheet.length;
  return {
    updates: {
      updatedRange: `${sheetName}!A${startRowNum}:J${endRowNum}`,
      updatedRows: values.length,
    },
  };
}

export async function sheetsUpdate(range: string, values: (string | number)[][]) {
  invalidateSheetsCache();

  if (isGatewayConfigured()) {
    const url = `${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        ...headers("GOOGLE_SHEETS_API_KEY"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values }),
    });
    return ok(res, `sheetsUpdate(${range})`);
  }

  const { sheetName, startCol, startRow } = parseA1Range(range);
  const sheet = getOrCreateSheet(sheetName);
  for (let rIdx = 0; rIdx < values.length; rIdx++) {
    const targetRowIdx = startRow - 1 + rIdx;
    while (sheet.length <= targetRowIdx) {
      sheet.push([]);
    }
    const row = sheet[targetRowIdx]!;
    const rowValues = values[rIdx]!;
    for (let cIdx = 0; cIdx < rowValues.length; cIdx++) {
      const targetColIdx = startCol + cIdx;
      while (row.length <= targetColIdx) {
        row.push("");
      }
      row[targetColIdx] = String(rowValues[cIdx] ?? "");
    }
  }
  return { updatedRows: values.length };
}

const sheetIdCache: Record<string, number> = {};

export async function getSheetId(title: string): Promise<number> {
  const cached = sheetIdCache[title];
  if (typeof cached === "number") return cached;

  if (isGatewayConfigured()) {
    const res = await fetch(
      `${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`,
      { headers: headers("GOOGLE_SHEETS_API_KEY") },
    );
    const data = (await ok(res, "getSheetId")) as {
      sheets?: { properties: { sheetId: number; title: string } }[];
    };
    for (const s of data.sheets ?? []) {
      sheetIdCache[s.properties.title] = s.properties.sheetId;
    }
    const id = sheetIdCache[title];
    if (typeof id === "number") return id;
    throw new Error(`Sheet tab "${title}" not found in spreadsheet.`);
  }

  const titles = Object.keys(store);
  let idx = titles.indexOf(title);
  if (idx === -1) {
    store[title] = [];
    idx = Object.keys(store).indexOf(title);
  }
  sheetIdCache[title] = idx;
  return idx;
}

export async function sheetsBatchUpdate(requests: unknown[]) {
  invalidateSheetsCache();

  if (isGatewayConfigured()) {
    const res = await fetch(
      `${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
      {
        method: "POST",
        headers: {
          ...headers("GOOGLE_SHEETS_API_KEY"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requests }),
      },
    );
    return ok(res, "sheetsBatchUpdate");
  }

  return { replies: [] };
}

export async function driveUpload(name: string, mimeType: string, base64: string) {
  if (isGatewayConfigured()) {
    const boundary = "-------314159265358979323846";
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadata = JSON.stringify({ name, parents: [DRIVE_FOLDER_ID] });
    const multipartBody =
      delimiter +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      metadata +
      delimiter +
      `Content-Type: ${mimeType}\r\n` +
      "Content-Transfer-Encoding: base64\r\n\r\n" +
      base64 +
      closeDelimiter;

    const res = await fetch(
      `${GATEWAY}/google_drive/v3/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink`,
      {
        method: "POST",
        headers: {
          ...headers("GOOGLE_DRIVE_API_KEY"),
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      },
    );

    const data = (await ok(res, "driveUpload")) as { id: string; webViewLink?: string };
    return data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view`;
  }

  if (base64 && base64.length < 500000) {
    return `data:${mimeType};base64,${base64}`;
  }
  return `data:${mimeType};base64,${base64.slice(0, 100)}...`;
}

export async function ensureSheet(title: string, header?: string[]) {
  if (isGatewayConfigured()) {
    try {
      return await getSheetId(title);
    } catch {
      await sheetsBatchUpdate([{ addSheet: { properties: { title } } }]);
      delete sheetIdCache[title];
      if (header && header.length > 0) {
        await sheetsAppend(`${title}!A1`, [header]);
      }
      return await getSheetId(title);
    }
  }

  if (!store[title]) {
    store[title] = header ? [header] : [];
  }
  return getSheetId(title);
}
