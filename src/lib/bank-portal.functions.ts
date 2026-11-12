import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSession } from "./auth.functions";
import { withSheetMutex } from "./mahavtaar.server";

const GATEWAY = "https://connector-gateway.lovable.dev";
const MAX_SESSION_MINUTES = 60;
const BANK_PORTAL_EXECUTIVES = ["Aarti", "Ankita", "Bharti", "Julee", "Pooja", "Sunanda", "Vinita"] as const;
const TABS = {
  sessions: "Portal_Sessions",
  schedules: "Portal_Schedules",
  complaints: "Portal_Complaints",
  warnings: "Portal_Warnings",
  bans: "Portal_Bans",
  audit: "Portal_Audit",
  accessRequests: "Portal_Access_Requests",
  presets: "Portal_Schedule_Presets",
} as const;

function connectorHeaders() {
  const lovable = process.env["LOVABLE_API_KEY"];
  const sheets = process.env["GOOGLE_SHEETS_API_KEY"];
  if (!lovable || !sheets) throw new Error("Google Sheets connector is not configured.");
  return { Authorization: "Bearer " + lovable, "X-Connection-Api-Key": sheets, "Content-Type": "application/json" };
}
async function responseJson(res: Response, action: string) {
  if (!res.ok) throw new Error(action + " failed [" + res.status + "]: " + await res.text());
  return res.json();
}
async function spreadsheetId() {
  const configured = process.env["BANK_PORTAL_SPREADSHEET_ID"]?.trim();
  if (configured) return configured;
  try {
    const rows = await (await import("./mahavtaar.server")).sheetsGet("AppSettings!A2:B");
    const saved = rows.find((r) => (r[0] ?? "").trim() === "bankPortalSpreadsheetId")?.[1]?.trim();
    if (saved) return saved;
  } catch (error) { console.warn("Could not read Bank Portal spreadsheet setting:", error); }
  throw new Error("BANK_PORTAL_SPREADSHEET_ID is not configured and AppSettings.bankPortalSpreadsheetId is empty.");
}
async function ensureAccessRequestsTab() {
  const id = await spreadsheetId();
  const headers = ["Request_ID", "Requester", "Slot_Owner", "Requested_At", "Reason", "Duration_Minutes", "Status", "Approved_At", "Expires_At", "Slot_Ends_At"];
  const metadataRes = await fetch(GATEWAY + "/google_sheets/v4/spreadsheets/" + encodeURIComponent(id), { headers: connectorHeaders() });
  const metadata = await responseJson(metadataRes, "Inspect Bank Portal spreadsheet") as { sheets?: { properties?: { title?: string } }[] };
  if (metadata.sheets?.some((sheet) => sheet.properties?.title === TABS.accessRequests)) return;
  const createRes = await fetch(GATEWAY + "/google_sheets/v4/spreadsheets/" + encodeURIComponent(id) + ":batchUpdate", {
    method: "POST", headers: connectorHeaders(),
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TABS.accessRequests, gridProperties: { rowCount: 1000, columnCount: headers.length } } } }] }),
  });
  await responseJson(createRes, "Create Portal_Access_Requests tab");
  const headerUrl = GATEWAY + "/google_sheets/v4/spreadsheets/" + encodeURIComponent(id) + "/values/" + encodeURIComponent(TABS.accessRequests) + "!A1:I1?valueInputOption=RAW";
  await responseJson(await fetch(headerUrl, { method: "PUT", headers: connectorHeaders(), body: JSON.stringify({ values: [headers] }) }), "Initialize Portal_Access_Requests headers");
}
async function ensureSchedulePresetsTab() {
  const id = await spreadsheetId();
  const headers = ["Preset_ID", "Executive", "Slot", "Start_Time", "End_Time", "Updated_At", "Updated_By"];
  const metadataRes = await fetch(GATEWAY + "/google_sheets/v4/spreadsheets/" + encodeURIComponent(id), { headers: connectorHeaders() });
  const metadata = await responseJson(metadataRes, "Inspect Bank Portal spreadsheet") as { sheets?: { properties?: { title?: string } }[] };
  if (!metadata.sheets?.some((sheet) => sheet.properties?.title === TABS.presets)) {
    const createRes = await fetch(GATEWAY + "/google_sheets/v4/spreadsheets/" + encodeURIComponent(id) + ":batchUpdate", {
      method: "POST", headers: connectorHeaders(),
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TABS.presets, gridProperties: { rowCount: 100, columnCount: headers.length } } } }] }),
    });
    await responseJson(createRes, "Create Portal_Schedule_Presets tab");
    const headerUrl = GATEWAY + "/google_sheets/v4/spreadsheets/" + encodeURIComponent(id) + "/values/" + encodeURIComponent(TABS.presets) + "!A1:G1?valueInputOption=RAW";
    await responseJson(await fetch(headerUrl, { method: "PUT", headers: connectorHeaders(), body: JSON.stringify({ values: [headers] }) }), "Initialize schedule preset headers");
  }
  const valuesUrl = GATEWAY + "/google_sheets/v4/spreadsheets/" + encodeURIComponent(id) + "/values/" + encodeURIComponent(TABS.presets) + "!A2:G";
  const values = await responseJson(await fetch(valuesUrl, { headers: connectorHeaders() }), "Read schedule presets") as { values?: string[][] };
  if (!(values.values ?? []).length) {
    const defaults: [string, string, string, string][] = [
      ["Aarti", "SLOT_1", "10:00", "10:29"], ["Aarti", "SLOT_2", "15:01", "15:30"],
      ["Bharti", "SLOT_1", "10:29", "10:58"], ["Bharti", "SLOT_2", "15:30", "15:59"],
      ["Pooja", "SLOT_1", "10:58", "11:27"], ["Pooja", "SLOT_2", "15:59", "16:28"],
      ["Vinita", "SLOT_1", "11:27", "11:56"], ["Vinita", "SLOT_2", "16:28", "16:57"],
      ["Ankita", "SLOT_1", "11:56", "12:25"], ["Ankita", "SLOT_2", "16:57", "17:26"],
      ["Sunanda", "SLOT_1", "12:25", "12:54"], ["Sunanda", "SLOT_2", "17:26", "17:55"],
      ["Julee", "SLOT_1", "13:53", "14:22"], ["Julee", "SLOT_2", "17:55", "18:24"],
    ];
    const appendUrl = GATEWAY + "/google_sheets/v4/spreadsheets/" + encodeURIComponent(id) + "/values/" + encodeURIComponent(TABS.presets) + "!A:G:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS";
    await responseJson(await fetch(appendUrl, { method: "POST", headers: connectorHeaders(), body: JSON.stringify({ values: defaults.map(([executive, slot, from, to]) => [executive + "|" + slot, executive, slot, from, to, isoNow(), "System"]) }) }), "Initialize executive schedule presets");
  }
}
async function readTab(tab: string) {
  if (tab === TABS.accessRequests) await ensureAccessRequestsTab();
  if (tab === TABS.presets) await ensureSchedulePresetsTab();
  const id = await spreadsheetId();
  const url = GATEWAY + "/google_sheets/v4/spreadsheets/" + encodeURIComponent(id) + "/values/" + encodeURIComponent(tab) + "!A2:Z";
  const json = await responseJson(await fetch(url, { headers: connectorHeaders() }), "Read " + tab) as { values?: string[][] };
  return json.values ?? [];
}
async function appendTab(tab: string, values: (string | number)[][]) {
  const id = await spreadsheetId();
  const url = GATEWAY + "/google_sheets/v4/spreadsheets/" + encodeURIComponent(id) + "/values/" + encodeURIComponent(tab) + "!A:Z:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS";
  return responseJson(await fetch(url, { method: "POST", headers: connectorHeaders(), body: JSON.stringify({ values }) }), "Write " + tab);
}
async function updateTab(tab: string, row: number, range: string, values: (string | number)[][]) {
  if (row < 2) throw new Error("Header row cannot be changed.");
  const id = await spreadsheetId();
  const columns = range.split(":");
  const a1 = columns.length > 1 ? columns[0]! + row + ":" + columns[1]! + row : range + row;
  const url = GATEWAY + "/google_sheets/v4/spreadsheets/" + encodeURIComponent(id) + "/values/" + encodeURIComponent(tab) + "!" + a1 + "?valueInputOption=RAW";
  return responseJson(await fetch(url, { method: "PUT", headers: connectorHeaders(), body: JSON.stringify({ values }) }), "Update " + tab);
}
function isoNow() { return new Date().toISOString(); }
function indiaDate(now = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now); }
function indiaTime(now = new Date()) { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now); }
function isActive(value: string | undefined) { return (value ?? "").trim().toLowerCase() === "active"; }
function timeToMinutes(value: string | undefined) {
  const match = (value ?? "").match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}
