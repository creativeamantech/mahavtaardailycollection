import { createServerFn } from "@tanstack/react-start";
import { requireSession } from "./auth.functions";

const GATEWAY = "https://connector-gateway.lovable.dev";
const monthTitle = () =>
  "Mahavtaar Master Allocation " +
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", month: "long", year: "numeric" }).format(new Date());

export const initializeMasterAllocation = createServerFn({ method: "POST" }).handler(async () => {
  await requireSession("Admin");
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const sheetsKey = process.env["GOOGLE_SHEETS_API_KEY"];
  const driveKey = process.env["GOOGLE_DRIVE_API_KEY"];
  if (!lovableKey || !sheetsKey || !driveKey) {
    throw new Error("Google Sheets and Drive connectors are not configured.");
  }
  const title = monthTitle();
  const headers = (key: string) => ({
    Authorization: "Bearer " + lovableKey,
    "X-Connection-Api-Key": key,
    "Content-Type": "application/json",
  });
  const driveUrl = new URL(GATEWAY + "/google_drive/drive/v3/files");
  driveUrl.searchParams.set("q", "name = '" + title.replace(/'/g, "\\'") + "' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false");
  driveUrl.searchParams.set("fields", "files(id,name,webViewLink)");
  driveUrl.searchParams.set("pageSize", "10");
  const search = await fetch(driveUrl, { headers: headers(driveKey), signal: AbortSignal.timeout(20000) });
  if (!search.ok) throw new Error("Could not check Drive for the monthly spreadsheet (" + search.status + "): " + (await search.text()).slice(0, 300));
  const found = (await search.json()) as { files?: { id: string; name: string; webViewLink?: string }[] };
  const existing = found.files?.[0];
  if (existing) {
    return { created: false, title, spreadsheetId: existing.id, url: existing.webViewLink || "https://docs.google.com/spreadsheets/d/" + existing.id + "/edit" };
  }
  const create = await fetch(GATEWAY + "/google_sheets/v4/spreadsheets", {
    method: "POST",
    headers: headers(sheetsKey),
    body: JSON.stringify({ properties: { title }, sheets: [{ properties: { title: "Sheet1", index: 0 } }] }),
    signal: AbortSignal.timeout(25000),
  });
  if (!create.ok) throw new Error("Spreadsheet creation failed (" + create.status + "): " + (await create.text()).slice(0, 300));
  const result = (await create.json()) as { spreadsheetId?: string; spreadsheetUrl?: string; properties?: { title?: string } };
  if (!result.spreadsheetId) throw new Error("Google did not return a spreadsheet ID.");
  return { created: true, title, spreadsheetId: result.spreadsheetId, url: result.spreadsheetUrl || "https://docs.google.com/spreadsheets/d/" + result.spreadsheetId + "/edit" };
});
