import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSession } from "./auth.functions";
import { sheetsGet } from "./mahavtaar.server";

const GATEWAY = "https://connector-gateway.lovable.dev";
const PORTAL_SPREADSHEET_FALLBACK = "1C1u_4nTIN-_KbhJ2RrXeIDIg0cWSNpIxN8N_hDIn-yo";
const TABS = {
  sessions: "Portal_Sessions",
  schedules: "Portal_Schedules",
  complaints: "Portal_Complaints",
  warnings: "Portal_Warnings",
  bans: "Portal_Bans",
  audit: "Portal_Audit",
} as const;

function connectorHeaders() {
  const lovable = process.env["LOVABLE_API_KEY"];
  const sheets = process.env["GOOGLE_SHEETS_API_KEY"];
  if (!lovable || !sheets) throw new Error("Google Sheets connector is not configured.");
  return { Authorization: `Bearer ${lovable}`, "X-Connection-Api-Key": sheets, "Content-Type": "application/json" };
}

async function responseJson(res: Response, action: string) {
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${action} failed [${res.status}]: ${detail}`);
  }
  return res.json();
}

async function spreadsheetId() {
  const configured = process.env["BANK_PORTAL_SPREADSHEET_ID"]?.trim();
  if (configured) return configured;
  try {
    const rows = await sheetsGet("AppSettings!A2:B");
    const saved = rows.find((r) => (r[0] ?? "").trim() === "bankPortalSpreadsheetId")?.[1]?.trim();
    if (saved) return saved;
  } catch (error) {
    console.warn("Could not read Bank Portal spreadsheet setting:", error);
  }
  return PORTAL_SPREADSHEET_FALLBACK;
}

async function readTab(tab: string) {
  const id = await spreadsheetId();
  const url = `${GATEWAY}/google_sheets/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(tab)}!A2:Z`;
  const res = await fetch(url, { headers: connectorHeaders() });
  const json = await responseJson(res, `Read ${tab}`) as { values?: string[][] };
  return json.values ?? [];
}

async function appendTab(tab: string, values: (string | number)[][]) {
  const id = await spreadsheetId();
  const url = `${GATEWAY}/google_sheets/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(tab)}!A:Z:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, { method: "POST", headers: connectorHeaders(), body: JSON.stringify({ values }) });
  return responseJson(res, `Write ${tab}`);
}

async function updateTab(tab: string, row: number, range: string, values: (string | number)[][]) {
  if (row < 2) throw new Error("Header row cannot be changed.");
  const id = await spreadsheetId();
  const a1 = range.includes(":") ? range.replace(/\\d+/g, String(row)) : `${range}${row}`;
  const url = `${GATEWAY}/google_sheets/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(tab)}!${a1}?valueInputOption=RAW`;
  const res = await fetch(url, { method: "PUT", headers: connectorHeaders(), body: JSON.stringify({ values }) });
  return responseJson(res, `Update ${tab}`);
}

function isoNow() { return new Date().toISOString(); }
function indiaDate(now = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now); }
function indiaTime(now = new Date()) { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now); }
function isActive(value: string | undefined) { return (value ?? "").trim().toLowerCase() === "active"; }
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
  await appendTab(TABS.audit, [[`AUD-${crypto.randomUUID()}`, isoNow(), action, executive, details]]);
}

export const getBankPortalData = createServerFn({ method: "GET" }).handler(async () => {
  const session = await requireSession();
  const [sessions, schedules, complaints, warnings, bans] = await Promise.all([
    readTab(TABS.sessions), readTab(TABS.schedules), readTab(TABS.complaints),
    session.role === "Admin" ? readTab(TABS.warnings) : Promise.resolve([]),
    readTab(TABS.bans),
  ]);
  const activeSession = sessions.find((r) => r[1] === session.name && isActive(r[7]));
  const today = indiaDate();
  const todaySchedules = schedules.filter((r) => r[1] === session.name && r[2] === today);
  return {
    session,
    activeSession: activeSession ? { id: activeSession[0], loginDate: activeSession[2], loginTime: activeSession[3] } : null,
    schedules: todaySchedules.map((r) => ({ id: r[0], start: r[3], end: r[4], status: r[5] })),
    complaints: complaints.filter((r) => session.role === "Admin" || r[2] === session.name).map((r) => ({
      id: r[0], executive: r[2], dateTime: r[3], type: r[4], description: r[5], status: r[6], remark: r[7],
    })),
    sessions: session.role === "Admin" ? sessions.map((r, i) => ({
      row: i + 2, id: r[0], executive: r[1], loginDate: r[2], loginTime: r[3],
      logoutDate: r[4], logoutTime: r[5], duration: r[6], status: r[7], device: r[8], notes: r[9],
    })) : [],
    warnings: warnings.map((r) => ({ id: r[0], executive: r[1], dateTime: r[2], reason: r[3], issuedBy: r[4], acknowledged: r[5] })),
    banned: bans.some((r) => r[0] && r[1] === session.name && isActive(r[5]) &&
      (!r[3] || new Date(r[3]).getTime() >= Date.now())),
  };
});