function sessionStartMs(row: string[]) {
  const date = row[2] ?? "";
  const time = row[3] ?? "";
  const parsed = new Date(date + "T" + time + "+05:30").getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
function sessionCapMinutes(row: string[]) {
  const match = (row[9] ?? "").match(/MAX_MINUTES=(\d+)/);
  const value = match ? Number(match[1]) : MAX_SESSION_MINUTES;
  return Number.isFinite(value) && value > 0 ? Math.min(MAX_SESSION_MINUTES, value) : MAX_SESSION_MINUTES;
}
function equalSecret(input: string, secret: string) {
  if (!input || !secret || input.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < input.length; i++) diff |= input.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}
async function requirePortalAdmin(password?: string) {
  const session = await requireSession();
  if (session.role === "Admin") return session;
  const secret = process.env["SETTINGS_PASSWORD"];
  if (password && secret && equalSecret(password, secret)) return session;
  throw new Error("403 Forbidden: Administrator access required.");
}
async function audit(action: string, executive: string, details: string) {
  await appendTab(TABS.audit, [["AUD-" + crypto.randomUUID(), isoNow(), action, executive, details]]);
}
async function cleanupExpiredSessionsLocked() {
  const rows = await readTab(TABS.sessions);
  const now = new Date();
  let closed = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (!isActive(row[7])) continue;
    const started = sessionStartMs(row);
    const cap = sessionCapMinutes(row);
    if (!started || now.getTime() - started < cap * 60_000) continue;
    const duration = Math.max(0, Math.round((now.getTime() - started) / 60_000));
    await updateTab(TABS.sessions, i + 2, "E:H", [[indiaDate(now), indiaTime(now), duration, "Auto-Ended"]]);
    await audit("SESSION_AUTO_TIMEOUT", row[1] ?? "Unknown", (row[0] ?? "") + " · " + cap + " minute cap");
    closed++;
  }
  return closed;
}
function findCurrentPreset(rows: string[][], nowMinutes: number) {
  const presets = rows.filter((r) => r[1] && r[3] && r[4]);
  return presets.find((r) => nowMinutes >= timeToMinutes(r[3]) && nowMinutes < timeToMinutes(r[4]))
    ?? presets.filter((r) => timeToMinutes(r[3]) > nowMinutes).sort((a, b) => (a[3] ?? "").localeCompare(b[3] ?? ""))[0];
}
function validateSchedule(date: string, start: string, end: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(new Date(date + "T00:00:00+05:30").getTime())) throw new Error("Choose a valid schedule date.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) throw new Error("Use 24-hour time, for example 10:00.");
  if (timeToMinutes(end) <= timeToMinutes(start)) throw new Error("End time must be after start time.");
}
function assertNoScheduleOverlap(rows: string[][], date: string, start: string, end: string, ignoreId?: string) {
  const from = timeToMinutes(start);
  const to = timeToMinutes(end);
  const overlap = rows.find((r) => r[0] !== ignoreId && r[2] === date && (r[5] ?? "").toLowerCase() !== "cancelled"
    && from < timeToMinutes(r[4]) && to > timeToMinutes(r[3]));
  if (overlap) throw new Error("This time overlaps " + (overlap[1] ?? "another executive") + "'s slot (" + overlap[3] + "–" + overlap[4] + ").");
}

