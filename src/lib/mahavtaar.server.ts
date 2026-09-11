// Server-only helpers for Google Sheets + Drive via the Lovable connector gateway.

export const SPREADSHEET_ID = "1AXLakW3subO9H-O9iWIpXJyjT4JLXRTG5uiL3dWsY5g";
export const DRIVE_FOLDER_ID = "1iBlXqe09aG5kA_hHf3WtFILnA1RibCf7";
const GATEWAY = "https://connector-gateway.lovable.dev";

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
  let lastBody = "";
  for (let attempt = 0; attempt < 4; attempt++) {
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
    if (!retryable || attempt === 3) {
      console.error(`Sheets read failed [${res.status}]: ${lastBody}`);
      throw new Error(`Sheets read failed [${res.status}]: ${lastBody}`);
    }
    await sleep(600 * 2 ** attempt + Math.random() * 300);
  }
  throw new Error(`Sheets read failed: ${lastBody}`);
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
}

export async function sheetsUpdate(range: string, values: (string | number)[][]) {
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
}

let sheetIdCache: Record<string, number> = {};

export async function getSheetId(title: string): Promise<number> {
  const cached = sheetIdCache[title];
  if (typeof cached === "number") return cached;
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
  if (typeof id !== "number") throw new Error(`Sheet tab "${title}" not found.`);
  return id;
}

export async function sheetsBatchUpdate(requests: unknown[]) {
  const res = await fetch(
    `${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
    {
      method: "POST",
      headers: { ...headers("GOOGLE_SHEETS_API_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    },
  );
  return ok(res, "Sheets batchUpdate");
}

export async function driveUpload(name: string, mimeType: string, base64: string) {
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
}

// Creates a tab (with optional header row) when it does not exist yet.
export async function ensureSheet(title: string, header?: string[]) {
  try {
    return await getSheetId(title);
  } catch {
    await sheetsBatchUpdate([{ addSheet: { properties: { title } } }]);
    sheetIdCache = {};
    if (header && header.length > 0) {
      await sheetsUpdate(`${title}!A1:${String.fromCharCode(64 + header.length)}1`, [header]);
    }
    return getSheetId(title);
  }
}
