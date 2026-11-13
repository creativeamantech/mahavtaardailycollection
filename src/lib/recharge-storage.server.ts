// Server-only, idempotent provisioning for Recharge Management storage.
const GATEWAY = "https://connector-gateway.lovable.dev";
const APP_KEY = "mahavtaarDailyCollection";
const APP_VALUE = "recharge-management-v1";
const SPREADSHEET_NAME = "Mahavtaar Recharge Management";
const FOLDER_NAME = "Mahavtaar Recharge";
const SHEETS_KEY = "GOOGLE_SHEETS_API_KEY";
const DRIVE_KEY = "GOOGLE_DRIVE_API_KEY";

type DriveFile = { id: string; name: string; mimeType?: string; parents?: string[] };
type Spreadsheet = { spreadsheetId: string };

let provisionPromise: Promise<{ spreadsheetId: string; folderId: string }> | undefined;

function connectorHeaders(keyName: string) {
  const lovable = process.env["LOVABLE_API_KEY"];
  const connection = process.env[keyName];
  if (!lovable || !connection) throw new Error("Recharge storage connectors are not configured.");
  return {
    Authorization: "Bearer " + lovable,
    "X-Connection-Api-Key": connection,
    "Content-Type": "application/json",
  };
}

async function driveRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(GATEWAY + "/google_drive/drive/v3" + path, {
    ...init,
    headers: { ...connectorHeaders(DRIVE_KEY), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(
      "Google Drive provisioning failed (" +
        response.status +
        "): " +
        (await response.text()).slice(0, 300),
    );
  return response.json() as Promise<T>;
}

async function sheetsRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(GATEWAY + "/google_sheets/v4" + path, {
    ...init,
    headers: { ...connectorHeaders(SHEETS_KEY), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(
      "Google Sheets provisioning failed (" +
        response.status +
        "): " +
        (await response.text()).slice(0, 300),
    );
  return response.json() as Promise<T>;
}

async function findOwnedDriveFile(mimeType: string): Promise<DriveFile | undefined> {
  const q =
    "trashed = false and mimeType = '" +
    mimeType +
    "' and appProperties has { key='" +
    APP_KEY +
    "' and value='" +
    APP_VALUE +
    "' }";
  const params = new URLSearchParams({
    q,
    pageSize: "10",
    fields: "files(id,name,mimeType,parents)",
  });
  const result = await driveRequest<{ files?: DriveFile[] }>("/files?" + params.toString());
  return result.files?.[0];
}

async function ensureFolder(): Promise<string> {
  const existing = await findOwnedDriveFile("application/vnd.google-apps.folder");
  if (existing?.id) return existing.id;
  const created = await driveRequest<DriveFile>("/files?fields=id,name,mimeType", {
    method: "POST",
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
      appProperties: { [APP_KEY]: APP_VALUE },
    }),
  });
  if (!created.id) throw new Error("Google Drive did not return the Recharge folder ID.");
  return created.id;
}

async function ensureSpreadsheet(folderId: string): Promise<string> {
  const existing = await findOwnedDriveFile("application/vnd.google-apps.spreadsheet");
  if (existing?.id) {
    const parents = existing.parents ?? [];
    if (!parents.includes(folderId)) {
      await driveRequest(
        "/files/" +
          encodeURIComponent(existing.id) +
          "?addParents=" +
          encodeURIComponent(folderId) +
          "&fields=id,parents",
        { method: "PATCH", body: JSON.stringify({ appProperties: { [APP_KEY]: APP_VALUE } }) },
      );
    }
    return existing.id;
  }

  const created = await sheetsRequest<Spreadsheet>("/spreadsheets", {
    method: "POST",
    body: JSON.stringify({
      properties: { title: SPREADSHEET_NAME },
      sheets: [
        { properties: { title: "Sheet1", gridProperties: { rowCount: 1000, columnCount: 11 } } },
        { properties: { title: "Credits", gridProperties: { rowCount: 2000, columnCount: 12 } } },
        {
          properties: {
            title: "Executive Numbers",
            gridProperties: { rowCount: 500, columnCount: 8 },
          },
        },
      ],
    }),
  });
  if (!created.spreadsheetId)
    throw new Error("Google Sheets did not return the new spreadsheet ID.");

  const spreadsheetId = created.spreadsheetId;
  await driveRequest(
    "/files/" +
      encodeURIComponent(spreadsheetId) +
      "?addParents=" +
      encodeURIComponent(folderId) +
      "&fields=id,parents,appProperties",
    {
      method: "PATCH",
      body: JSON.stringify({ appProperties: { [APP_KEY]: APP_VALUE } }),
    },
  );
  await sheetsRequest(
    "/spreadsheets/" + encodeURIComponent(spreadsheetId) + "/values:batchUpdate",
    {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: [
          {
            range: "'Sheet1'!A1:K1",
            values: [
              [
                "Request ID",
                "Executive ID",
                "Executive Name",
                "Calling Number",
                "Recharge Amount",
                "Screenshot URL",
                "Recharge DateTime",
                "Status",
                "Admin Note",
                "Created At",
                "Reviewed At",
              ],
            ],
          },
          {
            range: "'Credits'!A1:L1",
            values: [
              [
                "Credit ID",
                "Executive ID",
                "Executive Name",
                "Total Credited Amount",
                "Credited DateTime",
                "Credit Month",
                "Credited By",
                "Payment Screenshot URL",
                "Transfer Reference",
                "Admin Note",
                "Available Balance",
                "Admin Note",
              ],
            ],
          },
          {
            range: "'Executive Numbers'!A1:H1",
            values: [
              [
                "Executive ID",
                "Executive Name",
                "Calling Number 1",
                "Calling Number 2",
                "Active",
                "Updated At",
                "Updated By",
                "Notes",
              ],
            ],
          },
        ],
      }),
    },
  );
  return spreadsheetId;
}