export const getBankPortalData = createServerFn({ method: "GET" }).handler(async () => {
  const session = await requireSession();
  await withSheetMutex("bank-portal-session-write", cleanupExpiredSessionsLocked);
  const [sessions, schedules, complaints, warnings, bans, accessRequests, presetRows] = await Promise.all([
    readTab(TABS.sessions), readTab(TABS.schedules), readTab(TABS.complaints),
    session.role === "Admin" ? readTab(TABS.warnings) : Promise.resolve([]),
    readTab(TABS.bans), readTab(TABS.accessRequests), readTab(TABS.presets),
  ]);
  const today = indiaDate();
  const parts = indiaTime().split(":");
  const nowMinutes = Number(parts[0]) * 60 + Number(parts[1]);
  const todaysAll = schedules.filter((r) => r[2] === today && Boolean(r[1] && r[3] && r[4]) && (r[5] ?? "").toLowerCase() !== "cancelled");
  const batchReserved = nowMinutes >= 18 * 60 + 30 && nowMinutes < 19 * 60 + 30;
  const currentSlot = batchReserved
    ? ["ANKITA-BATCH", "Ankita", "SLOT_BATCH", "18:30", "19:30", "Reserved"]
    : presetRows.find((r) => nowMinutes >= timeToMinutes(r[3]) && nowMinutes < timeToMinutes(r[4]));
  const nextSlot = presetRows.filter((r) => timeToMinutes(r[3]) > nowMinutes).sort((a, b) => (a[3] ?? "").localeCompare(b[3] ?? ""))[0];
  const slotOwner = currentSlot ?? nextSlot;
  const activeSession = sessions.find((r) => r[1] === session.name && isActive(r[7]));
  const relevantRequests = accessRequests.map((r, i) => ({
    row: i + 2, id: r[0] ?? "", requester: r[1] ?? "", recipient: r[2] ?? "",
    dateTime: r[3] ?? "", reason: r[4] ?? "", duration: r[5] ?? "", slotEndsAt: r[9] ?? "",
    status: r[6] ?? "", approvedAt: r[7] ?? "", expiresAt: r[8] ?? "",
  })).filter((r) => r.requester === session.name || r.recipient === session.name);
  return {
    session, today,
    activeSession: activeSession ? { id: activeSession[0] ?? "", loginDate: activeSession[2] ?? "", loginTime: activeSession[3] ?? "", capMinutes: sessionCapMinutes(activeSession) } : null,
    latestPortalSession: sessions.length ? (() => {
      // Pick by the recorded IST start timestamp, not physical row position.
      // This remains correct if an administrator sorts the Google Sheet.
      const row = sessions.reduce((latest, candidate) =>
        !latest || sessionStartMs(candidate) >= sessionStartMs(latest) ? candidate : latest
      );
      return {
        id: row[0] ?? "", executive: row[1] ?? "", loginDate: row[2] ?? "", loginTime: row[3] ?? "",
        logoutDate: row[4] ?? "", logoutTime: row[5] ?? "", status: row[7] ?? "",
      };
    })() : null,
    liveSessions: sessions.filter((r) => isActive(r[7])).map((r) => ({
      id: r[0] ?? "", executive: r[1] ?? "", loginDate: r[2] ?? "", loginTime: r[3] ?? "",
      startedAt: sessionStartMs(r), capMinutes: sessionCapMinutes(r),
      isAdminSession: (r[9] ?? "").includes("ADMIN_OVERRIDE=YES"),
    })),
    schedules: todaysAll.filter((r) => r[1] === session.name).map((r) => ({ id: r[0] ?? "", start: r[3] ?? "", end: r[4] ?? "", status: r[5] ?? "" })),
    portalTimings: todaysAll.sort((a, b) => (a[3] ?? "").localeCompare(b[3] ?? "")).map((r) => ({ id: r[0] ?? "", executive: r[1] ?? "", start: r[3] ?? "", end: r[4] ?? "", status: r[5] ?? "" })),
    isAdmin: session.role === "Admin",
    outsideOfficeHours: nowMinutes < 10 * 60 || nowMinutes >= 19 * 60 + 30,
    batchReserved,
    schedulePresets: presetRows.map((r) => ({ id: r[0] ?? "", executive: r[1] ?? "", slot: r[2] ?? "", start: r[3] ?? "", end: r[4] ?? "" })),
    slotOwner: slotOwner ? { name: slotOwner[1] ?? "", start: slotOwner[3] ?? "", end: slotOwner[4] ?? "" } : null,
    currentSlotOwner: currentSlot ? { name: currentSlot[1] ?? "", start: currentSlot[3] ?? "", end: currentSlot[4] ?? "" } : null,
    nextSlotOwner: nextSlot ? { name: nextSlot[1] ?? "", start: nextSlot[3] ?? "", end: nextSlot[4] ?? "" } : null,
    accessRequests: relevantRequests,
    complaints: complaints.filter((r) => session.role === "Admin" || r[2] === session.name).map((r) => ({
      id: r[0] ?? "", executive: r[2] ?? "", dateTime: r[3] ?? "", type: r[4] ?? "", description: r[5] ?? "", status: r[6] ?? "", remark: r[7] ?? "",
    })),
    sessions: session.role === "Admin" ? sessions.map((r, i) => ({
      row: i + 2, id: r[0] ?? "", executive: r[1] ?? "", loginDate: r[2] ?? "", loginTime: r[3] ?? "",
      logoutDate: r[4] ?? "", logoutTime: r[5] ?? "", duration: r[6] ?? "", status: r[7] ?? "", device: r[8] ?? "", notes: r[9] ?? "",
    })) : [],
    warnings: warnings.map((r) => ({ id: r[0], executive: r[1], dateTime: r[2], reason: r[3], issuedBy: r[4], acknowledged: r[5] })),
    banned: bans.some((r) => r[0] && r[1] === session.name && isActive(r[5]) &&
      (!r[2] || new Date(r[2]).getTime() <= Date.now()) && (!r[3] || new Date(r[3]).getTime() >= Date.now())),
  };
});