export const startBankPortalSession = createServerFn({ method: "POST" }).handler(async () => {
  const session = await requireSession();
  const [sessions, bans] = await Promise.all([readTab(TABS.sessions), readTab(TABS.bans)]);
  const banned = bans.some((r) => r[1] === session.name && isActive(r[5]) &&
    (!r[3] || new Date(r[3]).getTime() >= Date.now()));
  if (banned) throw new Error("Bank Portal access is currently suspended. Contact Admin.");
  if (sessions.some((r) => r[1] === session.name && isActive(r[7])))
    throw new Error("You already have an active Bank Portal session.");
  const now = new Date();
  const id = `BPS-${crypto.randomUUID()}`;
  await appendTab(TABS.sessions, [[id, session.name, indiaDate(now), indiaTime(now), "", "", "", "Active", "", ""]]);
  await audit("SESSION_STARTED", session.name, id);
  return { ok: true, id };
});

export const endBankPortalSession = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().min(1).max(100), settingsPassword: z.string().max(200).optional() }).parse(d))
  .handler(async ({ data }) => {
    const caller = await requireSession();
    const rows = await readTab(TABS.sessions);
    const index = rows.findIndex((r) => r[0] === data.sessionId);
    if (index < 0 || !isActive(rows[index]?.[7])) throw new Error("Active Bank Portal session not found.");
    const target = rows[index]!;
    if (caller.name !== target[1]) await requirePortalAdmin(data.settingsPassword);
    const now = new Date();
    const loginAt = new Date(`${target[2]}T${target[3]}+05:30`);
    const duration = Number.isFinite(loginAt.getTime()) ? Math.max(0, Math.round((now.getTime() - loginAt.getTime()) / 60000)) : "";
    await updateTab(TABS.sessions, index + 2, "E:H", [[now.toISOString().slice(0,10), now.toLocaleTimeString("en-IN", { hour12: true, timeZone: "Asia/Kolkata" }), duration, "Ended"]]);
    await audit("SESSION_ENDED", target[1] ?? caller.name, data.sessionId);
    return { ok: true };
  });

export const submitBankPortalComplaint = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().max(100).optional(), issueType: z.string().trim().min(1).max(80), description: z.string().trim().min(3).max(2000) }).parse(d))
  .handler(async ({ data }) => {
    const session = await requireSession();
    const id = `BPC-${crypto.randomUUID()}`;
    await appendTab(TABS.complaints, [[id, data.sessionId ?? "", session.name, isoNow(), data.issueType, data.description, "Open", "", ""]]);
    await audit("COMPLAINT_SUBMITTED", session.name, id);
    return { ok: true, id };
  });

export const resolveBankPortalComplaint = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ complaintId: z.string().min(1).max(100), remark: z.string().trim().min(1).max(1000), settingsPassword: z.string().max(200).optional() }).parse(d))
  .handler(async ({ data }) => {
    const admin = await requirePortalAdmin(data.settingsPassword);
    const rows = await readTab(TABS.complaints);
    const index = rows.findIndex((r) => r[0] === data.complaintId);
    if (index < 0) throw new Error("Complaint not found.");
    await updateTab(TABS.complaints, index + 2, "G", [["Resolved", data.remark, isoNow()]]);
    await audit("COMPLAINT_RESOLVED", admin.name, data.complaintId);
    return { ok: true };
  });

export const issueBankPortalWarning = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ executiveName: z.string().trim().min(1).max(100), reason: z.string().trim().min(1).max(1000), settingsPassword: z.string().max(200).optional() }).parse(d))
  .handler(async ({ data }) => {
    const admin = await requirePortalAdmin(data.settingsPassword);
    const id = `BPW-${crypto.randomUUID()}`;
    await appendTab(TABS.warnings, [[id, data.executiveName, isoNow(), data.reason, admin.name, "No"]]);
    await audit("WARNING_ISSUED", data.executiveName, id);
    return { ok: true, id };
  });
