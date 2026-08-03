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

export async function sheetsGet(range: string): Promise<string[][]> {
  const res = await fetch(
    `${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`,
    { headers: headers("GOOGLE_SHEETS_API_KEY") },
  );
  const json = (await ok(res, "Sheets read")) as { values?: string[][] };
  return json.values ?? [];
}

export async function sheetsAppend(range: string, values: (string | number)[][]) {
  const res = await fetch(
    `${GATEWAY}/google_sheets/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { ...headers("GOOGLE_SHEETS_API_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    },
  );
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
  return ok(res, "Sheets update");
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