export const requestBankPortalAccess = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ reason: z.string().trim().min(3).max(500), duration: z.union([z.literal("FULL_SLOT"), z.number().int().min(1).max(MAX_SESSION_MINUTES)]) }).parse(d))
  .handler(async ({ data }) => {
    const session = await requireSession();
    if (session.role === "Admin") throw new Error("Admin does not need to request access.");
    const [presets, requests, sessions] = await Promise.all([
      readTab(TABS.presets), readTab(TABS.accessRequests), readTab(TABS.sessions),
    ]);
    if (sessions.some((row) => isActive(row[7]))) {
      throw new Error("The Bank Portal is currently in use. Access requests are available only when the portal is free.");
    }
    const now = new Date();
    const parts = indiaTime(now).split(":");
    const nowMinutes = Number(parts[0]) * 60 + Number(parts[1]);
    const batchReserved = nowMinutes >= 18 * 60 + 30 && nowMinutes < 19 * 60 + 30;
    const owner = batchReserved
      ? ["ANKITA-BATCH", "Ankita", "SLOT_BATCH", "18:30", "19:30"]
      : presets.find((r) => nowMinutes >= timeToMinutes(r[3]) && nowMinutes < timeToMinutes(r[4]));
    if (!owner?.[1] || owner[1] === session.name) throw new Error("There is no other active slot owner to receive this request right now.");
    const slotEnd = new Date(indiaDate(now) + "T" + owner[4] + ":00+05:30");
    const remainingMinutes = Math.floor((slotEnd.getTime() - now.getTime()) / 60_000);
    if (!Number.isFinite(remainingMinutes) || remainingMinutes < 1) throw new Error("The current slot has less than one full minute remaining.");
    const durationMinutes = data.duration === "FULL_SLOT" ? remainingMinutes : data.duration;
    if (durationMinutes > remainingMinutes) throw new Error("Requested duration exceeds the remaining slot time (" + remainingMinutes + " minutes).");
    if (requests.some((r) => r[1] === session.name && r[6] === "Pending" && r[2] === owner[1]))
      throw new Error("You already have a pending request for this slot.");
    const id = "BPAR-" + crypto.randomUUID();
    await appendTab(TABS.accessRequests, [[id, session.name, owner[1], isoNow(), data.reason, String(durationMinutes), "Pending", "", "", slotEnd.toISOString()]]);
    await audit("ACCESS_REQUESTED", session.name, id + " -> " + owner[1]);
    return { ok: true, id, recipient: owner[1] };
  });