export async function ensureRechargeStorage(): Promise<{
  spreadsheetId: string;
  folderId: string;
}> {
  if (!provisionPromise) {
    provisionPromise = (async () => {
      const folderId = await ensureFolder();
      const spreadsheetId = await ensureSpreadsheet(folderId);
      return { spreadsheetId, folderId };
    })().catch((error) => {
      provisionPromise = undefined;
      throw error;
    });
  }
  return provisionPromise;
}

export async function uploadRechargeProof(
  name: string,
  mimeType: string,
  base64: string,
): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType))
    throw new Error("Only JPEG, PNG, and WebP screenshots are allowed.");
  const clean = base64.replace(/^data:[^,]+,/, "").replace(/\s/g, "");
  if (!clean || clean.length > 16_800_000) throw new Error("Screenshot exceeds the 12 MB limit.");
  const binary = atob(clean);
  if (binary.length > 12 * 1024 * 1024) throw new Error("Screenshot exceeds the 12 MB limit.");
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const valid =
    mimeType === "image/jpeg"
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : mimeType === "image/png"
        ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => bytes[i] === v)
        : String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
          String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!valid) throw new Error("Screenshot content does not match its file type.");
  const { folderId } = await ensureRechargeStorage();
  const safeName =
    name
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}._-]+/gu, "_")
      .replace(/^\.+/, "")
      .slice(0, 90) || "recharge-proof";
  const boundary = "mahavtaarrecharge" + crypto.randomUUID().replace(/-/g, "");
  const metadata = JSON.stringify({ name: safeName, parents: [folderId] });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${clean}\r\n--${boundary}--`;
  const response = await fetch(
    GATEWAY + "/google_drive/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        ...connectorHeaders(DRIVE_KEY),
        "Content-Type": "multipart/related; boundary=" + boundary,
      },
      body,
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) throw new Error("Recharge screenshot upload failed (" + response.status + ").");
  const file = (await response.json()) as { id?: string };
  if (!file.id) throw new Error("Google Drive did not return the screenshot file ID.");
  return "/receipt/" + file.id;
}