export const respondBankPortalAccessRequest = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ requestId: z.string().min(1).max(100), decision: z.enum(["Approved", "Rejected"]) }).parse(d))
  .handler(async ({ data }) => {
    const session = await requireSession();
    const rows = await readTab(TABS.accessRequests);
    const index = rows.findIndex((r) => r[0] === data.requestId);
    if (index < 0) throw new Error("Access request not found.");
    const row = rows[index]!;
    if (row[2] !== session.name) throw new Error("Only the assigned slot Executive can respond to this request.");
    if (row[6] !== "Pending") throw new Error("This request has already been handled.");
    const approvedAt = data.decision === "Approved" ? isoNow() : "";
    const slotEndMs = row[9] ? new Date(row[9]).getTime() : Number.POSITIVE_INFINITY;
    const expiresAt = data.decision === "Approved" ? new Date(Math.min(Date.now() + Number(row[5]) * 60_000, slotEndMs)).toISOString() : "";
    await updateTab(TABS.accessRequests, index + 2, "G:I", [[data.decision, approvedAt, expiresAt]]);
    await audit("ACCESS_REQUEST_" + data.decision.toUpperCase(), session.name, data.requestId);
    return { ok: true };
  });

export const startBankPortalSession = createServerFn({ method: "POST" }).handler(async () => {
  const session = await requireSession();
  return withSheetMutex("bank-portal-session-write", async () => {
    await cleanupExpiredSessionsLocked();
    const [sessions, bans, presets, requests] = await Promise.all([
      readTab(TABS.sessions), readTab(TABS.bans), readTab(TABS.presets), readTab(TABS.accessRequests),
    ]);
    const banned = bans.some((r) => r[1] === session.name && isActive(r[5]) && (!r[3] || new Date(r[3]).getTime() >= Date.now()));
    if (banned) throw new Error("Bank Portal access is currently suspended. Contact Admin.");
    const active = sessions.find((r) => isActive(r[7]));
    if (active) throw new Error("Bank Portal is currently in use by " + (active[1] ?? "another executive") + ". Please wait until the session ends.");
    let capMinutes = MAX_SESSION_MINUTES;
    let accessRequestIndex = -1;
    const now = new Date();
    const parts = indiaTime(now).split(":");
    const nowMinutes = Number(parts[0]) * 60 + Number(parts[1]);
    const isAdmin = session.role === "Admin";
    const batchReserved = nowMinutes >= 18 * 60 + 30 && nowMinutes < 19 * 60 + 30;

    if (!isAdmin) {
      if (batchReserved && session.name !== "Ankita") {
        throw new Error("6:30 PM–7:30 PM is Ankita's reserved batch-work slot. Other executives cannot use the portal during this period.");
      }

      const ownSlot = (batchReserved && session.name === "Ankita") || presets.some((r) => r[1] === session.name
        && nowMinutes >= timeToMinutes(r[3]) && nowMinutes < timeToMinutes(r[4]));
      if (!ownSlot) {
        const outsideOfficeHours = nowMinutes < 10 * 60 || nowMinutes >= 19 * 60 + 30;
        if (outsideOfficeHours) {
          capMinutes = 10;
        } else {
          accessRequestIndex = requests.findIndex((r) => r[1] === session.name && r[6] === "Approved" && r[7] && r[8]
            && new Date(r[7]).getTime() <= Date.now() && new Date(r[8]).getTime() > Date.now());
          if (accessRequestIndex < 0) throw new Error("Access is available during your assigned slot, for 10 minutes outside office hours, or after the slot owner approves an emergency request.");
          const approvedRequest = requests[accessRequestIndex]!;
          const requestSlotEnd = approvedRequest[9] ? new Date(approvedRequest[9]).getTime() : Number.POSITIVE_INFINITY;
          const remainingApprovedSlot = Math.floor((requestSlotEnd - now.getTime()) / 60_000);
          if (remainingApprovedSlot < 1) throw new Error("The slot for this approved request has ended.");
          capMinutes = Math.min(MAX_SESSION_MINUTES, Number(approvedRequest[5]) || 0, remainingApprovedSlot);
          if (capMinutes < 1) throw new Error("This access request has no remaining time.");
        }
      }
    }
    const id = "BPS-" + crypto.randomUUID();
    const notes = "MAX_MINUTES=" + capMinutes
      + (isAdmin ? "; ADMIN_OVERRIDE=YES" : "")
      + (accessRequestIndex >= 0 ? "; ACCESS_REQUEST_ID=" + requests[accessRequestIndex]?.[0] : "")
      + (capMinutes === 10 && !isAdmin ? "; OUTSIDE_OFFICE_LIMIT=10" : "");
    await appendTab(TABS.sessions, [[id, session.name, indiaDate(now), indiaTime(now), "", "", "", "Active", "", notes]]);
    if (accessRequestIndex >= 0) await updateTab(TABS.accessRequests, accessRequestIndex + 2, "G", [["Used"]]);
    await audit("SESSION_STARTED", session.name, id + (accessRequestIndex >= 0 ? " · emergency " + capMinutes + "m" : ""));
    return { ok: true, id, capMinutes };
  });
});

export const endBankPortalSession = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ sessionId: z.string().min(1).max(100), settingsPassword: z.string().max(200).optional() }).parse(d))
  .handler(async ({ data }) => withSheetMutex("bank-portal-session-write", async () => {
    const caller = await requireSession();
    const rows = await readTab(TABS.sessions);
    const index = rows.findIndex((r) => r[0] === data.sessionId);
    if (index < 0 || !isActive(rows[index]?.[7])) throw new Error("Active Bank Portal session not found.");
    const target = rows[index]!;
    if (caller.name !== target[1]) throw new Error("Admins must use the reason-required Force Close action for another executive’s session.");
    const now = new Date();
    const duration = Math.max(0, Math.round((now.getTime() - sessionStartMs(target)) / 60_000));
    await updateTab(TABS.sessions, index + 2, "E:H", [[indiaDate(now), indiaTime(now), duration, "Ended"]]);
    await audit("SESSION_ENDED", target[1] ?? caller.name, data.sessionId);
    return { ok: true };
  }));

export const forceEndBankPortalSession = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ sessionId: z.string().min(1).max(100), reason: z.string().trim().min(3).max(500) }).parse(d))
  .handler(async ({ data }) => withSheetMutex("bank-portal-session-write", async () => {
    await requireSession();
    const admin = await requirePortalAdmin();
    const rows = await readTab(TABS.sessions);
    const index = rows.findIndex((r) => r[0] === data.sessionId);
    if (index < 0 || !isActive(rows[index]?.[7])) throw new Error("Active Bank Portal session not found.");
    const target = rows[index]!;
    const now = new Date();
    const duration = Math.max(0, Math.round((now.getTime() - sessionStartMs(target)) / 60_000));
    await updateTab(TABS.sessions, index + 2, "E:H", [[indiaDate(now), indiaTime(now), duration, "Force-Ended"]]);
    await audit("SESSION_FORCE_ENDED", admin.name, (target[1] ?? "Unknown") + " · " + data.reason);
    return { ok: true };
  }));


export const updateBankPortalPreset = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({
    executive: z.enum(BANK_PORTAL_EXECUTIVES),
    slot: z.enum(["SLOT_1", "SLOT_2"]),
    start: z.string(),
    end: z.string(),
  }).parse(d))
  .handler(async ({ data }) => {
    await requireSession();
    const admin = await requirePortalAdmin();
    validateSchedule(indiaDate(), data.start, data.end);
    return withSheetMutex("bank-portal-preset-write", async () => {
      const rows = await readTab(TABS.presets);
      const index = rows.findIndex((r) => r[1] === data.executive && r[2] === data.slot);
      if (index < 0) throw new Error("Executive schedule preset not found.");
      await updateTab(TABS.presets, index + 2, "D:G", [[data.start, data.end, isoNow(), admin.name]]);
      await audit("SCHEDULE_PRESET_UPDATED", admin.name, data.executive + " · " + data.slot + " · " + data.start + "–" + data.end);
      return { ok: true };
    });
  });

export const createBankPortalSchedule = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ executive: z.enum(BANK_PORTAL_EXECUTIVES), date: z.string(), start: z.string(), end: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireSession();
    await requirePortalAdmin();
    validateSchedule(data.date, data.start, data.end);
    return withSheetMutex("bank-portal-schedule-write", async () => {
      const rows = await readTab(TABS.schedules);
      assertNoScheduleOverlap(rows, data.date, data.start, data.end);
      const id = "BPSL-" + crypto.randomUUID();
      await appendTab(TABS.schedules, [[id, data.executive, data.date, data.start, data.end, "Scheduled"]]);
      await audit("SCHEDULE_CREATED", data.executive, id + " · " + data.date + " " + data.start + "–" + data.end);
      return { ok: true, id };
    });
  });

export const updateBankPortalSchedule = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ scheduleId: z.string().min(1).max(100), executive: z.enum(BANK_PORTAL_EXECUTIVES), date: z.string(), start: z.string(), end: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireSession();
    const admin = await requirePortalAdmin();
    validateSchedule(data.date, data.start, data.end);
    return withSheetMutex("bank-portal-schedule-write", async () => {
      const rows = await readTab(TABS.schedules);
      const index = rows.findIndex((r) => r[0] === data.scheduleId);
      if (index < 0 || (rows[index]?.[5] ?? "").toLowerCase() === "cancelled") throw new Error("Schedule slot not found or already cancelled.");
      assertNoScheduleOverlap(rows, data.date, data.start, data.end, data.scheduleId);
      await updateTab(TABS.schedules, index + 2, "B:F", [[data.executive, data.date, data.start, data.end, "Scheduled"]]);
      await audit("SCHEDULE_UPDATED", admin.name, data.scheduleId + " → " + data.executive + " · " + data.date + " " + data.start + "–" + data.end);
      return { ok: true };
    });
  });

export const cancelBankPortalSchedule = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ scheduleId: z.string().min(1).max(100), reason: z.string().trim().min(3).max(300) }).parse(d))
  .handler(async ({ data }) => {
    await requireSession();
    const admin = await requirePortalAdmin();
    return withSheetMutex("bank-portal-schedule-write", async () => {
      const rows = await readTab(TABS.schedules);
      const index = rows.findIndex((r) => r[0] === data.scheduleId);
      if (index < 0 || (rows[index]?.[5] ?? "").toLowerCase() === "cancelled") throw new Error("Schedule slot not found or already cancelled.");
      await updateTab(TABS.schedules, index + 2, "F", [["Cancelled"]]);
      await audit("SCHEDULE_CANCELLED", admin.name, data.scheduleId + " · " + data.reason);
      return { ok: true };
    });
  });

export const submitBankPortalComplaint = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ sessionId: z.string().max(100).optional(), issueType: z.string().trim().min(1).max(80), description: z.string().trim().min(3).max(2000) }).parse(d))
  .handler(async ({ data }) => {
    const session = await requireSession();
    const id = "BPC-" + crypto.randomUUID();
    await appendTab(TABS.complaints, [[id, data.sessionId ?? "", session.name, isoNow(), data.issueType, data.description, "Open", "", ""]]);
    await audit("COMPLAINT_SUBMITTED", session.name, id);
    return { ok: true, id };
  });

export const resolveBankPortalComplaint = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ complaintId: z.string().min(1).max(100), remark: z.string().trim().min(1).max(1000), settingsPassword: z.string().max(200).optional() }).parse(d))
  .handler(async ({ data }) => {
    await requireSession();
    const admin = await requirePortalAdmin(data.settingsPassword);
    const rows = await readTab(TABS.complaints);
    const index = rows.findIndex((r) => r[0] === data.complaintId);
    if (index < 0) throw new Error("Complaint not found.");
    await updateTab(TABS.complaints, index + 2, "G:I", [["Resolved", data.remark, isoNow()]]);
    await audit("COMPLAINT_RESOLVED", admin.name, data.complaintId);
    return { ok: true };
  });

export const issueBankPortalWarning = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ executiveName: z.enum(BANK_PORTAL_EXECUTIVES), reason: z.string().trim().min(1).max(1000) }).parse(d))
  .handler(async ({ data }) => {
    await requireSession();
    const admin = await requirePortalAdmin();
    const id = "BPW-" + crypto.randomUUID();
    await appendTab(TABS.warnings, [[id, data.executiveName, isoNow(), data.reason, admin.name, "No"]]);
    await audit("WARNING_ISSUED", data.executiveName, id);
    return { ok: true, id };
  });
